import {
    ConfigGeneratorValidationError,
    validateProject,
} from '@/extensions/config-generator/validation';
import {
    parseProfileSections,
    serializeProfileSections,
} from '@/extensions/config-generator/core/profile-sections';
import {
    normalizeTargetId,
    resolvePolicyGroupCapability,
    resolvedPolicyGroupSupportsField,
} from '@/extensions/config-generator/core/target-capabilities';
import {
    policyGroupCapabilityDiagnostics,
    projectIncludedPolicyGroups,
} from '@/extensions/config-generator/core/policy-group-projection';
import { resolveRuleSetSource } from '@/extensions/config-generator/core/rule-set-source-resolver';
import { getExplicitRuleBindingName } from '@/extensions/config-generator/core/rule-binding-name';
import { separateSectionBlocks } from '@/extensions/config-generator/core/section-lines';
import { mergeNamedLines } from '@/extensions/config-generator/core/named-entry-merge';
import {
    createRemoteProxySourceContext,
    isAutomaticRemoteProxySource,
    projectGroupRemoteProxySource,
    remoteProxySourceFallbackWarning,
    remoteProxySourceOutputUrl,
    remoteProxySourceWarning,
} from '@/extensions/config-generator/core/remote-proxy-source';

const DEFAULT_QX_INDEPENDENT_CONFIG =
    '[general]\nresource_parser_url=https://raw.githubusercontent.com/KOP-XIAO/QuantumultX/master/Scripts/resource-parser.js\n\n[dns]\n\n[mitm]\n';
const QX_MANAGED_SECTIONS = new Set([
    'server_local',
    'server_remote',
    'policy',
    'filter_local',
    'filter_remote',
]);

const QX_RULE_TYPES = {
    DOMAIN: 'host',
    'DOMAIN-SUFFIX': 'host-suffix',
    'DOMAIN-KEYWORD': 'host-keyword',
    'IP-CIDR': 'ip-cidr',
    'IP-CIDR6': 'ip6-cidr',
    GEOIP: 'geoip',
    'IP-ASN': 'ip-asn',
    'USER-AGENT': 'user-agent',
    'URL-REGEX': 'url-regex',
};

function escapeRegex(value) {
    return `${value}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function qxRulePolicy(policy) {
    if (policy === 'DIRECT') return 'direct';
    if (policy === 'REJECT') return 'reject';
    return policy;
}

function qxPolicyGroupName(line) {
    const trimmed = line.trim();
    if (
        !trimmed ||
        trimmed.startsWith('#') ||
        trimmed.startsWith(';') ||
        trimmed.startsWith('//')
    )
        return undefined;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) return undefined;
    const name = trimmed
        .slice(separator + 1)
        .split(',')[0]
        .trim();
    return name || undefined;
}

function createRemoteSourceInheritance(project, sourceContext) {
    const enabledGroups = (project.groups || []).filter(
        (group) => !group.disabled,
    );
    const sourceProjections = new Map(
        enabledGroups.map((group) => [
            group.name,
            projectGroupRemoteProxySource(group, 'qx', sourceContext),
        ]),
    );
    const flattenableSourceGroups = new Map();
    enabledGroups.forEach((group) => {
        const projection = sourceProjections.get(group.name);
        if (
            projection?.status === 'ready' &&
            !(group.members || []).length &&
            !group.includeAllProxies &&
            !(group.includeOtherGroups || []).length &&
            !group.nodeNameRegex
        ) {
            flattenableSourceGroups.set(group.name, projection);
        }
    });
    return { sourceProjections, flattenableSourceGroups };
}

function groupOptions(group, sourceContext, sourceInheritance, warnings) {
    const capability = resolvePolicyGroupCapability('qx', group.type);
    if (!capability) {
        warnings.push({
            path: `groups.${group.name}`,
            message: `Quantumult X does not support the ${group.type} policy group type`,
        });
        return null;
    }
    warnings.push(...policyGroupCapabilityDiagnostics(group, capability));

    let outputType = capability.outputType;
    const values = [`${outputType}=${group.name}`];
    const memberValues = new Set();
    if (capability.members === 'ordered') {
        (group.members || []).forEach((member) => {
            if (memberValues.has(member.value)) return;
            memberValues.add(member.value);
            values.push(member.value);
        });
    }
    const inheritedSourceProjections = [];
    const flattenedIncludedGroups = new Set();
    if (capability.fields?.resourceTagRegex) {
        (group.includeOtherGroups || []).forEach((name) => {
            const inherited =
                sourceInheritance.flattenableSourceGroups.get(name);
            if (!inherited) return;
            inheritedSourceProjections.push(inherited);
            flattenedIncludedGroups.add(name);
        });
    }
    const includedGroups = projectIncludedPolicyGroups(
        {
            ...group,
            includeOtherGroups: (group.includeOtherGroups || []).filter(
                (name) => !flattenedIncludedGroups.has(name),
            ),
        },
        capability,
        'qx',
    );
    includedGroups.members.forEach((name) => {
        if (memberValues.has(name)) return;
        memberValues.add(name);
        values.push(name);
    });
    warnings.push(...includedGroups.diagnostics);
    let hasCandidates = memberValues.size > 0;

    const sourceProjection =
        sourceInheritance.sourceProjections.get(group.name) ||
        projectGroupRemoteProxySource(group, 'qx', sourceContext);
    const qxOptions = group.targetOptions?.qx || {};
    const readySourceProjections = [];
    if (sourceProjection.status !== 'none') {
        if (sourceProjection.status === 'unsupported-field') {
            warnings.push({
                path: sourceProjection.path,
                message: `Quantumult X ${capability.outputType} does not support resource-tag-regex; the remote proxy source was omitted.`,
            });
        } else if (
            sourceProjection.status === 'missing' ||
            sourceProjection.status === 'incompatible'
        ) {
            warnings.push({
                path: sourceProjection.path,
                message: remoteProxySourceWarning(sourceProjection, 'qx'),
            });
        } else if (sourceProjection.status === 'disabled') {
            warnings.push({
                path: sourceProjection.path,
                message:
                    'The Quantumult X remote proxy source is disabled and was omitted.',
            });
        } else if (sourceProjection.status === 'ready') {
            readySourceProjections.push(sourceProjection);
            const fallbackWarning =
                remoteProxySourceFallbackWarning(sourceProjection);
            if (fallbackWarning) {
                warnings.push({
                    path: sourceProjection.path,
                    message: fallbackWarning,
                });
            }
        }
    }
    inheritedSourceProjections.forEach((projection) => {
        readySourceProjections.push(projection);
        const fallbackWarning = remoteProxySourceFallbackWarning(projection);
        if (fallbackWarning) {
            warnings.push({
                path: `groups.${group.name}.includeOtherGroups`,
                message: fallbackWarning,
            });
        }
    });
    const sourceTags = [
        ...new Set(
            readySourceProjections.map(
                (projection) =>
                    projection.source.targetOptions?.qx?.tag ||
                    projection.source.name,
            ),
        ),
    ];
    const usesRegexCandidates = Boolean(
        sourceTags.length ||
            (sourceProjection.status === 'none' &&
                qxOptions.resourceTagRegex) ||
            group.includeAllProxies ||
            group.nodeNameRegex,
    );
    if (usesRegexCandidates && capability.regexCandidateFallback) {
        outputType = capability.regexCandidateFallback;
        values[0] = `${outputType}=${group.name}`;
        warnings.push({
            path: `groups.${group.name}.type`,
            message: `The official Quantumult X sample only documents resource-tag-regex and server-tag-regex for static, available, and round-robin policies; ${capability.outputType} fell back to ${outputType} so the remote node set remains correctly scoped.`,
        });
    }
    if (sourceTags.length) {
        const sourceRegex =
            sourceTags.length === 1
                ? `^${escapeRegex(sourceTags[0])}$`
                : `^(?:${sourceTags.map(escapeRegex).join('|')})$`;
        values.push(`resource-tag-regex=${sourceRegex}`);
        hasCandidates = true;
    } else if (sourceProjection.status === 'none' && qxOptions.resourceTagRegex) {
        if (capability.fields?.resourceTagRegex) {
            values.push(`resource-tag-regex=${qxOptions.resourceTagRegex}`);
            hasCandidates = true;
        } else {
            warnings.push({
                path: `groups.${group.name}.targetOptions.qx.resourceTagRegex`,
                message: `Quantumult X ${capability.outputType} does not support resource-tag-regex; it was omitted.`,
            });
        }
    }
    if (group.includeAllProxies) {
        if (capability.fields?.includeAllProxies) {
            values.push(`server-tag-regex=${group.nodeNameRegex || '.*'}`);
            hasCandidates = true;
        } else {
            warnings.push({
                path: `groups.${group.name}.includeAllProxies`,
                message: `Quantumult X ${capability.outputType} does not support including all proxies; it was omitted.`,
            });
        }
    } else if (group.nodeNameRegex) {
        if (capability.fields?.nodeNameRegex) {
            values.push(`server-tag-regex=${group.nodeNameRegex}`);
            hasCandidates = true;
        } else {
            warnings.push({
                path: `groups.${group.name}.nodeNameRegex`,
                message: `Quantumult X ${capability.outputType} does not support server-tag-regex; it was omitted.`,
            });
        }
    }
    if (group.interval !== undefined) {
        if (outputType === 'url-latency-benchmark') {
            values.push(`check-interval=${group.interval}`);
        } else {
            warnings.push({
                path: `groups.${group.name}.interval`,
                message:
                    'Quantumult X check-interval is only supported by url-latency-benchmark groups; it was omitted.',
            });
        }
    }
    if (group.tolerance !== undefined) {
        if (outputType === 'url-latency-benchmark') {
            values.push(`tolerance=${group.tolerance}`);
        } else {
            warnings.push({
                path: `groups.${group.name}.tolerance`,
                message:
                    'Quantumult X tolerance is only supported by url-latency-benchmark groups; it was omitted.',
            });
        }
    }
    if (qxOptions.aliveChecking !== undefined) {
        if (outputType === 'url-latency-benchmark') {
            values.push(
                `alive-checking=${qxOptions.aliveChecking ? 'true' : 'false'}`,
            );
        } else {
            warnings.push({
                path: `groups.${group.name}.targetOptions.qx.aliveChecking`,
                message:
                    'Quantumult X alive-checking is only supported by url-latency-benchmark groups; it was omitted.',
            });
        }
    }
    if (group.timeout !== undefined) {
        warnings.push({
            path: `groups.${group.name}.timeout`,
            message:
                'Quantumult X policy groups do not support the Surge timeout option; it was omitted.',
        });
    }
    const iconUrl =
        group.iconUrl ||
        group.targetOptions?.qx?.iconUrl ||
        group.targetOptions?.surge?.iconUrl;
    if (iconUrl) values.push(`img-url=${iconUrl}`);
    if (group.testUrl) {
        warnings.push({
            path: `groups.${group.name}.testUrl`,
            message:
                'Quantumult X policy groups use the client server-check URL; a per-group test URL was omitted',
        });
    }
    if (group.targetOptions?.surge?.evaluateBeforeUse !== undefined) {
        warnings.push({
            path: `groups.${group.name}.targetOptions.surge.evaluateBeforeUse`,
            message:
                'Quantumult X policy groups do not support Surge evaluate-before-use; it was omitted.',
        });
    }
    if (!hasCandidates) {
        throw new ConfigGeneratorValidationError([
            {
                path: `groups.${group.name}.members`,
                message: `Quantumult X ${outputType} has no usable policy members after target projection`,
            },
        ]);
    }
    return values.join(', ');
}

function remoteSources(project, sourceContext, warnings) {
    const { sourceMap } = sourceContext;
    const groupsBySource = new Map();
    const enabledGroups = (project.groups || []).filter(
        (group) => !group.disabled,
    );
    enabledGroups.forEach((group) => {
        const sourceProjection = projectGroupRemoteProxySource(
            group,
            'qx',
            sourceContext,
        );
        if (
            sourceProjection.status === 'ready' &&
            groupsBySource.has(sourceProjection.name)
        ) {
            groupsBySource.get(sourceProjection.name).groups.push(group);
        } else if (sourceProjection.status === 'ready') {
            groupsBySource.set(sourceProjection.name, {
                groups: [group],
                sourceBinding: sourceProjection,
            });
        }
    });

    const needsRawResourceSources = enabledGroups.some(
        (group) =>
            resolvedPolicyGroupSupportsField(
                'qx',
                group.type,
                'resourceTagRegex',
            ) && group.targetOptions?.qx?.resourceTagRegex,
    );
    if (needsRawResourceSources) {
        sourceMap.forEach((source, name) => {
            const compatible =
                source?.source?.kind === 'sub-store' ||
                (isAutomaticRemoteProxySource(source) &&
                    Boolean(
                        remoteProxySourceOutputUrl(source, 'qx', sourceContext),
                    )) ||
                (source?.source?.kind === 'url' &&
                    !isAutomaticRemoteProxySource(source) &&
                    normalizeTargetId(source.source.target) === 'qx');
            if (
                compatible &&
                source.enabled !== false &&
                !groupsBySource.has(name)
            ) {
                groupsBySource.set(name, {
                    groups: [],
                    sourceBinding: null,
                });
            }
        });
    }

    return [...groupsBySource.keys()]
        .map((name) => sourceMap.get(name))
        .filter((source) => source && source.enabled !== false)
        .map((source) => {
            const values = [
                remoteProxySourceOutputUrl(source, 'qx', sourceContext),
            ];
            const qx = source.targetOptions?.qx || {};
            const tag = qx.tag || source.name;
            values.push(`tag=${tag}`);
            const sourceUsage = groupsBySource.get(source.name);
            const groupIntervals = [
                ...new Set(
                    (sourceUsage?.groups || [])
                        .map((group) => group.policyUpdateInterval)
                        .filter((interval) => interval !== undefined),
                ),
            ].sort((left, right) => left - right);
            if (qx.updateInterval === undefined && groupIntervals.length > 1) {
                warnings.push({
                    path: `remoteProxySources.${source.name}.targetOptions.qx.updateInterval`,
                    message: `Multiple Quantumult X groups use remote proxy source ${
                        source.name
                    } with conflicting policyUpdateInterval values (${groupIntervals.join(
                        ', ',
                    )}); the smallest value ${
                        groupIntervals[0]
                    } was used because Quantumult X supports one update interval per remote source. Align the group intervals or set remoteProxySources.${
                        source.name
                    }.targetOptions.qx.updateInterval to override it.`,
                });
            }
            const interval =
                qx.updateInterval ??
                (groupIntervals.length ? groupIntervals[0] : undefined);
            if (interval !== undefined)
                values.push(`update-interval=${interval}`);
            const forceOptParser = Boolean(
                sourceUsage?.sourceBinding?.fallback?.forceOptParser,
            );
            if (forceOptParser || qx.optParser !== undefined)
                values.push(
                    `opt-parser=${
                        forceOptParser || qx.optParser ? 'true' : 'false'
                    }`,
                );
            return values.join(', ');
        });
}

function generateRules(project, ruleSets, warnings) {
    const byName = new Map(ruleSets.map((item) => [item.name, item]));
    const local = [];
    const remoteBlocks = [];
    let pendingTrivia = [];
    let currentRemotePolicy;
    let currentRemoteBlock = [];

    const finishRemoteBlock = () => {
        if (currentRemoteBlock.length) remoteBlocks.push(currentRemoteBlock);
        currentRemoteBlock = [];
        currentRemotePolicy = undefined;
    };
    const flushTriviaToLocal = () => {
        local.push(...pendingTrivia);
        pendingTrivia = [];
    };
    const triviaLine = (rule) => {
        if (rule.kind === 'blank') return '';
        const text = `${rule.text || ''}`.trim();
        return text.startsWith('#') ? text : `#${text ? ` ${text}` : ''}`;
    };

    (project.rules || []).forEach((rule, index) => {
        if (rule.disabled) return;
        if (rule.kind === 'comment' || rule.kind === 'blank') {
            pendingTrivia.push(triviaLine(rule));
            return;
        }

        let projection;
        if (rule.kind === 'final') {
            projection = {
                section: 'local',
                lines: [`final, ${qxRulePolicy(rule.policy)}`],
            };
        } else if (rule.kind === 'inline') {
            const type = QX_RULE_TYPES[rule.type];
            if (!type) {
                warnings.push({
                    path: `rules.${rule.type}`,
                    message: `Quantumult X does not support ${rule.type} as a local filter`,
                });
                return;
            }
            if (rule.noResolve) {
                warnings.push({
                    path: `rules.${rule.type}.noResolve`,
                    message:
                        'Quantumult X does not support Surge no-resolve on local filters',
                });
            }
            projection = {
                section: 'local',
                lines: [
                    `${type}, ${rule.value}, ${qxRulePolicy(rule.policy)}`,
                ],
            };
        } else if (rule.kind === 'remote') {
            const ruleSet = byName.get(rule.ruleSet);
            if (!ruleSet || ruleSet.enabled === false) return;
            const resolution = resolveRuleSetSource(ruleSet, 'qx');
            if (resolution.kind === 'unsupported') {
                warnings.push({
                    path: `rules.${rule.ruleSet}`,
                    message:
                        resolution.warning?.message ||
                        'Quantumult X cannot represent this rule-set source.',
                });
                return;
            }
            if (resolution.warning) {
                warnings.push({
                    path:
                        resolution.kind === 'remote-url'
                            ? `rules.${rule.ruleSet}.source.url`
                            : `rules.${rule.ruleSet}`,
                    message: resolution.warning.message,
                });
            }
            if (resolution.kind === 'inline-rules') {
                projection = {
                    section: 'local',
                    lines: resolution.rules.flatMap((item) => {
                        const type = QX_RULE_TYPES[item.type];
                        return type
                            ? [
                                  `${type}, ${item.value}, ${qxRulePolicy(
                                      rule.policy,
                                  )}`,
                              ]
                            : [];
                    }),
                };
            } else {
                const explicitName = getExplicitRuleBindingName(rule);
                const values = [];
                if (resolution.kind === 'qx-inserted') {
                    values.push(resolution.value);
                    if (explicitName) values.push(`tag=${explicitName}`);
                    values.push(
                        `force-policy=${qxRulePolicy(rule.policy)}`,
                        'inserted-resource=true',
                        'enabled=true',
                    );
                } else if (
                    resolution.kind === 'remote-url' &&
                    resolution.url
                ) {
                    values.push(resolution.url);
                    if (explicitName) values.push(`tag=${explicitName}`);
                    values.push(`force-policy=${qxRulePolicy(rule.policy)}`);
                    if (ruleSet.updateInterval !== undefined) {
                        values.push(
                            `update-interval=${ruleSet.updateInterval}`,
                        );
                    }
                    const qx = ruleSet.targetOptions?.qx || {};
                    if (
                        resolution.forceOptParser ||
                        qx.optParser !== undefined
                    ) {
                        values.push(
                            `opt-parser=${
                                resolution.forceOptParser || qx.optParser
                                    ? 'true'
                                    : 'false'
                            }`,
                        );
                    } else if (!resolution.provider) {
                        values.push('opt-parser=true');
                    }
                    values.push('enabled=true');
                }
                if (values.length) {
                    projection = {
                        section: 'remote',
                        line: values.join(', '),
                        explicitName,
                    };
                }
            }
        }

        if (!projection) return;
        if (projection.section === 'local') {
            finishRemoteBlock();
            flushTriviaToLocal();
            local.push(...projection.lines);
            return;
        }

        if (
            pendingTrivia.length ||
            currentRemotePolicy !== rule.policy ||
            !currentRemoteBlock.length
        ) {
            finishRemoteBlock();
            currentRemoteBlock.push(...pendingTrivia);
            pendingTrivia = [];
            currentRemotePolicy = rule.policy;
            currentRemoteBlock.push(
                `# ==================== ${rule.policy} ====================`,
            );
        }
        if (projection.explicitName) {
            currentRemoteBlock.push(`# ${projection.explicitName}`);
        }
        currentRemoteBlock.push(projection.line);
    });
    finishRemoteBlock();
    flushTriviaToLocal();
    return { local, remote: separateSectionBlocks(remoteBlocks) };
}

function mergeIndependentConfig(content, sections) {
    const ast = parseProfileSections(content);
    const generatedSections = sections.map(([name, lines]) => ({
        title: `[${name}]`,
        name,
        body: lines,
    }));
    const existingPolicy = ast.sections.find(
        (section) => section.name === 'policy',
    );
    const generatedPolicy = generatedSections.find(
        (section) => section.name === 'policy',
    );
    if (existingPolicy && generatedPolicy) {
        existingPolicy.body = mergeNamedLines(
            existingPolicy.body,
            generatedPolicy.body,
            qxPolicyGroupName,
        );
    }
    ast.sections = ast.sections.filter(
        (section) =>
            !QX_MANAGED_SECTIONS.has(section.name) || section.name === 'policy',
    );
    const generated = existingPolicy
        ? generatedSections.filter((section) => section.name !== 'policy')
        : generatedSections;
    const mitmIndex = ast.sections.findIndex(
        (section) => section.name === 'mitm',
    );
    ast.sections.splice(
        mitmIndex < 0 ? ast.sections.length : mitmIndex,
        0,
        ...generated,
    );
    return serializeProfileSections(ast);
}

export async function generateQXConfig({
    project,
    ruleSets,
    produceBuiltinArtifact,
}) {
    validateProject(project, ruleSets, 'qx');
    const warnings = [];
    const sourceContext = createRemoteProxySourceContext(project);
    const sourceInheritance = createRemoteSourceInheritance(
        project,
        sourceContext,
    );
    const sections = [];
    if (project.embeddedSource) {
        const body = await produceBuiltinArtifact({
            type: project.embeddedSource.type,
            name: project.embeddedSource.name,
            platform: 'QX',
            produceOpts: {},
        });
        const lines = `${body || ''}`.split(/\r?\n/).filter(Boolean);
        if (lines.length) sections.push(['server_local', lines]);
    }

    const policyBlocks = (project.groups || [])
        .filter((group) => !group.disabled)
        .map((group) => {
            const line = groupOptions(
                group,
                sourceContext,
                sourceInheritance,
                warnings,
            );
            if (!line) return null;
            return [
                ...(group.remark ? [`# ${group.remark}`] : []),
                line,
            ];
        })
        .filter(Boolean);
    if (policyBlocks.length)
        sections.push(['policy', separateSectionBlocks(policyBlocks)]);

    const servers = remoteSources(project, sourceContext, warnings);
    if (servers.length) sections.push(['server_remote', servers]);

    const rules = generateRules(project, ruleSets, warnings);
    const local = rules.local;
    if (local.length) sections.push(['filter_local', local]);

    const remote = rules.remote;
    if (remote.length) sections.push(['filter_remote', remote]);

    const qx = project.outputs?.qx || {};
    const independentConfig =
        typeof qx.independentConfig === 'string'
            ? qx.independentConfig
            : DEFAULT_QX_INDEPENDENT_CONFIG;
    return {
        body: mergeIndependentConfig(independentConfig, sections),
        sourceRevision: project.revision,
        stats: {
            nodeCount:
                sections.find(([name]) => name === 'server_local')?.[1]
                    .length || 0,
            groupCount: policyBlocks.length,
            ruleCount:
                local.filter((line) => line && !line.startsWith('#')).length +
                remote.filter((line) => line && !line.startsWith('#')).length,
        },
        warnings,
        errors: [],
    };
}
