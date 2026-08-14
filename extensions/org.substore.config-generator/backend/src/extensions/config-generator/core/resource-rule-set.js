import { resources } from '../sdk';
import { getTargetDisplayName, normalizeTargetId } from './target-capabilities';

export const RESOURCE_REF_SCHEMA = 'substore.resource-ref@1';
export const RULE_SET_RESOURCE_CONTRACT = 'substore.rule-set@1';
export const CONFIG_PROJECT_RESOURCE_CONTRACT = 'substore.config-project@1';
export const CONFIG_PROJECT_RESOURCE_PROVIDER =
    'org.substore.config-generator';
export const CONFIG_PROJECT_RESOURCE_CONTRIBUTION =
    'org.substore.config-generator.config-project';

const TARGET_REPRESENTATIONS = Object.freeze({
    surge: 'surge-rule-list',
    qx: 'qx-filter',
    loon: 'loon-rule-list',
});

const CONFIG_PROJECT_REPRESENTATIONS = Object.freeze({
    surge: 'surge-config',
    qx: 'qx-config',
    clash: 'clash-config',
    loon: 'loon-config',
});

function resourceError(code, message, details) {
    const error = new Error(message || code);
    error.code = code;
    error.details = details;
    return error;
}

export function isResourceRuleSet(ruleSet) {
    return ruleSet?.source?.kind === 'resource';
}

export function normalizeResourceRef(ref, expectedContract) {
    const required = [
        'providerId',
        'providerContributionId',
        'type',
        'id',
        'contract',
    ];
    if (
        !ref ||
        typeof ref !== 'object' ||
        Array.isArray(ref) ||
        ref.schema !== RESOURCE_REF_SCHEMA ||
        required.some(
            (field) =>
                typeof ref[field] !== 'string' || !ref[field].trim(),
        )
    ) {
        throw resourceError(
            'RESOURCE_REF_INVALID',
            'Rule-set resource reference is incomplete or invalid',
        );
    }
    if (expectedContract && ref.contract !== expectedContract) {
        throw resourceError(
            'RESOURCE_CONTRACT_INCOMPATIBLE',
            `Expected ${expectedContract}, received ${ref.contract}`,
            { expectedContract, actualContract: ref.contract },
        );
    }
    return {
        schema: RESOURCE_REF_SCHEMA,
        providerId: ref.providerId,
        providerContributionId: ref.providerContributionId,
        type: ref.type,
        id: ref.id,
        contract: ref.contract,
    };
}

export function configProjectResourceRef(project) {
    return normalizeResourceRef(
        {
            schema: RESOURCE_REF_SCHEMA,
            providerId: CONFIG_PROJECT_RESOURCE_PROVIDER,
            providerContributionId: CONFIG_PROJECT_RESOURCE_CONTRIBUTION,
            type: 'config-project',
            id: project?.name,
            contract: CONFIG_PROJECT_RESOURCE_CONTRACT,
        },
        CONFIG_PROJECT_RESOURCE_CONTRACT,
    );
}

export function configProjectRepresentation(target) {
    const targetId = normalizeTargetId(target);
    return targetId ? CONFIG_PROJECT_REPRESENTATIONS[targetId] : undefined;
}

export function ruleSetRepresentation(ruleSet, target) {
    const targetId = normalizeTargetId(target);
    if (!targetId) return undefined;
    if (targetId !== 'clash') return TARGET_REPRESENTATIONS[targetId];
    const clash = ruleSet?.targetOptions?.clash || {};
    const behavior = clash.behavior || 'classical';
    if (behavior === 'domain') return 'clash-domain-yaml';
    if (behavior === 'ipcidr') return 'clash-ipcidr-yaml';
    return clash.format === 'text'
        ? 'clash-classical-text'
        : 'clash-classical-yaml';
}

export function projectPublicBaseUrl(project) {
    return (
        project?.delivery?.publicBaseUrl ||
        project?.outputs?.clash?.publicBaseUrl ||
        (project?.remoteProxySources || []).find(
            (source) => source?.source?.publicBaseUrl,
        )?.source?.publicBaseUrl ||
        ''
    );
}

export function resourceRuleSetDownloadUrl(project, ruleSet, target) {
    const configuredBase = projectPublicBaseUrl(project);
    let base;
    try {
        base = new URL(configuredBase);
        if (!['http:', 'https:'].includes(base.protocol)) throw new Error();
    } catch (_) {
        throw resourceError(
            'CONFIG_GENERATOR_RESOURCE_DELIVERY_URL_REQUIRED',
            'Resource-backed rule sets require an absolute HTTP(S) delivery URL',
            { path: 'delivery.publicBaseUrl' },
        );
    }
    const normalizedPath = base.pathname.replace(/\/+$/, '');
    base.pathname = normalizedPath.replace(/\/api$/i, '');
    base.search = '';
    base.hash = '';
    const targetId = normalizeTargetId(target);
    if (!targetId) {
        throw resourceError(
            'UNSUPPORTED_EXTENSION_PLATFORM',
            `Unsupported rule-set target: ${target}`,
        );
    }
    return `${base.toString().replace(/\/+$/, '')}/download/config-project/${encodeURIComponent(
        project.name,
    )}/rule-set/${encodeURIComponent(ruleSet.name)}/${encodeURIComponent(
        getTargetDisplayName(targetId),
    )}`;
}

function usedRuleSetNames(project) {
    return new Set(
        (project?.rules || [])
            .filter((rule) => !rule.disabled && rule.kind === 'remote')
            .map((rule) => rule.ruleSet),
    );
}

export function projectResourceTargets(project, ruleSets) {
    const used = usedRuleSetNames(project);
    const refs = new Map();
    for (const ruleSet of ruleSets || []) {
        if (
            !used.has(ruleSet.name) ||
            ruleSet.enabled === false ||
            !isResourceRuleSet(ruleSet)
        ) {
            continue;
        }
        const ref = normalizeResourceRef(
            ruleSet.source.ref,
            RULE_SET_RESOURCE_CONTRACT,
        );
        refs.set(
            [
                ref.providerId,
                ref.providerContributionId,
                ref.type,
                ref.id,
                ref.contract,
            ].join('\u0000'),
            ref,
        );
    }
    return [...refs.values()];
}

function diagnosticProjection(ruleSet, diagnostic) {
    return {
        ...diagnostic,
        path: diagnostic?.path
            ? `ruleSets.${ruleSet.name}.${diagnostic.path}`
            : `ruleSets.${ruleSet.name}`,
        message: diagnostic?.message || diagnostic?.code || 'Resource diagnostic',
    };
}

export async function projectResourceRuleSets({ project, ruleSets, target }) {
    const targetId = normalizeTargetId(target);
    if (!targetId) {
        throw resourceError(
            'UNSUPPORTED_EXTENSION_PLATFORM',
            `Unsupported rule-set target: ${target}`,
        );
    }
    const used = usedRuleSetNames(project);
    const projectedRuleSets = (ruleSets || []).map((ruleSet) => ({
        ...ruleSet,
        source: ruleSet?.source ? { ...ruleSet.source } : ruleSet?.source,
    }));
    const bodies = new Map();
    const warnings = [];
    const errors = [];
    const outputs = new Map();

    for (const ruleSet of projectedRuleSets) {
        if (
            !used.has(ruleSet.name) ||
            ruleSet.enabled === false ||
            !isResourceRuleSet(ruleSet)
        ) {
            continue;
        }
        const ref = normalizeResourceRef(
            ruleSet.source.ref,
            RULE_SET_RESOURCE_CONTRACT,
        );
        const representation = ruleSetRepresentation(ruleSet, targetId);
        const descriptor = await resources.get(ref);
        if (
            !Array.isArray(descriptor?.representations) ||
            !descriptor.representations.includes(representation)
        ) {
            throw resourceError(
                'RESOURCE_REPRESENTATION_UNSUPPORTED',
                `${descriptor?.displayName || descriptor?.name || ruleSet.name} does not provide ${representation}`,
                { ref, representation },
            );
        }
        const output = await resources.produce(ref, {
            representation,
            target: targetId,
            freshnessPolicy: 'fresh',
        });
        if (typeof output?.body !== 'string' || !output.body.trim()) {
            throw resourceError(
                'RESOURCE_OUTPUT_EMPTY',
                `Rule-set resource ${ruleSet.name} produced no content`,
                { ref, representation },
            );
        }
        const url = resourceRuleSetDownloadUrl(
            project,
            ruleSet,
            targetId,
        );
        bodies.set(url, output.body);
        outputs.set(ruleSet.name, output);
        for (const diagnostic of output.diagnostics || []) {
            const projected = diagnosticProjection(ruleSet, diagnostic);
            if (diagnostic.severity === 'error') errors.push(projected);
            else warnings.push(projected);
        }
        if (output.freshness?.state === 'stale') {
            warnings.push({
                code: 'RESOURCE_OUTPUT_STALE',
                severity: 'warning',
                path: `ruleSets.${ruleSet.name}`,
                message: `${descriptor?.displayName || descriptor?.name || ruleSet.name} used a stale cached output.`,
            });
        }
        ruleSet.source = {
            kind: 'url',
            url,
            target: targetId,
            resourceProjection: true,
            resourceRepresentation: representation,
        };
    }

    return {
        ruleSets: projectedRuleSets,
        bodies,
        outputs,
        warnings,
        errors,
    };
}

export async function produceResourceRuleSet(ruleSet, target) {
    if (!isResourceRuleSet(ruleSet)) {
        throw resourceError(
            'CONFIG_GENERATOR_RULE_SET_RESOURCE_REQUIRED',
            'The selected rule set is not backed by a resource reference',
        );
    }
    const ref = normalizeResourceRef(
        ruleSet.source.ref,
        RULE_SET_RESOURCE_CONTRACT,
    );
    const representation = ruleSetRepresentation(ruleSet, target);
    return resources.produce(ref, {
        representation,
        target: normalizeTargetId(target),
        freshnessPolicy: 'fresh',
    });
}
