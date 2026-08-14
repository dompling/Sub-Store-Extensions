import { createHash } from 'node:crypto';
import { RULE_STUDIO_FORMATS } from '../constants';
import { RuleStudioError } from '../errors';

const CUSTOM_CATALOG_PREFIX = 'custom-';
const ALLOWED_FORMATS = new Set(RULE_STUDIO_FORMATS);

const EXTENSIONS_BY_FORMAT = Object.freeze({
    auto: ['.list', '.txt', '.conf', '.yaml', '.yml'],
    surge: ['.list', '.txt'],
    qx: ['.list', '.txt', '.conf'],
    loon: ['.list', '.txt'],
    'clash-classical-yaml': ['.yaml', '.yml'],
    'clash-classical-text': ['.list', '.txt'],
    'clash-domain-yaml': ['.yaml', '.yml'],
    'clash-ipcidr-yaml': ['.yaml', '.yml'],
});

function invalid(message = '自定义规则库格式无效') {
    throw new RuleStudioError(
        'RULE_STUDIO_CUSTOM_CATALOG_INVALID',
        message,
        undefined,
        400,
    );
}

function safeDecode(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        invalid('GitHub 规则库 URL 包含无效编码');
    }
}

function safeSegment(value, label) {
    const normalized = `${value || ''}`.trim();
    if (!normalized || normalized === '.' || normalized === '..' || normalized.includes('\\')) {
        invalid(`${label}无效`);
    }
    return normalized;
}

function safeRootPath(value) {
    const segments = `${value || ''}`.split('/').filter(Boolean).map(segment => safeSegment(segment, '规则目录'));
    return segments.join('/');
}

export function parseGitHubCatalogUrl(value) {
    let url;
    try {
        url = new URL(`${value || ''}`.trim());
    } catch {
        invalid('请输入有效的 GitHub 目录 URL');
    }
    if (url.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) {
        invalid('规则库目前只支持 HTTPS GitHub 目录 URL');
    }

    const segments = url.pathname.split('/').filter(Boolean).map(safeDecode);
    const owner = safeSegment(segments[0], 'GitHub 作者');
    const repositoryName = safeSegment(`${segments[1] || ''}`.replace(/\.git$/i, ''), 'GitHub 仓库');
    let ref = 'main';
    let rootPath = '';
    if (segments.length > 2) {
        if (segments[2] !== 'tree' || !segments[3]) {
            invalid('请使用 GitHub 仓库或目录 URL，例如 /tree/main/rule/Surge');
        }
        ref = safeSegment(segments[3], 'Git 分支');
        rootPath = safeRootPath(segments.slice(4).join('/'));
    }

    return {
        owner,
        repositoryName,
        ref,
        rootPath,
        repositoryUrl: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repositoryName)}`,
        directoryUrl: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repositoryName)}/tree/${encodeURIComponent(ref)}${rootPath ? `/${rootPath.split('/').map(encodeURIComponent).join('/')}` : ''}`,
    };
}

function catalogId(parsed) {
    return `${CUSTOM_CATALOG_PREFIX}${createHash('sha256')
        .update(`${parsed.owner}\0${parsed.repositoryName}\0${parsed.ref}\0${parsed.rootPath}`)
        .digest('hex')
        .slice(0, 16)}`;
}

function formatOf(value) {
    const format = `${value || 'auto'}`;
    if (!ALLOWED_FORMATS.has(format)) invalid(`不支持规则库格式 ${format}`);
    return format;
}

export function createCustomCatalog(input = {}, {
    id,
    createdAt = Date.now(),
    updatedAt = Date.now(),
} = {}) {
    const parsed = parseGitHubCatalogUrl(input.url);
    const format = formatOf(input.format);
    const name = `${input.name || ''}`.trim() || [
        `${parsed.owner}/${parsed.repositoryName}`,
        parsed.rootPath.split('/').filter(Boolean).at(-1),
    ].filter(Boolean).join(' · ');
    const description = `${input.description || ''}`.trim() || `GitHub 规则库 ${parsed.owner}/${parsed.repositoryName}`;
    const resolvedId = id || catalogId(parsed);
    if (!resolvedId.startsWith(CUSTOM_CATALOG_PREFIX)) invalid('自定义规则库 ID 无效');

    return {
        id: resolvedId,
        name,
        description,
        author: {
            name: `${input.authorName || ''}`.trim() || parsed.owner,
            url: `https://github.com/${encodeURIComponent(parsed.owner)}`,
        },
        repository: {
            owner: parsed.owner,
            name: parsed.repositoryName,
            ref: parsed.ref,
            url: parsed.repositoryUrl,
        },
        directoryUrl: parsed.directoryUrl,
        rootPath: parsed.rootPath,
        fileExtensions: [...EXTENSIONS_BY_FORMAT[format]],
        format,
        custom: true,
        createdAt,
        updatedAt,
    };
}

export function normalizeStoredCustomCatalog(value) {
    if (!value || typeof value !== 'object') invalid();
    const owner = safeSegment(value.repository?.owner, 'GitHub 作者');
    const repositoryName = safeSegment(value.repository?.name, 'GitHub 仓库');
    const ref = safeSegment(value.repository?.ref, 'Git 分支');
    const rootPath = safeRootPath(value.rootPath);
    const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repositoryName)}/tree/${encodeURIComponent(ref)}${rootPath ? `/${rootPath.split('/').map(encodeURIComponent).join('/')}` : ''}`;
    return createCustomCatalog({
        url,
        name: value.name,
        description: value.description,
        authorName: value.author?.name,
        format: value.format,
    }, {
        id: `${value.id || ''}`,
        createdAt: Number(value.createdAt) || Date.now(),
        updatedAt: Number(value.updatedAt) || Number(value.createdAt) || Date.now(),
    });
}

export function isCustomCatalogId(id) {
    return `${id || ''}`.startsWith(CUSTOM_CATALOG_PREFIX);
}
