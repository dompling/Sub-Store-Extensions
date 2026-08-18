import YAML from '@/utils/yaml';
import {
    getTargetDisplayName,
    getTargetIds,
    resolvePolicyGroupCapability,
} from './core/target-capabilities';
import {
    projectIncludedPolicyGroups,
    projectPolicyGroupMembers,
} from './core/policy-group-projection';
import {
    createRemoteProxySourceContext,
    projectGroupRemoteProxySource,
    remoteProxySourceFallbackWarning,
    remoteProxySourceWarning,
} from './core/remote-proxy-source';
import { resolveRuleSetSource } from './core/rule-set-source-resolver';
import {
    isResourceRuleSet,
    projectPublicBaseUrl,
    ruleSetRepresentation,
} from './core/resource-rule-set';
import {
    ConfigGeneratorValidationError,
    validateProject,
} from './validation';

const BUILTIN_POLICIES = new Set(['DIRECT', 'REJECT']);
const STRICT_EMPTY_GROUP_TARGETS = new Set(['surge', 'qx']);
const TARGET_RULE_CAPABILITIES = Object.freeze({
    surge: {
        inlineRuleTypes: new Set([
            'DOMAIN',
            'DOMAIN-SUFFIX',
            'DOMAIN-KEYWORD',
            'IP-CIDR',
            'IP-CIDR6',
            'GEOIP',
            'IP-ASN',
            'USER-AGENT',
            'URL-REGEX',
            'PROCESS-NAME',
        ]),
        inlineNoResolveTypes: null,
        remoteNoResolve: true,
        dnsFailed: true,
    },
    qx: {
        inlineRuleTypes: new Set([
            'DOMAIN',
            'DOMAIN-SUFFIX',
            'DOMAIN-KEYWORD',
            'IP-CIDR',
            'IP-CIDR6',
            'GEOIP',
            'IP-ASN',
            'USER-AGENT',
            'URL-REGEX',
        ]),
        inlineNoResolveTypes: new Set(),
        remoteNoResolve: false,
        dnsFailed: false,
    },
    clash: {
        inlineRuleTypes: new Set([
            'DOMAIN',
            'DOMAIN-SUFFIX',
            'DOMAIN-KEYWORD',
            'IP-CIDR',
            'IP-CIDR6',
            'GEOIP',
            'PROCESS-NAME',
        ]),
        inlineNoResolveTypes: new Set([
            'IP-CIDR',
            'IP-CIDR6',
            'GEOIP',
        ]),
        remoteNoResolve: true,
        dnsFailed: false,
    },
    loon: {
        inlineRuleTypes: new Set([
            'DOMAIN',
            'DOMAIN-SUFFIX',
            'DOMAIN-KEYWORD',
            'IP-CIDR',
            'IP-CIDR6',
            'GEOIP',
            'IP-ASN',
            'USER-AGENT',
            'URL-REGEX',
        ]),
        inlineNoResolveTypes: new Set([
            'IP-CIDR',
            'IP-CIDR6',
            'GEOIP',
            'IP-ASN',
        ]),
        remoteNoResolve: false,
        dnsFailed: false,
    },
});

const SUGGESTIONS = Object.freeze({
    PROJECT_INVALID:
        'Open the project editor, correct the highlighted field, and run the health check again.',
    POLICY_REFERENCE_INVALID:
        'Replace the reference with DIRECT, REJECT, or an existing enabled policy group; otherwise create or re-enable the intended group.',
    POLICY_GROUP_UNSUPPORTED:
        'Use a policy-group type supported by this target, or change the referring rules so they do not depend on this group for that target.',
    POLICY_GROUP_FALLBACK:
        'Prefer select, url-test, or fallback when identical behavior across all four clients is required; otherwise review the target preview and accept the documented behavior change.',
    POLICY_GROUP_EMPTY:
        'Add DIRECT, REJECT, another enabled group, explicit proxies, include-all-proxies, or a compatible remote proxy source.',
    POLICY_GROUP_CYCLE:
        'Remove one group-to-group reference so policy-group dependencies form an acyclic graph.',
    POLICY_REGEX_INVALID:
        'Correct the regular expression or remove it. Test the expression before relying on it to select proxy nodes.',
    REMOTE_SOURCE_INVALID:
        'Select an existing enabled source whose format is compatible with this client, or enable automatic Sub-Store conversion with a reachable public base URL.',
    REMOTE_SOURCE_FALLBACK:
        'Bind a target-native or automatic Sub-Store source when exact cross-client behavior is required; otherwise confirm the parser fallback in preview.',
    RULE_SET_INVALID:
        'Select an existing enabled rule set that can produce this client format. Resource-backed rule sets also require a public delivery URL.',
    RULE_SET_FALLBACK:
        'Use a target-native rule-set representation for exact behavior, or review the converted output before keeping this fallback.',
    RULES_INCOMPLETE:
        'Keep FINAL as the last active rule and add a final policy when the project should have a catch-all decision.',
    DUPLICATE_ENTRY:
        'Remove the duplicate or rename it so each source, group, member, and rule is unambiguous.',
    UNUSED_ENTRY:
        'Delete the unused entry if it is obsolete, or reference it from an active rule or policy group if it is intentional.',
    INDEPENDENT_CONFIG_INVALID:
        'Correct the independent client configuration syntax. Clash independent configuration must be a YAML mapping.',
    TARGET_OPTION_OMITTED:
        'Move this behavior to the target independent configuration, or remove the option when cross-client portability is more important.',
    TARGET_DIAGNOSTIC:
        'Review the affected target preview and adjust the referenced group, rule, source, or target-specific option.',
});

function statusFromCounts(counts) {
    if (counts.error) return 'error';
    if (counts.warning) return 'warning';
    return 'healthy';
}

function countDiagnostics(diagnostics) {
    const counts = { error: 0, warning: 0, info: 0 };
    diagnostics.forEach((item) => {
        if (Object.prototype.hasOwnProperty.call(counts, item.severity)) {
            counts[item.severity] += 1;
        }
    });
    return counts;
}

function categoryFromPath(path = '') {
    if (path.startsWith('rules') || path.startsWith('ruleSets')) return 'rules';
    if (path.startsWith('groups')) return 'groups';
    if (path.startsWith('remoteProxySources') || path.startsWith('embeddedSource'))
        return 'sources';
    if (path.startsWith('outputs')) return 'outputs';
    return 'project';
}

function fixFromPath(path = '', target) {
    let section = 'subscriptions';
    if (path.startsWith('groups')) section = 'groups';
    else if (path.startsWith('rules') || path.startsWith('ruleSets'))
        section = 'ruleSets';
    else if (path.startsWith('outputs')) section = 'independent';
    return {
        section,
        ...(section === 'independent' && target ? { target } : {}),
    };
}

function createDiagnostic({
    code,
    severity,
    target,
    path,
    message,
    suggestion,
    category,
    details,
}) {
    return {
        code,
        severity,
        ...(target ? { target } : {}),
        ...(path ? { path } : {}),
        category: category || categoryFromPath(path),
        message,
        suggestion: suggestion || SUGGESTIONS[code] || SUGGESTIONS.TARGET_DIAGNOSTIC,
        fix: fixFromPath(path, target),
        ...(details ? { details } : {}),
    };
}

function normalizedLabel(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function indexedPath(path, root) {
    const match = new RegExp(`^${root}\\[(\\d+)\\](?:\\.(.*))?$`).exec(
        path || '',
    );
    if (!match) return null;
    return {
        index: Number(match[1]),
        field: match[2] || '',
    };
}

function namedPath(path, root, entries, getName = (entry) => entry?.name) {
    const prefix = `${root}.`;
    if (!path?.startsWith(prefix)) return null;
    const remainder = path.slice(prefix.length);
    const candidates = (entries || [])
        .map((entry, index) => ({
            entry,
            index,
            name: normalizedLabel(getName(entry)),
        }))
        .filter((entry) => entry.name)
        .sort((left, right) => right.name.length - left.name.length);
    const match = candidates.find(
        (entry) =>
            remainder === entry.name || remainder.startsWith(`${entry.name}.`),
    );
    if (!match) return null;
    return {
        ...match,
        field:
            remainder === match.name
                ? ''
                : remainder.slice(match.name.length + 1),
    };
}

function ruleLocation(rule, index, field) {
    const explicitName = normalizedLabel(rule?.name);
    let name = explicitName;
    if (!name && rule?.kind === 'remote') name = normalizedLabel(rule.ruleSet);
    if (!name && rule?.kind === 'inline') {
        name = [normalizedLabel(rule.type), normalizedLabel(rule.value)]
            .filter(Boolean)
            .join(' · ');
    }
    if (!name && rule?.kind === 'final') name = 'FINAL';
    if (!name && rule?.kind === 'comment') name = normalizedLabel(rule.text);
    return {
        kind: 'rule',
        index,
        name: name || `#${index + 1}`,
        field,
        ruleKind: rule?.kind,
        explicitName: Boolean(explicitName),
        ...(rule?.kind === 'remote' && normalizedLabel(rule.ruleSet)
            ? { referenceName: normalizedLabel(rule.ruleSet) }
            : {}),
    };
}

function namedEntityLocation(kind, entry, index, field) {
    const name =
        normalizedLabel(entry?.remark) ||
        normalizedLabel(entry?.displayName) ||
        normalizedLabel(entry?.name) ||
        `#${index + 1}`;
    const referenceName = normalizedLabel(entry?.name);
    return {
        kind,
        index,
        name,
        field,
        ...(referenceName && referenceName !== name ? { referenceName } : {}),
    };
}

function diagnosticLocation(path, project, ruleSets) {
    const projectName =
        normalizedLabel(project?.displayName) || normalizedLabel(project?.name);
    const rules = project?.rules || [];
    const groups = project?.groups || [];
    const sources = project?.remoteProxySources || [];

    const indexedRule = indexedPath(path, 'rules');
    if (indexedRule) {
        return ruleLocation(
            rules[indexedRule.index],
            indexedRule.index,
            indexedRule.field,
        );
    }
    const namedRule = namedPath(
        path,
        'rules',
        rules.filter((rule) => rule?.kind === 'remote'),
        (rule) => rule?.ruleSet,
    );
    if (namedRule) {
        const index = rules.indexOf(namedRule.entry);
        return ruleLocation(namedRule.entry, index, namedRule.field);
    }

    const indexedGroup = indexedPath(path, 'groups');
    if (indexedGroup) {
        return namedEntityLocation(
            'group',
            groups[indexedGroup.index],
            indexedGroup.index,
            indexedGroup.field,
        );
    }
    const namedGroup = namedPath(path, 'groups', groups);
    if (namedGroup) {
        return namedEntityLocation(
            'group',
            namedGroup.entry,
            namedGroup.index,
            namedGroup.field,
        );
    }

    const indexedRuleSet = indexedPath(path, 'ruleSets');
    if (indexedRuleSet) {
        return namedEntityLocation(
            'ruleSet',
            ruleSets[indexedRuleSet.index],
            indexedRuleSet.index,
            indexedRuleSet.field,
        );
    }
    const namedRuleSet = namedPath(path, 'ruleSets', ruleSets);
    if (namedRuleSet) {
        return namedEntityLocation(
            'ruleSet',
            namedRuleSet.entry,
            namedRuleSet.index,
            namedRuleSet.field,
        );
    }

    const indexedSource = indexedPath(path, 'remoteProxySources');
    if (indexedSource) {
        return namedEntityLocation(
            'source',
            sources[indexedSource.index],
            indexedSource.index,
            indexedSource.field,
        );
    }
    const namedSource = namedPath(path, 'remoteProxySources', sources);
    if (namedSource) {
        return namedEntityLocation(
            'source',
            namedSource.entry,
            namedSource.index,
            namedSource.field,
        );
    }

    const processPath = indexedPath(path, 'process');
    if (processPath) {
        return {
            kind: 'process',
            index: processPath.index,
            name: normalizedLabel(project?.process?.[processPath.index]?.id),
            field: processPath.field,
        };
    }

    const outputMatch = /^outputs(?:\.([^.]+))?(?:\.(.*))?$/.exec(path || '');
    if (outputMatch) {
        const target = getTargetIds().includes(outputMatch[1])
            ? outputMatch[1]
            : undefined;
        return {
            kind: target ? 'output' : 'outputs',
            ...(target ? { target } : {}),
            field: outputMatch[2] || '',
        };
    }

    if (path === 'rules') return { kind: 'rules', field: '' };
    if (path === 'groups') return { kind: 'groups', field: '' };
    if (path === 'ruleSets') return { kind: 'ruleSets', field: '' };
    if (path === 'remoteProxySources') return { kind: 'sources', field: '' };

    return {
        kind: 'project',
        ...(projectName ? { name: projectName } : {}),
        field: path || '',
    };
}

function validationCode(path, message) {
    const normalized = `${message || ''}`.toLowerCase();
    if (normalized.includes('acyclic')) return 'POLICY_GROUP_CYCLE';
    if (normalized.includes('regular expression')) return 'POLICY_REGEX_INVALID';
    if (
        normalized.includes('missing policy group') ||
        normalized.includes('references policy group') ||
        normalized.includes('referenced policy')
    )
        return 'POLICY_REFERENCE_INVALID';
    if (
        normalized.includes('policy group') &&
        (normalized.includes('unsupported') || normalized.includes('disabled'))
    )
        return 'POLICY_REFERENCE_INVALID';
    if (normalized.includes('no usable policy')) return 'POLICY_GROUP_EMPTY';
    if (normalized.includes('remote proxy source')) return 'REMOTE_SOURCE_INVALID';
    if (normalized.includes('rule set') || normalized.includes('rule-set'))
        return 'RULE_SET_INVALID';
    if (normalized.includes('final')) return 'RULES_INCOMPLETE';
    if (normalized.includes('unique')) return 'DUPLICATE_ENTRY';
    if (`${path || ''}`.startsWith('outputs')) return 'INDEPENDENT_CONFIG_INVALID';
    return 'PROJECT_INVALID';
}

function validationDiagnostics(project, ruleSets, target) {
    try {
        validateProject(project, ruleSets, target);
        return [];
    } catch (error) {
        if (!(error instanceof ConfigGeneratorValidationError)) throw error;
        return error.issues.map((item) =>
            createDiagnostic({
                code: validationCode(item.path, item.message),
                severity: 'error',
                target,
                path: item.path,
                message: item.message,
            }),
        );
    }
}

function memberPolicyReference(member) {
    if (member?.kind === 'group') return member.value;
    if (member?.kind === 'conditional') return member.policy;
    return undefined;
}

function groupPolicyReferences(group) {
    return [
        ...(group?.members || []).map(memberPolicyReference),
        ...(group?.includeOtherGroups || []),
        ...(group?.type === 'subnet'
            ? [
                  group.targetOptions?.surge?.subnetDefault,
                  ...(group.targetOptions?.surge?.subnetRules || []).map(
                      (rule) => rule.policy,
                  ),
              ]
            : []),
    ].filter(Boolean);
}

function activeRules(project) {
    return (project?.rules || []).filter(
        (rule) =>
            !rule.disabled && !['comment', 'blank'].includes(rule.kind),
    );
}

function requiredGroupNames(project) {
    const groups = new Map(
        (project?.groups || []).map((group) => [group.name, group]),
    );
    const required = new Set();
    const pending = activeRules(project)
        .map((rule) => rule.policy)
        .filter((policy) => groups.has(policy));
    while (pending.length) {
        const name = pending.shift();
        if (required.has(name)) continue;
        required.add(name);
        const group = groups.get(name);
        groupPolicyReferences(group).forEach((policy) => {
            if (
                groups.has(policy) &&
                !required.has(policy) &&
                !BUILTIN_POLICIES.has(policy)
            ) {
                pending.push(policy);
            }
        });
    }
    return required;
}

function hasProjectedCandidates(group, capability, target, sourceProjection) {
    const members = projectPolicyGroupMembers(group, capability, target);
    const included = projectIncludedPolicyGroups(group, capability, target);
    if (members.members.length || members.conditionals.length) return true;
    if (included.members.length || included.dependencies.length) return true;
    if (group.includeAllProxies) return true;
    if (sourceProjection.status === 'ready') return true;
    if (
        target === 'qx' &&
        sourceProjection.status === 'none' &&
        group.targetOptions?.qx?.resourceTagRegex
    )
        return true;
    if (group.type === 'subnet') {
        const surgeOptions = group.targetOptions?.surge || {};
        return Boolean(
            surgeOptions.subnetDefault || surgeOptions.subnetRules?.length,
        );
    }
    return false;
}

function targetOptionDiagnostics(group, capability, target) {
    const diagnostics = [];
    const outputType = capability?.outputType;
    const add = (path, message) =>
        diagnostics.push(
            createDiagnostic({
                code: 'TARGET_OPTION_OMITTED',
                severity: 'warning',
                target,
                path,
                message,
            }),
        );
    const surgeOptions = group.targetOptions?.surge || {};
    const qxOptions = group.targetOptions?.qx || {};

    if (target === 'qx') {
        if (group.testUrl)
            add(
                `groups.${group.name}.testUrl`,
                'Quantumult X uses the client server-check URL, so this per-group test URL is omitted.',
            );
        if (group.timeout !== undefined)
            add(
                `groups.${group.name}.timeout`,
                'Quantumult X policy groups do not support the Surge timeout option.',
            );
        if (group.interval !== undefined && outputType !== 'url-latency-benchmark')
            add(
                `groups.${group.name}.interval`,
                'Quantumult X check-interval is only emitted for url-latency-benchmark groups.',
            );
        if (group.tolerance !== undefined && outputType !== 'url-latency-benchmark')
            add(
                `groups.${group.name}.tolerance`,
                'Quantumult X tolerance is only emitted for url-latency-benchmark groups.',
            );
        if (
            qxOptions.aliveChecking !== undefined &&
            outputType !== 'url-latency-benchmark'
        )
            add(
                `groups.${group.name}.targetOptions.qx.aliveChecking`,
                'Quantumult X alive-checking is only emitted for url-latency-benchmark groups.',
            );
        if (surgeOptions.evaluateBeforeUse !== undefined)
            add(
                `groups.${group.name}.targetOptions.surge.evaluateBeforeUse`,
                'Quantumult X has no Surge evaluate-before-use equivalent.',
            );
    }

    if (target === 'clash') {
        if (group.timeout !== undefined)
            add(
                `groups.${group.name}.timeout`,
                'Classic Clash policy groups do not support the Surge timeout option.',
            );
        if (group.tolerance !== undefined && outputType !== 'url-test')
            add(
                `groups.${group.name}.tolerance`,
                'Classic Clash tolerance is only emitted for url-test groups.',
            );
        if (qxOptions.aliveChecking !== undefined)
            add(
                `groups.${group.name}.targetOptions.qx.aliveChecking`,
                'Quantumult X alive-checking has no independent Clash equivalent.',
            );
        if (qxOptions.resourceTagRegex)
            add(
                `groups.${group.name}.targetOptions.qx.resourceTagRegex`,
                'A raw Quantumult X resource-tag-regex cannot be represented by Clash.',
            );
        ['hidden', 'noAlert', 'evaluateBeforeUse', 'persistent'].forEach(
            (field) => {
                if (surgeOptions[field] !== true) return;
                add(
                    `groups.${group.name}.targetOptions.surge.${field}`,
                    `The Surge ${field} option has no Clash equivalent.`,
                );
            },
        );
    }

    if (target === 'loon') {
        const supportsTest = ['url-test', 'fallback', 'load-balance'].includes(
            outputType,
        );
        if (group.testUrl && !supportsTest)
            add(
                `groups.${group.name}.testUrl`,
                `Loon ${outputType} does not use a per-group test URL.`,
            );
        if (group.interval !== undefined && !supportsTest)
            add(
                `groups.${group.name}.interval`,
                `Loon ${outputType} does not use a test interval.`,
            );
        if (group.tolerance !== undefined && outputType !== 'url-test')
            add(
                `groups.${group.name}.tolerance`,
                'Loon tolerance is only emitted for url-test groups.',
            );
        if (
            group.timeout !== undefined &&
            !['fallback', 'load-balance'].includes(outputType)
        )
            add(
                `groups.${group.name}.timeout`,
                'Loon max-timeout is only emitted for fallback and load-balance groups.',
            );
        if (group.policyUpdateInterval !== undefined)
            add(
                `groups.${group.name}.policyUpdateInterval`,
                'The official Loon profile syntax has no per-group remote-proxy update interval.',
            );
        if (
            group.iconUrl ||
            surgeOptions.iconUrl ||
            group.targetOptions?.qx?.iconUrl
        )
            add(
                `groups.${group.name}.iconUrl`,
                'The official Loon profile manual does not document a portable policy-group icon option.',
            );
        if (qxOptions.aliveChecking !== undefined)
            add(
                `groups.${group.name}.targetOptions.qx.aliveChecking`,
                'Quantumult X alive-checking has no independent Loon equivalent.',
            );
        if (qxOptions.resourceTagRegex)
            add(
                `groups.${group.name}.targetOptions.qx.resourceTagRegex`,
                'A raw Quantumult X resource-tag-regex cannot be represented by Loon.',
            );
        ['hidden', 'noAlert', 'evaluateBeforeUse', 'persistent'].forEach(
            (field) => {
                if (surgeOptions[field] !== true) return;
                add(
                    `groups.${group.name}.targetOptions.surge.${field}`,
                    `The Surge ${field} option has no documented Loon equivalent.`,
                );
            },
        );
    }

    return diagnostics;
}

function ruleCapabilityDiagnostics(project, target) {
    const capability = TARGET_RULE_CAPABILITIES[target];
    if (!capability) return [];
    const diagnostics = [];
    activeRules(project).forEach((rule) => {
        const index = (project.rules || []).indexOf(rule);
        if (
            rule.kind === 'inline' &&
            !capability.inlineRuleTypes.has(rule.type)
        ) {
            diagnostics.push(
                createDiagnostic({
                    code: 'TARGET_OPTION_OMITTED',
                    severity: 'warning',
                    target,
                    path: `rules[${index}].type`,
                    message: `${getTargetDisplayName(
                        target,
                    )} cannot represent the ${rule.type} inline rule type, so the rule is omitted.`,
                }),
            );
        }
        if (
            rule.kind === 'inline' &&
            rule.noResolve &&
            capability.inlineNoResolveTypes &&
            !capability.inlineNoResolveTypes.has(rule.type)
        ) {
            diagnostics.push(
                createDiagnostic({
                    code: 'TARGET_OPTION_OMITTED',
                    severity: 'warning',
                    target,
                    path: `rules[${index}].noResolve`,
                    message: `${getTargetDisplayName(
                        target,
                    )} does not apply no-resolve to ${rule.type}; the option is omitted.`,
                }),
            );
        }
        if (
            rule.kind === 'remote' &&
            rule.noResolve &&
            !capability.remoteNoResolve
        ) {
            diagnostics.push(
                createDiagnostic({
                    code: 'TARGET_OPTION_OMITTED',
                    severity: 'warning',
                    target,
                    path: `rules[${index}].noResolve`,
                    message: `${getTargetDisplayName(
                        target,
                    )} remote rule bindings do not preserve the shared no-resolve option.`,
                }),
            );
        }
        if (rule.kind === 'final' && rule.dnsFailed && !capability.dnsFailed) {
            diagnostics.push(
                createDiagnostic({
                    code: 'TARGET_OPTION_OMITTED',
                    severity: 'warning',
                    target,
                    path: `rules[${index}].dnsFailed`,
                    message: `${getTargetDisplayName(
                        target,
                    )} does not preserve Surge FINAL dns-failed semantics.`,
                }),
            );
        }
    });
    return diagnostics;
}

function globalAdvisories(project, ruleSets) {
    const diagnostics = [];
    const rules = activeRules(project);
    if (!rules.length) {
        diagnostics.push(
            createDiagnostic({
                code: 'RULES_INCOMPLETE',
                severity: 'warning',
                path: 'rules',
                message: 'The project has no active rules, so traffic decisions depend entirely on the independent client configuration.',
            }),
        );
    } else if (!rules.some((rule) => rule.kind === 'final')) {
        diagnostics.push(
            createDiagnostic({
                code: 'RULES_INCOMPLETE',
                severity: 'warning',
                path: 'rules',
                message: 'The project has no active FINAL rule. Clash will append a MATCH fallback, while other clients may fall through to independent configuration behavior.',
            }),
        );
    }

    const seenRules = new Map();
    (project?.rules || []).forEach((rule, index) => {
        if (rule.disabled || ['comment', 'blank'].includes(rule.kind)) return;
        const key = JSON.stringify({
            kind: rule.kind,
            type: rule.type,
            value: rule.value,
            ruleSet: rule.ruleSet,
            policy: rule.policy,
            noResolve: Boolean(rule.noResolve),
            dnsFailed: Boolean(rule.dnsFailed),
        });
        if (seenRules.has(key)) {
            diagnostics.push(
                createDiagnostic({
                    code: 'DUPLICATE_ENTRY',
                    severity: 'warning',
                    path: `rules[${index}]`,
                    message: `This rule duplicates rules[${seenRules.get(key)}] and may be redundant.`,
                }),
            );
        } else {
            seenRules.set(key, index);
        }
    });

    const required = requiredGroupNames(project);
    (project?.groups || []).forEach((group, index) => {
        if (group.disabled) return;
        if (!required.has(group.name)) {
            diagnostics.push(
                createDiagnostic({
                    code: 'UNUSED_ENTRY',
                    severity: 'info',
                    path: `groups[${index}]`,
                    message: `Policy group ${group.name || `#${index + 1}`} is not reachable from any active rule.`,
                }),
            );
        }
        const seenMembers = new Map();
        (group.members || []).forEach((member, memberIndex) => {
            const key = JSON.stringify(member);
            if (seenMembers.has(key)) {
                diagnostics.push(
                    createDiagnostic({
                        code: 'DUPLICATE_ENTRY',
                        severity: 'warning',
                        path: `groups[${index}].members[${memberIndex}]`,
                        message: `This policy member duplicates members[${seenMembers.get(
                            key,
                        )}] in group ${group.name}.`,
                    }),
                );
            } else {
                seenMembers.set(key, memberIndex);
            }
        });
        if (group.nodeNameRegex) {
            try {
                new RegExp(group.nodeNameRegex);
            } catch (_) {
                diagnostics.push(
                    createDiagnostic({
                        code: 'POLICY_REGEX_INVALID',
                        severity: 'error',
                        path: `groups[${index}].nodeNameRegex`,
                        message: `Policy group ${group.name} contains an invalid node-name regular expression.`,
                    }),
                );
            }
        }
    });

    const usedRuleSets = new Set(
        rules
            .filter((rule) => rule.kind === 'remote')
            .map((rule) => rule.ruleSet),
    );
    (ruleSets || []).forEach((ruleSet, index) => {
        if (ruleSet.enabled === false || usedRuleSets.has(ruleSet.name)) return;
        diagnostics.push(
            createDiagnostic({
                code: 'UNUSED_ENTRY',
                severity: 'info',
                path: `ruleSets[${index}]`,
                message: `Rule set ${ruleSet.name || `#${index + 1}`} is not used by any active rule.`,
            }),
        );
    });

    const clashConfig = project?.outputs?.clash?.independentConfig;
    if (typeof clashConfig === 'string' && clashConfig.trim()) {
        try {
            const parsed = YAML.safeLoad(clashConfig);
            if (
                parsed !== null &&
                parsed !== undefined &&
                (typeof parsed !== 'object' || Array.isArray(parsed))
            ) {
                throw new Error('Clash independent configuration must be a YAML mapping');
            }
        } catch (error) {
            diagnostics.push(
                createDiagnostic({
                    code: 'INDEPENDENT_CONFIG_INVALID',
                    severity: 'error',
                    target: 'clash',
                    path: 'outputs.clash.independentConfig',
                    message: `Clash independent configuration could not be parsed: ${
                        error.message || error
                    }`,
                }),
            );
        }
    }

    return diagnostics;
}

async function resourceDescriptors(project, ruleSets, getResourceDescriptor) {
    const descriptors = new Map();
    const usedNames = new Set(
        activeRules(project)
            .filter((rule) => rule.kind === 'remote')
            .map((rule) => rule.ruleSet),
    );
    const used = (ruleSets || []).filter(
        (ruleSet) =>
            ruleSet.enabled !== false &&
            usedNames.has(ruleSet.name) &&
            isResourceRuleSet(ruleSet),
    );
    if (typeof getResourceDescriptor !== 'function') return descriptors;
    await Promise.all(
        used.map(async (ruleSet) => {
            try {
                descriptors.set(ruleSet.name, {
                    descriptor: await getResourceDescriptor(ruleSet.source.ref),
                });
            } catch (error) {
                descriptors.set(ruleSet.name, { error });
            }
        }),
    );
    return descriptors;
}

function resourceRuleSetDiagnostics(
    project,
    ruleSet,
    target,
    descriptorResult,
) {
    const diagnostics = [];
    if (!projectPublicBaseUrl(project)) {
        diagnostics.push(
            createDiagnostic({
                code: 'RULE_SET_INVALID',
                severity: 'error',
                target,
                path: 'delivery.publicBaseUrl',
                message: `Resource-backed rule set ${ruleSet.name} requires an absolute public delivery URL before it can be emitted for ${getTargetDisplayName(
                    target,
                )}.`,
            }),
        );
    }
    if (!descriptorResult) return diagnostics;
    if (descriptorResult.error) {
        diagnostics.push(
            createDiagnostic({
                code: 'RULE_SET_INVALID',
                severity: 'error',
                target,
                path: `ruleSets.${ruleSet.name}.source.ref`,
                message: `The resource provider for rule set ${ruleSet.name} is unavailable: ${
                    descriptorResult.error.message ||
                    descriptorResult.error.code ||
                    descriptorResult.error
                }`,
            }),
        );
        return diagnostics;
    }
    const descriptor = descriptorResult.descriptor;
    if (descriptor?.availability?.status !== 'available') {
        diagnostics.push(
            createDiagnostic({
                code: 'RULE_SET_INVALID',
                severity: 'error',
                target,
                path: `ruleSets.${ruleSet.name}.source.ref`,
                message: `Resource-backed rule set ${ruleSet.name} is ${
                    descriptor?.availability?.status || 'unavailable'
                }.`,
            }),
        );
    }
    const representation = ruleSetRepresentation(ruleSet, target);
    if (
        representation &&
        !descriptor?.representations?.includes(representation)
    ) {
        diagnostics.push(
            createDiagnostic({
                code: 'RULE_SET_INVALID',
                severity: 'error',
                target,
                path: `ruleSets.${ruleSet.name}.source.ref`,
                message: `Resource-backed rule set ${ruleSet.name} does not provide the ${representation} representation required by ${getTargetDisplayName(
                    target,
                )}.`,
            }),
        );
    }
    return diagnostics;
}

function targetDiagnostics(
    project,
    ruleSets,
    target,
    required,
    sourceContext,
    descriptorResults,
) {
    const diagnostics = [];
    const ruleSetByName = new Map(
        (ruleSets || []).map((ruleSet) => [ruleSet.name, ruleSet]),
    );

    (project?.groups || []).forEach((group, index) => {
        if (group.disabled) return;
        const capability = resolvePolicyGroupCapability(target, group.type);
        if (!capability) {
            diagnostics.push(
                createDiagnostic({
                    code: 'POLICY_GROUP_UNSUPPORTED',
                    severity: required.has(group.name) ? 'error' : 'warning',
                    target,
                    path: `groups[${index}].type`,
                    message: `${getTargetDisplayName(
                        target,
                    )} does not support the ${group.type} policy-group type.`,
                }),
            );
            return;
        }
        if (capability.exact === false && capability.warning) {
            diagnostics.push(
                createDiagnostic({
                    code: 'POLICY_GROUP_FALLBACK',
                    severity: 'warning',
                    target,
                    path: `groups[${index}].type`,
                    message: capability.warning,
                    details: {
                        sourceType: group.type,
                        outputType: capability.outputType,
                        lostSemantics: capability.lostSemantics || [],
                    },
                }),
            );
        }

        const memberProjection = projectPolicyGroupMembers(
            group,
            capability,
            target,
        );
        memberProjection.diagnostics.forEach((item) => {
            diagnostics.push(
                createDiagnostic({
                    code: 'POLICY_GROUP_FALLBACK',
                    severity: 'warning',
                    target,
                    path: item.path,
                    message: item.message,
                }),
            );
        });
        const includedProjection = projectIncludedPolicyGroups(
            group,
            capability,
            target,
        );
        includedProjection.diagnostics.forEach((item) => {
            diagnostics.push(
                createDiagnostic({
                    code: 'POLICY_GROUP_FALLBACK',
                    severity: 'warning',
                    target,
                    path: item.path,
                    message: item.message,
                }),
            );
        });

        const sourceProjection = projectGroupRemoteProxySource(
            group,
            target,
            sourceContext,
        );
        if (sourceProjection.status === 'ready' && sourceProjection.fallback) {
            diagnostics.push(
                createDiagnostic({
                    code: 'REMOTE_SOURCE_FALLBACK',
                    severity: 'warning',
                    target,
                    path: sourceProjection.path,
                    message:
                        remoteProxySourceFallbackWarning(sourceProjection) ||
                        'The remote proxy source requires a target fallback.',
                }),
            );
        } else if (
            !['none', 'ready'].includes(sourceProjection.status)
        ) {
            const requiredGroup = required.has(group.name);
            diagnostics.push(
                createDiagnostic({
                    code: 'REMOTE_SOURCE_INVALID',
                    severity:
                        requiredGroup && STRICT_EMPTY_GROUP_TARGETS.has(target)
                            ? 'error'
                            : 'warning',
                    target,
                    path: sourceProjection.path,
                    message:
                        sourceProjection.status === 'disabled'
                            ? `The selected remote proxy source is disabled for ${getTargetDisplayName(
                                  target,
                              )}.`
                            : sourceProjection.status === 'unsupported-field'
                            ? `${getTargetDisplayName(target)} ${
                                  capability.outputType
                              } cannot use a remote proxy source.`
                            : remoteProxySourceWarning(
                                  sourceProjection,
                                  target,
                              ),
                }),
            );
        }

        if (
            !hasProjectedCandidates(
                group,
                capability,
                target,
                sourceProjection,
            )
        ) {
            diagnostics.push(
                createDiagnostic({
                    code: 'POLICY_GROUP_EMPTY',
                    severity:
                        required.has(group.name) &&
                        STRICT_EMPTY_GROUP_TARGETS.has(target)
                            ? 'error'
                            : 'warning',
                    target,
                    path: `groups[${index}].members`,
                    message: STRICT_EMPTY_GROUP_TARGETS.has(target)
                        ? `${getTargetDisplayName(
                              target,
                          )} projects this group without any usable policy members or remote sources.`
                        : `${getTargetDisplayName(
                              target,
                          )} will fall back to DIRECT because this group has no usable members or remote sources after projection.`,
                }),
            );
        }
        diagnostics.push(...targetOptionDiagnostics(group, capability, target));
    });

    (project?.rules || []).forEach((rule, index) => {
        if (rule.disabled || rule.kind !== 'remote') return;
        const ruleSet = ruleSetByName.get(rule.ruleSet);
        if (!ruleSet || ruleSet.enabled === false) return;
        if (isResourceRuleSet(ruleSet)) {
            diagnostics.push(
                ...resourceRuleSetDiagnostics(
                    project,
                    ruleSet,
                    target,
                    descriptorResults.get(ruleSet.name),
                ),
            );
            return;
        }
        const resolution = resolveRuleSetSource(ruleSet, target);
        if (resolution.kind === 'unsupported') {
            diagnostics.push(
                createDiagnostic({
                    code: 'RULE_SET_INVALID',
                    severity: 'error',
                    target,
                    path: `rules[${index}].ruleSet`,
                    message:
                        resolution.warning?.message ||
                        `${getTargetDisplayName(
                            target,
                        )} cannot represent this rule-set source.`,
                }),
            );
        } else if (resolution.warning) {
            diagnostics.push(
                createDiagnostic({
                    code: 'RULE_SET_FALLBACK',
                    severity: 'warning',
                    target,
                    path: `rules[${index}].ruleSet`,
                    message: resolution.warning.message,
                    details: resolution.fallback,
                }),
            );
        }
    });

    diagnostics.push(...ruleCapabilityDiagnostics(project, target));
    return diagnostics;
}

function dedupeDiagnostics(items) {
    const byKey = new Map();
    items.forEach((item) => {
        const key = [
            item.target || 'all',
            item.code,
            item.path || '',
            item.severity,
        ].join('\u0000');
        if (!byKey.has(key)) byKey.set(key, item);
    });
    return [...byKey.values()].map((item, index) => ({
        id: `${item.target || 'all'}:${item.code}:${item.path || 'project'}:${
            index + 1
        }`,
        ...item,
    }));
}

export async function diagnoseConfigProject({
    project,
    ruleSets = [],
    getResourceDescriptor,
}) {
    const targets = getTargetIds();
    const baseDiagnostics = validationDiagnostics(project, ruleSets);
    const baseSignatures = new Set(
        baseDiagnostics.map((item) => `${item.path || ''}\u0000${item.message}`),
    );
    const required = requiredGroupNames(project);
    const sourceContext = createRemoteProxySourceContext(project);
    const descriptorResults = await resourceDescriptors(
        project,
        ruleSets,
        getResourceDescriptor,
    );
    const items = [...baseDiagnostics, ...globalAdvisories(project, ruleSets)];

    targets.forEach((target) => {
        validationDiagnostics(project, ruleSets, target)
            .filter(
                (item) =>
                    !baseSignatures.has(
                        `${item.path || ''}\u0000${item.message}`,
                    ),
            )
            .forEach((item) => items.push(item));
        items.push(
            ...targetDiagnostics(
                project,
                ruleSets,
                target,
                required,
                sourceContext,
                descriptorResults,
            ),
        );
    });

    const diagnostics = dedupeDiagnostics(items).map((item) => ({
        ...item,
        location: diagnosticLocation(item.path, project, ruleSets),
    }));
    const counts = countDiagnostics(diagnostics);
    const targetReports = Object.fromEntries(
        targets.map((target) => {
            const targetDiagnosticsList = diagnostics.filter(
                (item) => !item.target || item.target === target,
            );
            const targetCounts = countDiagnostics(targetDiagnosticsList);
            return [
                target,
                {
                    target,
                    displayName: getTargetDisplayName(target),
                    status: statusFromCounts(targetCounts),
                    counts: targetCounts,
                },
            ];
        }),
    );

    return {
        schema: 'substore.config-generator-health-report@1',
        project: {
            name: project?.name || '',
            displayName: project?.displayName || project?.name || '',
            revision: project?.revision,
        },
        checkedAt: Date.now(),
        status: statusFromCounts(counts),
        counts,
        targets: targetReports,
        diagnostics,
        coverage: {
            mode: 'static',
            checked: [
                'project-structure',
                'policy-references',
                'policy-group-cycles',
                'target-policy-capabilities',
                'remote-source-bindings',
                'rule-set-targets',
                'resource-descriptors',
                'clash-independent-yaml',
            ],
            notChecked: [
                'embedded-source-output',
                'remote-url-reachability',
                'remote-rule-content',
                'resource-output-content',
                'response-transformers',
                'node-connectivity',
            ],
        },
    };
}
