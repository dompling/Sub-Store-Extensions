import {
    getTargetDisplayName,
    normalizeTargetId,
} from './target-capabilities';

function dedupe(values) {
    const seen = new Set();
    return values.filter((value) => {
        const normalized = `${value || ''}`.trim();
        if (!normalized || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
    });
}

export function policyGroupCapabilityDiagnostics(group, capability) {
    if (capability?.exact !== false || !capability.warning) return [];
    return [
        {
            path: `groups.${group.name}.type`,
            message: capability.warning,
        },
    ];
}

export function projectIncludedPolicyGroups(group, capability, target) {
    const includedGroups = group.includeOtherGroups || [];
    const mode = capability?.includedPolicyGroupsMode;
    if (!includedGroups.length) {
        return { mode, members: [], dependencies: [], diagnostics: [] };
    }

    if (mode === 'native') {
        return {
            mode,
            members: [],
            dependencies: includedGroups,
            diagnostics: [],
        };
    }

    const targetName = getTargetDisplayName(target);
    if (mode === 'nested-group') {
        return {
            mode,
            members: includedGroups,
            dependencies: includedGroups,
            diagnostics: [
                {
                    path: `groups.${group.name}.includeOtherGroups`,
                    message: `${targetName} cannot flatten nodes from included policy groups; referenced group names were appended as nested policy members instead.`,
                },
            ],
        };
    }

    return {
        mode: 'omit',
        members: [],
        dependencies: [],
        diagnostics: [
            {
                path: `groups.${group.name}.includeOtherGroups`,
                message: `${targetName} ${capability.outputType} cannot safely approximate flattened nodes from another policy group; includeOtherGroups was omitted.`,
            },
        ],
    };
}

export function projectPolicyGroupMembers(group, capability, target) {
    const targetId = normalizeTargetId(target);
    const members = [];
    const conditionals = [];
    const diagnostics = [];
    let rewroteConditionalMembers = false;

    (group.members || []).forEach((member) => {
        if (member?.kind !== 'conditional') {
            members.push(member?.value);
            return;
        }
        if (
            capability?.outputSharedType === 'ssid' &&
            ['qx', 'loon'].includes(targetId)
        ) {
            conditionals.push(member);
            return;
        }
        members.push(member.policy);
        rewroteConditionalMembers = true;
    });

    if (
        group.type === 'subnet' &&
        capability?.outputSharedType !== 'subnet'
    ) {
        const surgeOptions = group.targetOptions?.surge || {};
        members.push(surgeOptions.subnetDefault);
        (surgeOptions.subnetRules || []).forEach((rule) => {
            members.push(rule.policy);
        });
    }

    if (rewroteConditionalMembers) {
        diagnostics.push({
            path: `groups.${group.name}.members`,
            message: `${getTargetDisplayName(
                targetId,
            )} cannot preserve conditional policy members for ${
                capability.outputType
            }; referenced policies were retained as ordinary members.`,
        });
    }

    return {
        members: dedupe(members),
        conditionals,
        diagnostics,
    };
}
