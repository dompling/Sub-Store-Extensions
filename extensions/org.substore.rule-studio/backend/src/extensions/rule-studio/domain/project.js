import { randomUUID } from 'node:crypto';
import {
    RULE_STUDIO_FORMATS,
    RULE_STUDIO_LIMITS,
} from '../constants';
import { assertRuleStudio } from '../errors';

const textByteLength = value => Buffer.byteLength(`${value || ''}`, 'utf8');
const normalizeIconUrl = value => `${value || ''}`.trim();

function validateSource(source, index) {
    assertRuleStudio(
        source && typeof source === 'object' && !Array.isArray(source),
        'RULE_STUDIO_SOURCE_INVALID',
        `来源 ${index + 1} 无效`,
    );
    assertRuleStudio(
        typeof source.id === 'string' && source.id.trim(),
        'RULE_STUDIO_SOURCE_ID_REQUIRED',
        `来源 ${index + 1} 缺少稳定 ID`,
    );
    assertRuleStudio(
        source.kind === 'url' || source.kind === 'inline',
        'RULE_STUDIO_SOURCE_KIND_UNSUPPORTED',
        `来源 ${index + 1} 类型不受支持`,
    );
    assertRuleStudio(
        RULE_STUDIO_FORMATS.includes(source.format || 'auto'),
        'RULE_STUDIO_SOURCE_FORMAT_UNSUPPORTED',
        `来源 ${index + 1} 格式不受支持`,
    );
    if (source.kind === 'url') {
        let parsed;
        try {
            parsed = new URL(source.url);
        } catch {
            parsed = null;
        }
        assertRuleStudio(
            parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:'),
            'RULE_STUDIO_SOURCE_URL_INVALID',
            `来源 ${index + 1} 必须使用绝对 HTTP(S) URL`,
        );
    } else {
        assertRuleStudio(
            textByteLength(source.content) <= RULE_STUDIO_LIMITS.maxSourceBytes,
            'RESOURCE_CONTENT_TOO_LARGE',
            `来源 ${index + 1} 超过 10 MiB 限制`,
            undefined,
            413,
        );
    }
}

export function validateRuleSetProject(project) {
    assertRuleStudio(
        project && typeof project === 'object' && !Array.isArray(project),
        'RULE_STUDIO_PROJECT_INVALID',
        '规则集项目无效',
    );
    assertRuleStudio(
        typeof project.name === 'string' && project.name.trim(),
        'RULE_STUDIO_PROJECT_NAME_REQUIRED',
        '请输入规则集名称',
    );
    assertRuleStudio(
        project.name.trim().length <= 100,
        'RULE_STUDIO_PROJECT_NAME_TOO_LONG',
        '规则集名称不能超过 100 个字符',
    );
    assertRuleStudio(
        `${project.description || ''}`.length <= 500,
        'RULE_STUDIO_PROJECT_DESCRIPTION_TOO_LONG',
        '规则集描述不能超过 500 个字符',
    );
    if (project.iconUrl !== undefined) {
        assertRuleStudio(
            typeof project.iconUrl === 'string' && project.iconUrl.length <= 2048,
            'RULE_STUDIO_PROJECT_ICON_URL_INVALID',
            '规则集图标 URL 不能超过 2048 个字符',
        );
    }
    const sources = Array.isArray(project.sources) ? project.sources : [];
    assertRuleStudio(
        sources.filter(source => source.enabled !== false).length <=
            RULE_STUDIO_LIMITS.maxEnabledSources,
        'RULE_STUDIO_SOURCE_LIMIT_EXCEEDED',
        `单个项目最多启用 ${RULE_STUDIO_LIMITS.maxEnabledSources} 个来源`,
    );
    sources.forEach(validateSource);
    assertRuleStudio(
        new Set(sources.map(source => source.id)).size === sources.length,
        'RULE_STUDIO_SOURCE_ID_DUPLICATE',
        '来源 ID 不能重复',
    );
    return project;
}

export function createRuleSetProject(input, now = Date.now()) {
    const iconUrl = normalizeIconUrl(input?.iconUrl);
    const project = {
        id: randomUUID(),
        name: `${input?.name || ''}`.trim(),
        description: `${input?.description || ''}`.trim(),
        ...(iconUrl ? { iconUrl } : {}),
        lifecycle: { state: 'active' },
        sources: (Array.isArray(input?.sources) ? input.sources : []).map(source => ({
            ...source,
            id: source.id || randomUUID(),
            enabled: source.enabled !== false,
            format: source.format || 'auto',
        })),
        options: {
            deduplicate: input?.options?.deduplicate !== false,
            preserveComments: input?.options?.preserveComments !== false,
        },
        revision: 1,
        createdAt: now,
        updatedAt: now,
    };
    validateRuleSetProject(project);
    return project;
}

export function updateRuleSetProject(current, patch, now = Date.now()) {
    const expectedRevision = Number(patch?.revision);
    assertRuleStudio(
        Number.isInteger(expectedRevision) && expectedRevision === current.revision,
        'RESOURCE_REVISION_CONFLICT',
        '规则集已在其他位置更新，请刷新后重试',
        { expectedRevision, actualRevision: current.revision },
        409,
    );
    const project = {
        ...current,
        ...patch,
        id: current.id,
        createdAt: current.createdAt,
        lifecycle: current.lifecycle,
        name: `${patch.name ?? current.name}`.trim(),
        description: `${patch.description ?? current.description ?? ''}`.trim(),
        iconUrl: normalizeIconUrl(patch.iconUrl ?? current.iconUrl),
        sources: (patch.sources ?? current.sources).map(source => ({
            ...source,
            id: source.id || randomUUID(),
            enabled: source.enabled !== false,
            format: source.format || 'auto',
        })),
        options: {
            deduplicate: (patch.options ?? current.options)?.deduplicate !== false,
            preserveComments: (patch.options ?? current.options)?.preserveComments !== false,
        },
        revision: current.revision + 1,
        updatedAt: now,
    };
    if (!project.iconUrl) delete project.iconUrl;
    validateRuleSetProject(project);
    return project;
}

export function archiveRuleSetProject(current, now = Date.now()) {
    if (current.lifecycle?.state === 'archived') return current;
    return {
        ...current,
        lifecycle: { state: 'archived', archivedAt: now },
        revision: current.revision + 1,
        updatedAt: now,
    };
}

export function restoreRuleSetProject(current, now = Date.now()) {
    if (current.lifecycle?.state !== 'archived') return current;
    return {
        ...current,
        lifecycle: { state: 'active' },
        revision: current.revision + 1,
        updatedAt: now,
    };
}
