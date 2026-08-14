import manifest from './manifest.json';
import {
    PLATFORM_REPRESENTATION,
    RULE_STUDIO_CONTRACT,
    RULE_STUDIO_CONTRIBUTION_ID,
    RULE_STUDIO_REPRESENTATIONS,
    RULE_STUDIO_RESOURCE_TYPE,
} from './constants';
import {
    archiveRuleSetProject,
    createRuleSetProject,
    restoreRuleSetProject,
    updateRuleSetProject,
} from './domain/project';
import { createRuleSetRef } from './domain/resource-ref';
import { asRuleStudioError, RuleStudioError } from './errors';
import {
    failed,
    references,
    request as hostRequest,
    success,
} from './sdk';
import { descriptorForProject, produceRuleSetProject } from './service';
import {
    listRuleSourceCatalogs,
    loadRuleSourceCatalogItems,
} from './catalog/service';
import {
    findProjectById,
    findProjectByName,
    readRuleStudioStore,
    removeCustomCatalog,
    replaceCatalogSettings,
    replaceCustomCatalog,
    replaceProject,
    writeRuleStudioStore,
} from './store';
import { findRuleSourceCatalog } from './catalog/definitions';
import {
    createCustomCatalog,
    isCustomCatalogId,
} from './catalog/custom';

function projectId(request) {
    return decodeURIComponent(request.params.id);
}

function projectByIdentity(input) {
    const store = readRuleStudioStore();
    const id = input?.ref?.id || input?.id || input?.itemId;
    const name = input?.name || input?.source;
    return (id ? findProjectById(store, id) : null) ||
        (name ? findProjectByName(store, name) : null);
}

function requireProjectByIdentity(input) {
    const project = projectByIdentity(
        typeof input === 'string' ? { id: input } : input,
    );
    if (!project) {
        throw new RuleStudioError(
            'RESOURCE_NOT_FOUND',
            '找不到规则集项目',
            undefined,
            404,
        );
    }
    return project;
}

function requireProject(id) {
    const project = findProjectById(readRuleStudioStore(), id);
    if (!project) {
        throw new RuleStudioError('RESOURCE_NOT_FOUND', `找不到规则集 ${id}`, undefined, 404);
    }
    return project;
}

async function incomingSummary(project) {
    const result = await references.listIncoming(createRuleSetRef(project.id));
    return {
        available: result.available,
        count: result.items.length,
        owners: result.items.slice(0, 5).map(item => ({
            providerId: item?.owner?.providerId || item?.ownerProviderId || null,
            name: item?.owner?.name || item?.ownerName || null,
        })),
    };
}

function listProjects(request, response) {
    try {
        const includeArchived = `${request.query?.archived || ''}` === 'true';
        const projects = readRuleStudioStore().projects
            .filter(project => includeArchived || project.lifecycle?.state !== 'archived')
            .map(project => descriptorForProject(project));
        success(response, projects);
    } catch (error) {
        const resolved = asRuleStudioError(error);
        failed(response, resolved, resolved.statusCode);
    }
}

function listSourceCatalogs(request, response) {
    try {
        const store = readRuleStudioStore();
        success(response, listRuleSourceCatalogs({
            enabledCatalogIds: store.catalogSettings.enabledCatalogIds,
            customCatalogs: store.catalogSettings.customCatalogs,
        }));
    } catch (error) {
        const resolved = asRuleStudioError(error);
        failed(response, resolved, resolved.statusCode);
    }
}

function updateSourceCatalogSettings(request, response) {
    try {
        const enabledCatalogIds = request.body?.enabledCatalogIds;
        if (!Array.isArray(enabledCatalogIds)) {
            throw new RuleStudioError(
                'RULE_STUDIO_CATALOG_SETTINGS_INVALID',
                '规则库设置格式无效',
                undefined,
                400,
            );
        }
        const normalized = [...new Set(enabledCatalogIds.map(id => `${id || ''}`).filter(Boolean))];
        const store = readRuleStudioStore();
        const unknown = normalized.find(id => !findRuleSourceCatalog(
            id,
            store.catalogSettings.customCatalogs,
        ));
        if (unknown) {
            throw new RuleStudioError(
                'RULE_STUDIO_CATALOG_SETTINGS_INVALID',
                `找不到规则库 ${unknown}`,
                { catalogId: unknown },
                400,
            );
        }
        const settings = replaceCatalogSettings(store, { enabledCatalogIds: normalized });
        writeRuleStudioStore(store);
        success(response, { enabledCatalogIds: settings.enabledCatalogIds });
    } catch (error) {
        const resolved = asRuleStudioError(error);
        failed(response, resolved, resolved.statusCode);
    }
}

async function listSourceCatalogItems(request, response) {
    try {
        const store = readRuleStudioStore();
        success(response, await loadRuleSourceCatalogItems(
            decodeURIComponent(request.params.id),
            {
                customCatalogs: store.catalogSettings.customCatalogs,
                forceRefresh: `${request.query?.refresh || ''}` === 'true',
            },
        ));
    } catch (error) {
        const resolved = asRuleStudioError(error);
        failed(response, resolved, resolved.statusCode);
    }
}

function createSourceCatalog(request, response) {
    try {
        const store = readRuleStudioStore();
        const catalog = createCustomCatalog(request.body || {});
        if (findRuleSourceCatalog(catalog.id, store.catalogSettings.customCatalogs)) {
            throw new RuleStudioError(
                'RULE_STUDIO_CATALOG_EXISTS',
                '该 GitHub 目录已经添加为规则库',
                { catalogId: catalog.id },
                409,
            );
        }
        replaceCustomCatalog(store, catalog);
        writeRuleStudioStore(store);
        success(response, {
            ...listRuleSourceCatalogs({
                customCatalogs: store.catalogSettings.customCatalogs,
            }).find(item => item.id === catalog.id),
        }, 201);
    } catch (error) {
        const resolved = asRuleStudioError(error);
        failed(response, resolved, resolved.statusCode);
    }
}

function updateSourceCatalog(request, response) {
    try {
        const id = decodeURIComponent(request.params.id);
        if (!isCustomCatalogId(id)) {
            throw new RuleStudioError(
                'RULE_STUDIO_CATALOG_READ_ONLY',
                '内置规则库不能编辑',
                undefined,
                400,
            );
        }
        const store = readRuleStudioStore();
        const current = store.catalogSettings.customCatalogs.find(item => item.id === id);
        if (!current) {
            throw new RuleStudioError('RULE_STUDIO_CATALOG_NOT_FOUND', '找不到规则库', undefined, 404);
        }
        const catalog = createCustomCatalog(request.body || {}, {
            id,
            createdAt: current.createdAt,
        });
        replaceCustomCatalog(store, catalog);
        writeRuleStudioStore(store);
        success(response, listRuleSourceCatalogs({
            enabledCatalogIds: store.catalogSettings.enabledCatalogIds,
            customCatalogs: store.catalogSettings.customCatalogs,
        }).find(item => item.id === id));
    } catch (error) {
        const resolved = asRuleStudioError(error);
        failed(response, resolved, resolved.statusCode);
    }
}

function deleteSourceCatalog(request, response) {
    try {
        const id = decodeURIComponent(request.params.id);
        if (!isCustomCatalogId(id)) {
            throw new RuleStudioError(
                'RULE_STUDIO_CATALOG_READ_ONLY',
                '内置规则库不能删除',
                undefined,
                400,
            );
        }
        const store = readRuleStudioStore();
        const current = store.catalogSettings.customCatalogs.find(item => item.id === id);
        if (!current) {
            throw new RuleStudioError('RULE_STUDIO_CATALOG_NOT_FOUND', '找不到规则库', undefined, 404);
        }
        removeCustomCatalog(store, id);
        writeRuleStudioStore(store);
        success(response, { id });
    } catch (error) {
        const resolved = asRuleStudioError(error);
        failed(response, resolved, resolved.statusCode);
    }
}

async function getProject(request, response) {
    try {
        const project = requireProject(projectId(request));
        success(response, {
            ...project,
            incoming: await incomingSummary(project),
        });
    } catch (error) {
        const resolved = asRuleStudioError(error);
        failed(response, resolved, resolved.statusCode);
    }
}

function createProject(request, response) {
    try {
        const store = readRuleStudioStore();
        const project = createRuleSetProject(request.body || {});
        if (store.projects.some(item => item.name === project.name && item.lifecycle?.state !== 'archived')) {
            throw new RuleStudioError('RULE_STUDIO_PROJECT_NAME_EXISTS', `规则集 ${project.name} 已存在`, undefined, 409);
        }
        store.projects.push(project);
        writeRuleStudioStore(store);
        success(response, project, 201);
    } catch (error) {
        const resolved = asRuleStudioError(error);
        failed(response, resolved, resolved.statusCode);
    }
}

function updateProject(request, response) {
    try {
        const store = readRuleStudioStore();
        const current = findProjectById(store, projectId(request));
        if (!current) throw new RuleStudioError('RESOURCE_NOT_FOUND', '找不到规则集项目', undefined, 404);
        const next = updateRuleSetProject(current, request.body || {});
        if (store.projects.some(item => item.id !== next.id && item.name === next.name && item.lifecycle?.state !== 'archived')) {
            throw new RuleStudioError('RULE_STUDIO_PROJECT_NAME_EXISTS', `规则集 ${next.name} 已存在`, undefined, 409);
        }
        replaceProject(store, next);
        writeRuleStudioStore(store);
        success(response, next);
    } catch (error) {
        const resolved = asRuleStudioError(error);
        failed(response, resolved, resolved.statusCode);
    }
}

async function archiveProject(request, response) {
    try {
        const store = readRuleStudioStore();
        const current = findProjectById(store, projectId(request));
        if (!current) throw new RuleStudioError('RESOURCE_NOT_FOUND', '找不到规则集项目', undefined, 404);
        const incoming = await incomingSummary(current);
        const next = archiveRuleSetProject(current);
        replaceProject(store, next);
        writeRuleStudioStore(store);
        success(response, { project: next, incoming });
    } catch (error) {
        const resolved = asRuleStudioError(error);
        failed(response, resolved, resolved.statusCode);
    }
}

function restoreProject(request, response) {
    try {
        const store = readRuleStudioStore();
        const current = findProjectById(store, projectId(request));
        if (!current) throw new RuleStudioError('RESOURCE_NOT_FOUND', '找不到规则集项目', undefined, 404);
        if (
            store.projects.some(
                item =>
                    item.id !== current.id &&
                    item.name === current.name &&
                    item.lifecycle?.state !== 'archived',
            )
        ) {
            throw new RuleStudioError(
                'RULE_STUDIO_PROJECT_NAME_EXISTS',
                `规则集 ${current.name} 已存在，无法恢复同名项目`,
                undefined,
                409,
            );
        }
        const next = restoreRuleSetProject(current);
        replaceProject(store, next);
        writeRuleStudioStore(store);
        success(response, next);
    } catch (error) {
        const resolved = asRuleStudioError(error);
        failed(response, resolved, resolved.statusCode);
    }
}

async function produceFromRequest(body) {
    const project = body?.project || projectByIdentity(body);
    if (!project) throw new RuleStudioError('RESOURCE_NOT_FOUND', '找不到规则集项目', undefined, 404);
    return produceRuleSetProject(project, {
        representation: body?.representation,
        platform: body?.platform,
        forceRefresh: body?.forceRefresh === true,
    });
}

async function previewProject(request, response) {
    try {
        success(response, await produceFromRequest(request.body || {}));
    } catch (error) {
        const resolved = asRuleStudioError(error);
        failed(response, resolved, resolved.statusCode);
    }
}

async function refreshProject(request, response) {
    try {
        const project = requireProject(projectId(request));
        const result = await produceRuleSetProject(project, {
            representation: request.body?.representation || 'normalized-json',
            forceRefresh: true,
        });
        const store = readRuleStudioStore();
        const current = findProjectById(store, project.id);
        const next = {
            ...current,
            lastSummary: {
                ruleCount: result.stats.ruleCount,
                warningCount: result.stats.warningCount,
                errorCount: result.stats.errorCount,
                refreshedAt: Date.now(),
                freshness: result.freshness.state,
            },
        };
        replaceProject(store, next);
        writeRuleStudioStore(store);
        success(response, result);
    } catch (error) {
        const resolved = asRuleStudioError(error);
        failed(response, resolved, resolved.statusCode);
    }
}

async function downloadProject(request, response) {
    try {
        const project = requireProject(projectId(request));
        const explicitRepresentation = request.params.representation
            ? decodeURIComponent(request.params.representation)
            : null;
        const queryPlatform = Array.isArray(request.query?.platform)
            ? request.query.platform[0]
            : request.query?.platform;
        const queryTarget = Array.isArray(request.query?.target)
            ? request.query.target[0]
            : request.query?.target;
        const resolvedTarget = hostRequest.resolveClientTarget(request) ||
            (queryPlatform
                ? { value: queryPlatform, source: 'platform-query' }
                : queryTarget
                  ? { value: queryTarget, source: 'target-query' }
                  : null);
        const explicitlySelected = ['platform-query', 'target-query'].includes(
            resolvedTarget?.source,
        );
        const automaticallyDetectedPlatform = {
            Surge: 'Surge',
            SurgeMac: 'Surge',
            QX: 'QX',
            Clash: 'Clash',
            ClashMeta: 'Clash',
            Loon: 'Loon',
        }[resolvedTarget?.value];
        const platform = explicitlySelected
            ? resolvedTarget.value
            : automaticallyDetectedPlatform || 'Surge';
        if (
            !explicitRepresentation &&
            explicitlySelected &&
            !PLATFORM_REPRESENTATION[platform]
        ) {
            throw new RuleStudioError(
                'RULE_STUDIO_TARGET_UNSUPPORTED',
                `规则集订阅不支持目标 ${platform}`,
                { platform },
                400,
            );
        }
        const representation =
            explicitRepresentation ||
            PLATFORM_REPRESENTATION[platform] ||
            'surge-rule-list';
        const result = await produceRuleSetProject(project, {
            representation,
            platform,
        });
        response.type(result.mediaType).send(result.body);
    } catch (error) {
        const resolved = asRuleStudioError(error);
        failed(response, resolved, resolved.statusCode);
    }
}

export function registerRuleStudioRoutes(app) {
    app.get('/api/extensions/rule-studio/source-catalogs', listSourceCatalogs);
    app.post('/api/extensions/rule-studio/source-catalogs', createSourceCatalog);
    app.patch('/api/extensions/rule-studio/source-catalogs/settings', updateSourceCatalogSettings);
    app.patch('/api/extensions/rule-studio/source-catalogs/:id', updateSourceCatalog);
    app.delete('/api/extensions/rule-studio/source-catalogs/:id', deleteSourceCatalog);
    app.get('/api/extensions/rule-studio/source-catalogs/:id/items', listSourceCatalogItems);
    app.get('/api/extensions/rule-studio/projects', listProjects);
    app.get('/api/extensions/rule-studio/project/:id', getProject);
    app.post('/api/extensions/rule-studio/projects', createProject);
    app.patch('/api/extensions/rule-studio/project/:id', updateProject);
    app.delete('/api/extensions/rule-studio/project/:id', archiveProject);
    app.post('/api/extensions/rule-studio/project/:id/restore', restoreProject);
    app.post('/api/extensions/rule-studio/preview', previewProject);
    app.post('/api/extensions/rule-studio/project/:id/refresh', refreshProject);
    app.get('/download/rule-set/:id', downloadProject);
    app.get('/download/rule-set/:id/:representation', downloadProject);
}

async function produceArtifact(input = {}) {
    const project = requireProjectByIdentity(input);
    const target = input.target || input.platform;
    const representation = input.representation || PLATFORM_REPRESENTATION[target] || 'surge-rule-list';
    const result = await produceRuleSetProject(project, {
        representation,
        platform: target,
        forceRefresh: input.forceRefresh === true,
        freshnessPolicy: input.freshnessPolicy,
    });
    if (input.freshnessPolicy === 'fresh' && result.freshness.state === 'stale') {
        throw new RuleStudioError(
            'RESOURCE_STALE',
            '规则集无法满足 fresh 新鲜度要求',
            { ref: result.ref },
            409,
        );
    }
    return result;
}

export const ruleStudioArtifactSource = {
    id: RULE_STUDIO_CONTRIBUTION_ID,
    type: RULE_STUDIO_RESOURCE_TYPE,
    contract: RULE_STUDIO_CONTRACT,
    labelKey: 'ruleStudio.artifactSource',
    platforms: Object.keys(PLATFORM_REPRESENTATION),
    representations: [...RULE_STUDIO_REPRESENTATIONS],
    list({ includeArchived = false } = {}) {
        return readRuleStudioStore().projects
            .filter(project => includeArchived || project.lifecycle?.state !== 'archived')
            .map(project => descriptorForProject(project));
    },
    get(input) {
        return descriptorForProject(requireProjectByIdentity(input));
    },
    findSourceConfig(input) {
        if (typeof input !== 'string') return requireProjectByIdentity(input);
        const store = readRuleStudioStore();
        const project = findProjectByName(store, input) || findProjectById(store, input);
        if (!project) {
            throw new RuleStudioError(
                'RESOURCE_NOT_FOUND',
                '找不到规则集项目',
                undefined,
                404,
            );
        }
        return project;
    },
    collectDependencies() {
        return [];
    },
    async produce(input) {
        return produceArtifact(input);
    },
    async produceForSync(input) {
        const result = await this.produce(input);
        return {
            body: result.body,
            sourceRevision: result.sourceRevision,
            diagnostics: result.diagnostics,
            assertFresh() {
                if (result.freshness.state === 'stale') {
                    throw new RuleStudioError('RESOURCE_STALE', '规则集当前使用 stale 缓存', undefined, 409);
                }
            },
        };
    },
};

export const ruleStudioExtension = Object.freeze({
    id: 'rule-studio',
    extensionId: manifest.id,
    manifest,
    feature: 'ruleStudio',
    registerRoutes: registerRuleStudioRoutes,
    artifactSources: [ruleStudioArtifactSource],
});

export default registerRuleStudioRoutes;
