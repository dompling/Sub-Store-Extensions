import {
    cache,
    deleteByName,
    failed,
    findByName,
    network,
    RequestInvalidError,
    ResourceNotFoundError,
    request as hostRequest,
    resources,
    runBackendRequestTask,
    success,
    transform,
    updateByName,
} from './sdk';
import { readConfigGeneratorStore, writeConfigGeneratorStore } from './store';
import { validateProject, validateRuleSet } from './validation';
import { generateSurgeConfig } from './targets/surge/generator';
import { importSurgeConfig } from './targets/surge/importer';
import { generateQXConfig } from './targets/qx/generator';
import { importQXConfig } from './targets/qx/importer';
import { generateClashConfig } from './targets/clash/generator';
import { importClashConfig } from './targets/clash/importer';
import { generateLoonConfig } from './targets/loon/generator';
import { importLoonConfig } from './targets/loon/importer';
import {
    getTargetIds,
    getTargetPlatform,
    normalizeTargetId,
} from './core/target-capabilities';
import {
    createRemoteProxySourceContext,
    isAutomaticRemoteProxySource,
    projectGroupRemoteProxySource,
} from './core/remote-proxy-source';
import { resolveRuleSetSource } from './core/rule-set-source-resolver';
import { sanitizeClashRuleProvider } from './targets/clash/rule-provider';
import {
    configProjectResourceRef,
    isResourceRuleSet,
    produceResourceRuleSet,
    projectResourceRuleSets,
} from './core/resource-rule-set';
import {
    clearProjectResourceReferences,
    repairConfigGeneratorReferences,
    replaceProjectResourceReferences,
} from './core/reference-index';
import { diagnoseConfigProject } from './diagnostics';
import manifest from './manifest.json';
import { hex_md5 } from '@/vendor/md5';

const CONFIG_GENERATOR_RULE_SET_CACHE_PREFIX =
    'config-generator:remote-rule-set:';

const TARGET_HANDLERS = {
    surge: {
        route: 'surge',
        platform: getTargetPlatform('surge'),
        generate: generateSurgeConfig,
        importConfig: importSurgeConfig,
    },
    qx: {
        route: 'qx',
        platform: getTargetPlatform('qx'),
        generate: generateQXConfig,
        importConfig: importQXConfig,
    },
    clash: {
        route: 'clash',
        platform: getTargetPlatform('clash'),
        generate: generateClashConfig,
        importConfig: importClashConfig,
    },
    loon: {
        route: 'loon',
        platform: getTargetPlatform('loon'),
        generate: generateLoonConfig,
        importConfig: importLoonConfig,
    },
};
const TARGET_HANDLER_LIST = Object.values(TARGET_HANDLERS);

function assertTargetHandlerCoverage() {
    const capabilityTargets = getTargetIds();
    const handlerTargets = Object.keys(TARGET_HANDLERS);
    const missingHandlers = capabilityTargets.filter(
        (target) => !TARGET_HANDLERS[target],
    );
    const unknownHandlers = handlerTargets.filter(
        (target) => !capabilityTargets.includes(target),
    );
    if (!missingHandlers.length && !unknownHandlers.length) return;
    throw new Error(
        `Config generator target handler registry mismatch: missing handlers [${missingHandlers.join(
            ', ',
        )}], unknown handlers [${unknownHandlers.join(', ')}]`,
    );
}

assertTargetHandlerCoverage();

function errorFrom(error) {
    return error?.code
        ? error
        : new RequestInvalidError(
              'CONFIG_GENERATOR_INVALID_REQUEST',
              error.message || `${error}`,
          );
}

function projectItems() {
    return readConfigGeneratorStore().projects.map((project) => ({
        id: project.name,
        name: project.name,
        displayName: project.displayName || project.name,
        revision: project.revision,
        updatedAt: project.updated,
        lifecycle: { state: 'active' },
        sourceRef: configProjectResourceRef(project),
    }));
}

function projectIdentity(input) {
    if (typeof input === 'string') return input;
    return input?.ref?.id || input?.id || input?.name || input?.source;
}

function requireConfigProject(input) {
    const name = projectIdentity(input);
    const project = findByName(readConfigGeneratorStore().projects, name);
    if (!project)
        throw new ResourceNotFoundError(
            'CONFIG_GENERATOR_PROJECT_NOT_FOUND',
            `找不到配置项目 ${name || ''}`.trim(),
        );
    return project;
}

function projectDescriptor(input) {
    const project = requireConfigProject(input);
    return {
        id: project.name,
        name: project.name,
        displayName: project.displayName || project.name,
        revision: project.revision,
        updatedAt: project.updated,
        lifecycle: { state: 'active' },
        sourceRef: configProjectResourceRef(project),
    };
}

const CONFIG_PROJECT_TARGET_BY_REPRESENTATION = Object.freeze({
    'surge-config': 'surge',
    'qx-config': 'qx',
    'clash-config': 'clash',
    'loon-config': 'loon',
});

async function produceConfigProject(input = {}) {
    const project = requireConfigProject(input);
    const explicitRepresentation =
        typeof input.representation === 'string' && input.representation;
    const target = explicitRepresentation
        ? CONFIG_PROJECT_TARGET_BY_REPRESENTATION[explicitRepresentation]
        : normalizeTargetId(input.platform || input.target);
    if (!target)
        throw new RequestInvalidError(
            'RESOURCE_REPRESENTATION_UNSUPPORTED',
            `配置项目不支持 ${
                input.representation || input.platform || input.target || '(empty)'
            }`,
        );
    const representation = explicitRepresentation || `${target}-config`;
    const result = await generateProject({
        project,
        ruleSets: readConfigGeneratorStore().ruleSets,
        produceBuiltinArtifact: input.produceBuiltinArtifact,
        target,
    });
    return {
        result,
        output: {
            schema: 'substore.resource-output@1',
            ref: configProjectResourceRef(project),
            representation,
            body: result.body,
            mediaType:
                target === 'clash' ? 'application/yaml' : 'text/plain',
            sourceRevision: project.revision,
            freshness: { state: 'fresh' },
            diagnostics: [
                ...(result.warnings || []).map((item) => ({
                    ...item,
                    severity: 'warning',
                    code: item.code || 'CONFIG_GENERATOR_WARNING',
                })),
                ...(result.errors || []).map((item) => ({
                    ...item,
                    severity: 'error',
                    code: item.code || 'CONFIG_GENERATOR_ERROR',
                })),
            ],
        },
    };
}

async function resourceRuleSetItems() {
    const listed = await resources.list({
        types: ['rule-set'],
        contracts: ['substore.rule-set@1'],
    });
    const descriptors = new Map(
        (listed || []).map((item) => [
            [
                item.ref?.providerId,
                item.ref?.providerContributionId,
                item.ref?.type,
                item.ref?.id,
                item.ref?.contract,
            ].join('\u0000'),
            item,
        ]),
    );
    const referenced = readConfigGeneratorStore().ruleSets.filter(
        isResourceRuleSet,
    );
    await Promise.all(
        referenced.map(async (ruleSet) => {
            const ref = ruleSet.source.ref;
            const key = [
                ref?.providerId,
                ref?.providerContributionId,
                ref?.type,
                ref?.id,
                ref?.contract,
            ].join('\u0000');
            if (descriptors.has(key)) return;
            try {
                descriptors.set(key, await resources.get(ref));
            } catch (error) {
                descriptors.set(key, {
                    schema: 'substore.resource-descriptor@1',
                    ref,
                    name:
                        ruleSet.source.lastKnownName ||
                        ruleSet.name ||
                        ref?.id,
                    displayName:
                        ruleSet.source.lastKnownName ||
                        ruleSet.name ||
                        ref?.id,
                    contracts: ref?.contract ? [ref.contract] : [],
                    representations: [],
                    lifecycle: { state: 'active' },
                    availability: {
                        status: 'missing',
                        reasonCode:
                            error?.code || 'RESOURCE_PROVIDER_UNAVAILABLE',
                    },
                });
            }
        }),
    );
    return [...descriptors.values()];
}

async function listResourceRuleSets(req, res) {
    try {
        success(res, await resourceRuleSetItems());
    } catch (error) {
        failed(res, errorFrom(error), error?.statusCode || 400);
    }
}

function parseName(req) {
    return decodeURIComponent(req.params.name);
}

async function projectHealth(req, res) {
    try {
        const store = readConfigGeneratorStore();
        const name = parseName(req);
        const project = findByName(store.projects, name);
        if (!project)
            throw new ResourceNotFoundError(
                'CONFIG_GENERATOR_PROJECT_NOT_FOUND',
                '找不到配置项目',
            );
        success(
            res,
            await diagnoseConfigProject({
                project,
                ruleSets: store.ruleSets,
                getResourceDescriptor: (ref) => resources.get(ref),
            }),
        );
    } catch (error) {
        failed(
            res,
            errorFrom(error),
            error instanceof ResourceNotFoundError ? 404 : 400,
        );
    }
}

function resolveTargetHandler(target) {
    const handler = TARGET_HANDLERS[normalizeTargetId(target || 'surge')];
    if (handler) return handler;
    throw new RequestInvalidError(
        'UNSUPPORTED_EXTENSION_PLATFORM',
        `Config generator does not support ${target}`,
    );
}

async function downloadCachedRuleSet(url) {
    const cacheKey = `${CONFIG_GENERATOR_RULE_SET_CACHE_PREFIX}${hex_md5(url)}`;
    const cached = cache.get(cacheKey);
    if (cached !== null && cached !== undefined) return cached;

    const response = await runBackendRequestTask(
        () => network.get({ url }),
        'config-generator-rule-set',
    );
    const statusCode = Number(response?.statusCode || 0);
    if (statusCode && (statusCode < 200 || statusCode >= 400)) {
        throw new Error(`HTTP ${statusCode}`);
    }
    const body = `${response?.body ?? ''}`;
    if (!body.trim()) throw new Error('Remote rule-set content is empty');
    cache.set(cacheKey, body);
    return body;
}

async function generateProject({
    project,
    ruleSets,
    produceBuiltinArtifact,
    target,
}) {
    const handler = resolveTargetHandler(target);
    const resourceProjection = await projectResourceRuleSets({
        project,
        ruleSets,
        target: handler.route,
    });
    const result = await handler.generate({
        project,
        ruleSets: resourceProjection.ruleSets,
        produceBuiltinArtifact,
        downloadRuleSet: async (url) =>
            resourceProjection.bodies.has(url)
                ? resourceProjection.bodies.get(url)
                : downloadCachedRuleSet(url),
    });
    const transformed = await transform.processResponse(
        { status: 200, headers: {}, body: result.body },
        project.process || [],
        handler.platform,
        { type: 'config-project', name: project.name },
    );
    return {
        ...result,
        body: transformed.body,
        warnings: [
            ...(result.warnings || []),
            ...resourceProjection.warnings,
        ],
        errors: [...(result.errors || []), ...resourceProjection.errors],
        resourceOutputs: [...resourceProjection.outputs.entries()].map(
            ([ruleSet, output]) => ({
                ruleSet,
                sourceRevision: output.sourceRevision,
                representation: output.representation,
                freshness: output.freshness,
            }),
        ),
    };
}

function scheduleProjectReferenceReplace(project, ruleSets) {
    Promise.resolve()
        .then(() => replaceProjectResourceReferences(project, ruleSets))
        .catch(() => undefined);
}

function scheduleProjectReferenceClear(projectName) {
    Promise.resolve()
        .then(() => clearProjectResourceReferences(projectName))
        .catch(() => undefined);
}

function scheduleReferenceRepair() {
    Promise.resolve()
        .then(() => repairConfigGeneratorReferences())
        .catch(() => undefined);
}

function importConfig(req, res, handler) {
    try {
        success(
            res,
            handler.importConfig(
                req.body?.content || '',
                req.body?.sourceContext || req.body?.remoteProxySources,
            ),
        );
    } catch (error) {
        failed(res, errorFrom(error), 400);
    }
}

function createProject(req, res) {
    try {
        const store = readConfigGeneratorStore();
        validateProject(req.body, store.ruleSets);
        if (findByName(store.projects, req.body.name))
            throw new RequestInvalidError(
                'CONFIG_GENERATOR_PROJECT_EXISTS',
                `项目 ${req.body.name} 已存在`,
            );
        const project = { ...req.body, revision: 1, updated: Date.now() };
        store.projects.push(project);
        writeConfigGeneratorStore(store);
        scheduleProjectReferenceReplace(project, store.ruleSets);
        success(res, project, 201);
    } catch (error) {
        failed(
            res,
            errorFrom(error),
            error instanceof RequestInvalidError ? 400 : 400,
        );
    }
}

function updateProject(req, res) {
    try {
        const store = readConfigGeneratorStore();
        const name = parseName(req);
        const current = findByName(store.projects, name);
        if (!current)
            throw new ResourceNotFoundError(
                'CONFIG_GENERATOR_PROJECT_NOT_FOUND',
                `找不到项目 ${name}`,
            );
        const next = {
            ...current,
            ...req.body,
            name: current.name,
            revision: (current.revision || 0) + 1,
            updated: Date.now(),
        };
        validateProject(next, store.ruleSets);
        updateByName(store.projects, name, next);
        writeConfigGeneratorStore(store);
        scheduleProjectReferenceReplace(next, store.ruleSets);
        success(res, next);
    } catch (error) {
        failed(
            res,
            errorFrom(error),
            error instanceof ResourceNotFoundError ? 404 : 400,
        );
    }
}

function deleteProject(req, res) {
    try {
        const store = readConfigGeneratorStore();
        const name = parseName(req);
        if (!findByName(store.projects, name))
            throw new ResourceNotFoundError(
                'CONFIG_GENERATOR_PROJECT_NOT_FOUND',
                `找不到项目 ${name}`,
            );
        const artifactReferences = resources
            .listArtifacts()
            .filter(
                (artifact) =>
                    artifact.type === 'config-project' &&
                    artifact.source === name,
            )
            .map((artifact) => artifact.name);
        if (artifactReferences.length) {
            throw new RequestInvalidError(
                'CONFIG_GENERATOR_PROJECT_IN_USE',
                `项目 ${name} 正被远程配置引用`,
                { references: artifactReferences },
            );
        }
        deleteByName(store.projects, name);
        writeConfigGeneratorStore(store);
        scheduleProjectReferenceClear(name);
        success(res, { name });
    } catch (error) {
        failed(
            res,
            errorFrom(error),
            error instanceof ResourceNotFoundError ? 404 : 400,
        );
    }
}

function createRuleSet(req, res) {
    try {
        const store = readConfigGeneratorStore();
        validateRuleSet(req.body);
        if (findByName(store.ruleSets, req.body.name))
            throw new RequestInvalidError(
                'CONFIG_GENERATOR_RULE_SET_EXISTS',
                `规则集 ${req.body.name} 已存在`,
            );
        store.ruleSets.push({ ...req.body });
        writeConfigGeneratorStore(store);
        scheduleReferenceRepair();
        success(res, req.body, 201);
    } catch (error) {
        failed(res, errorFrom(error), 400);
    }
}

function updateRuleSet(req, res) {
    try {
        const store = readConfigGeneratorStore();
        const name = parseName(req);
        const current = findByName(store.ruleSets, name);
        if (!current)
            throw new ResourceNotFoundError(
                'CONFIG_GENERATOR_RULE_SET_NOT_FOUND',
                `找不到规则集 ${name}`,
            );
        const next = { ...current, ...req.body, name: current.name };
        validateRuleSet(next);
        updateByName(store.ruleSets, name, next);
        writeConfigGeneratorStore(store);
        scheduleReferenceRepair();
        success(res, next);
    } catch (error) {
        failed(
            res,
            errorFrom(error),
            error instanceof ResourceNotFoundError ? 404 : 400,
        );
    }
}

function deleteRuleSet(req, res) {
    try {
        const store = readConfigGeneratorStore();
        const name = parseName(req);
        const references = store.projects
            .filter((project) =>
                (project.rules || []).some(
                    (rule) => rule.kind === 'remote' && rule.ruleSet === name,
                ),
            )
            .map((project) => project.name);
        if (references.length)
            throw new RequestInvalidError(
                'CONFIG_GENERATOR_RULE_SET_IN_USE',
                `规则集 ${name} 正被项目引用`,
                { references },
            );
        if (!findByName(store.ruleSets, name))
            throw new ResourceNotFoundError(
                'CONFIG_GENERATOR_RULE_SET_NOT_FOUND',
                `找不到规则集 ${name}`,
            );
        deleteByName(store.ruleSets, name);
        writeConfigGeneratorStore(store);
        scheduleReferenceRepair();
        success(res, { name });
    } catch (error) {
        failed(
            res,
            errorFrom(error),
            error instanceof ResourceNotFoundError ? 404 : 409,
        );
    }
}

async function preview(req, res, produceBuiltinArtifact, target) {
    try {
        const body = req.body || {};
        const store = readConfigGeneratorStore();
        const project = body.project || findByName(store.projects, body.name);
        if (!project)
            throw new ResourceNotFoundError(
                'CONFIG_GENERATOR_PROJECT_NOT_FOUND',
                '找不到配置项目',
            );
        const result = await generateProject({
            project,
            ruleSets: body.ruleSets || store.ruleSets,
            produceBuiltinArtifact,
            target,
        });
        success(res, result);
    } catch (error) {
        failed(
            res,
            errorFrom(error),
            error instanceof ResourceNotFoundError ? 404 : 400,
        );
    }
}

async function downloadProject(req, res, produceBuiltinArtifact, target) {
    try {
        const store = readConfigGeneratorStore();
        const project = findByName(store.projects, parseName(req));
        if (!project)
            throw new ResourceNotFoundError(
                'CONFIG_GENERATOR_PROJECT_NOT_FOUND',
                '找不到配置项目',
            );
        const explicitTarget =
            target ||
            req.query?.platform ||
            req.params?.target ||
            req.query?.target;
        const requestForResolution = req.params?.target
            ? {
                  ...req,
                  query: {
                      ...(req.query || {}),
                      target: req.params.target,
                  },
              }
            : req;
        const resolvedTarget = hostRequest.resolveClientTarget(
            requestForResolution,
        );
        const automaticallyDetectedTarget = {
            Surge: 'surge',
            SurgeMac: 'surge',
            QX: 'qx',
            Clash: 'clash',
            ClashMeta: 'clash',
            Loon: 'loon',
        }[resolvedTarget?.value];
        const downloadTarget = explicitTarget
            ? resolvedTarget?.value || explicitTarget
            : automaticallyDetectedTarget || 'surge';
        const result = await generateProject({
            project,
            ruleSets: store.ruleSets,
            produceBuiltinArtifact,
            target: downloadTarget,
        });
        res.type('text/plain').send(result.body);
    } catch (error) {
        failed(
            res,
            errorFrom(error),
            error instanceof ResourceNotFoundError ? 404 : 400,
        );
    }
}

function isFlattenableRemoteProxyGroup(group) {
    return Boolean(
        group &&
            !group.disabled &&
            !(group.members || []).length &&
            !group.includeAllProxies &&
            !(group.includeOtherGroups || []).length &&
            !group.nodeNameRegex,
    );
}

function serverFilterGroup(project, sourceName, targetId, groupName) {
    if (!groupName) return null;
    if (targetId !== 'clash') {
        throw new RequestInvalidError(
            'REMOTE_PROXY_SOURCE_FILTER_TARGET_UNSUPPORTED',
            '远程订阅来源的服务端策略组筛选目前仅用于 Clash 兼容转换',
        );
    }

    const group = findByName(project.groups || [], groupName);
    if (!group || group.disabled) {
        throw new RequestInvalidError(
            'REMOTE_PROXY_SOURCE_FILTER_GROUP_NOT_FOUND',
            `找不到可用的策略组 ${groupName}`,
        );
    }
    const regex = `${group.nodeNameRegex || ''}`.trim();
    if (!regex) {
        throw new RequestInvalidError(
            'REMOTE_PROXY_SOURCE_FILTER_GROUP_REGEX_MISSING',
            `策略组 ${groupName} 没有可用于服务端筛选的节点名称正则`,
        );
    }
    try {
        new RegExp(regex);
    } catch (_) {
        throw new RequestInvalidError(
            'REMOTE_PROXY_SOURCE_FILTER_GROUP_REGEX_INVALID',
            `策略组 ${groupName} 的节点名称正则无效`,
        );
    }

    const sourceContext = createRemoteProxySourceContext(project);
    const directProjection = projectGroupRemoteProxySource(
        group,
        targetId,
        sourceContext,
    );
    const directMatch =
        directProjection.status === 'ready' &&
        directProjection.source?.name === sourceName;
    const inheritedMatch = (group.includeOtherGroups || []).some(
        (includedName) => {
            const includedGroup = findByName(
                project.groups || [],
                includedName,
            );
            if (!isFlattenableRemoteProxyGroup(includedGroup)) return false;
            const projection = projectGroupRemoteProxySource(
                includedGroup,
                targetId,
                sourceContext,
            );
            return (
                projection.status === 'ready' &&
                projection.source?.name === sourceName
            );
        },
    );
    if (!directMatch && !inheritedMatch) {
        throw new RequestInvalidError(
            'REMOTE_PROXY_SOURCE_FILTER_GROUP_MISMATCH',
            `策略组 ${groupName} 没有引用远程订阅来源 ${sourceName}`,
        );
    }
    return group;
}

async function downloadRemoteProxySource(req, res, produceBuiltinArtifact) {
    try {
        const store = readConfigGeneratorStore();
        const projectName = parseName(req);
        const project = findByName(store.projects, projectName);
        if (!project) {
            throw new ResourceNotFoundError(
                'CONFIG_GENERATOR_PROJECT_NOT_FOUND',
                `找不到配置项目 ${projectName}`,
            );
        }

        const sourceName = req.params.source;
        const source = findByName(project.remoteProxySources || [], sourceName);
        if (!source) {
            throw new ResourceNotFoundError(
                'CONFIG_GENERATOR_REMOTE_PROXY_SOURCE_NOT_FOUND',
                `找不到远程订阅来源 ${sourceName}`,
            );
        }
        if (source.enabled === false) {
            throw new RequestInvalidError(
                'REMOTE_PROXY_SOURCE_DISABLED',
                `远程订阅来源 ${sourceName} 已停用`,
            );
        }
        if (
            source.source?.kind !== 'url' ||
            !isAutomaticRemoteProxySource(source)
        ) {
            throw new RequestInvalidError(
                'REMOTE_PROXY_SOURCE_NOT_AUTOMATIC',
                `远程订阅来源 ${sourceName} 未启用 Sub-Store 自动转换`,
            );
        }

        const targetId = normalizeTargetId(req.params.target);
        const handler = resolveTargetHandler(targetId);
        const filterGroupName = Array.isArray(req.query?.group)
            ? req.query.group[0]
            : req.query?.group;
        const filterGroup = serverFilterGroup(
            project,
            sourceName,
            targetId,
            `${filterGroupName || ''}`.trim(),
        );
        const output = await produceBuiltinArtifact({
            type: 'subscription',
            url: source.source.url,
            platform: handler.platform,
            subscription: {
                name: `config-project:${project.name}:${source.name}${
                    filterGroup ? `:${filterGroup.name}` : ''
                }`,
                displayName: source.name,
                source: 'remote',
                url: source.source.url,
                process: filterGroup
                    ? [
                          {
                              type: 'Regex Filter',
                              args: {
                                  regex: [filterGroup.nodeNameRegex],
                                  keep: true,
                              },
                          },
                      ]
                    : [],
                noFlow: true,
            },
            produceOpts:
                targetId === 'surge'
                    ? {
                          'include-unsupported-proxy':
                              project.outputs?.surge?.includeUnsupportedProxy,
                      }
                    : {},
            noFlow: true,
        });
        if (
            output === undefined ||
            output === null ||
            (typeof output === 'string' && !output.trim()) ||
            (Array.isArray(output) && !output.length)
        ) {
            const error = new Error(
                `远程订阅来源 ${sourceName} 未生成可用于 ${handler.platform} 的节点`,
            );
            error.code = 'REMOTE_PROXY_SOURCE_TARGET_EMPTY';
            throw error;
        }
        res.type('text/plain').send(output);
    } catch (error) {
        failed(
            res,
            errorFrom(error),
            error instanceof ResourceNotFoundError
                ? 404
                : error instanceof RequestInvalidError
                ? 400
                : 502,
        );
    }
}

async function downloadRuleSetArtifact(req, res) {
    try {
        const store = readConfigGeneratorStore();
        const projectName = parseName(req);
        const project = findByName(store.projects, projectName);
        if (!project) {
            throw new ResourceNotFoundError(
                'CONFIG_GENERATOR_PROJECT_NOT_FOUND',
                `找不到配置项目 ${projectName}`,
            );
        }
        const targetId = normalizeTargetId(req.params.target);
        if (!targetId)
            throw new RequestInvalidError(
                'CONFIG_GENERATOR_RULE_PROVIDER_TARGET_UNSUPPORTED',
                `不支持规则集目标 ${req.params.target}`,
            );
        const ruleSetName = decodeURIComponent(req.params.ruleSet);
        const ruleSet = findByName(store.ruleSets, ruleSetName);
        if (!ruleSet || ruleSet.enabled === false) {
            throw new ResourceNotFoundError(
                'CONFIG_GENERATOR_RULE_SET_NOT_FOUND',
                `找不到可用规则集 ${ruleSetName}`,
            );
        }
        if (isResourceRuleSet(ruleSet)) {
            const output = await produceResourceRuleSet(ruleSet, targetId);
            res.type(
                output.mediaType ||
                    (targetId === 'clash' ? 'text/yaml' : 'text/plain'),
            ).send(output.body);
            return;
        }
        if (targetId !== 'clash') {
            throw new RequestInvalidError(
                'CONFIG_GENERATOR_RULE_PROVIDER_TARGET_UNSUPPORTED',
                'URL 规则缓存目前仅用于 Clash；其他目标直接使用原始远程 URL',
            );
        }
        const resolution = resolveRuleSetSource(ruleSet, targetId);
        if (resolution.kind !== 'remote-url' || !resolution.url) {
            throw new RequestInvalidError(
                'CONFIG_GENERATOR_RULE_PROVIDER_UNAVAILABLE',
                `规则集 ${ruleSetName} 不能生成 Clash 远程规则缓存`,
            );
        }
        const content = await downloadCachedRuleSet(resolution.url);
        const clashOptions = ruleSet.targetOptions?.clash || {};
        const sanitized = sanitizeClashRuleProvider(content, {
            behavior: clashOptions.behavior || 'classical',
            format:
                resolution.inlineConversion === 'surge-rule-list'
                    ? 'text'
                    : clashOptions.format || 'yaml',
        });
        res.type('text/yaml').send(sanitized.body);
    } catch (error) {
        failed(
            res,
            errorFrom(error),
            error instanceof ResourceNotFoundError
                ? 404
                : error instanceof RequestInvalidError
                ? 400
                : 502,
        );
    }
}

export function registerConfigGeneratorRoutes(
    $app,
    { produceBuiltinArtifact },
) {
    $app.get('/api/extensions/config-generator/projects', (req, res) =>
        success(res, readConfigGeneratorStore().projects),
    );
    $app.post('/api/extensions/config-generator/projects', createProject);
    $app.get('/api/extensions/config-generator/project/:name', (req, res) => {
        const project = findByName(
            readConfigGeneratorStore().projects,
            parseName(req),
        );
        project
            ? success(res, project)
            : failed(
                  res,
                  new ResourceNotFoundError(
                      'CONFIG_GENERATOR_PROJECT_NOT_FOUND',
                      '找不到配置项目',
                  ),
                  404,
              );
    });
    $app.get(
        '/api/extensions/config-generator/project/:name/health',
        projectHealth,
    );
    $app.patch('/api/extensions/config-generator/project/:name', updateProject);
    $app.delete(
        '/api/extensions/config-generator/project/:name',
        deleteProject,
    );
    $app.get('/api/extensions/config-generator/rule-sets', (req, res) =>
        success(res, readConfigGeneratorStore().ruleSets),
    );
    $app.get(
        '/api/extensions/config-generator/resource-rule-sets',
        listResourceRuleSets,
    );
    $app.post('/api/extensions/config-generator/rule-sets', createRuleSet);
    $app.patch(
        '/api/extensions/config-generator/rule-set/:name',
        updateRuleSet,
    );
    $app.delete(
        '/api/extensions/config-generator/rule-set/:name',
        deleteRuleSet,
    );
    TARGET_HANDLER_LIST.forEach((handler) => {
        $app.post(
            `/api/extensions/config-generator/preview/${handler.route}`,
            (req, res) =>
                preview(req, res, produceBuiltinArtifact, handler.platform),
        );
    });
    TARGET_HANDLER_LIST.forEach((handler) => {
        $app.post(
            `/api/extensions/config-generator/import/${handler.route}`,
            (req, res) => importConfig(req, res, handler),
        );
    });
    $app.get(
        '/download/config-project/:name/proxy-source/:source/:target',
        (req, res) =>
            downloadRemoteProxySource(req, res, produceBuiltinArtifact),
    );
    $app.get(
        '/download/config-project/:name/rule-set/:ruleSet/:target',
        downloadRuleSetArtifact,
    );
    $app.get('/download/config-project/:name/:target', (req, res) =>
        downloadProject(req, res, produceBuiltinArtifact),
    );
    $app.get('/download/config-project/:name', (req, res) =>
        downloadProject(req, res, produceBuiltinArtifact),
    );
}

export const configGeneratorArtifactSource = {
    id: 'org.substore.config-generator.config-project',
    type: 'config-project',
    contract: 'substore.config-project@1',
    representations: [
        'surge-config',
        'qx-config',
        'clash-config',
        'loon-config',
    ],
    labelKey: 'configGenerator.artifactSource',
    platforms: TARGET_HANDLER_LIST.map((handler) => handler.platform),
    list: projectItems,
    get: projectDescriptor,
    findSourceConfig: (name) =>
        findByName(readConfigGeneratorStore().projects, name),
    collectDependencies: (name) => {
        const project = findByName(readConfigGeneratorStore().projects, name);
        return project?.embeddedSource ? [project.embeddedSource] : [];
    },
    async produce(input) {
        const produced = await produceConfigProject(input);
        return input?.representation ? produced.output : produced.output.body;
    },
    async produceForSync(input) {
        const { output } = await produceConfigProject(input);
        return {
            body: output.body,
            sourceRevision: output.sourceRevision,
            diagnostics: output.diagnostics,
            assertFresh() {
                if (output.freshness?.state === 'stale') {
                    throw new RequestInvalidError(
                        'RESOURCE_STALE',
                        '配置项目当前使用 stale 资源',
                    );
                }
            },
        };
    },
};

export const configGeneratorExtension = Object.freeze({
    id: 'config-generator',
    extensionId: manifest.id,
    manifest,
    feature: 'configGenerator',
    registerRoutes: registerConfigGeneratorRoutes,
    artifactSources: [configGeneratorArtifactSource],
});

export default registerConfigGeneratorRoutes;
