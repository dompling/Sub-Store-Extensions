import { createHash } from 'node:crypto';
import {
    PLATFORM_REPRESENTATION,
    RULE_STUDIO_CONTRACT,
    RULE_STUDIO_LIMITS,
    RULE_STUDIO_REPRESENTATIONS,
} from './constants';
import { countDiagnostics } from './diagnostics';
import { createRuleSetRef } from './domain/resource-ref';
import { RuleStudioError } from './errors';
import { mergeNormalizedRuleSets } from './normalize/merge';
import { parseRuleSet } from './parser';
import { loadRemoteRuleSource } from './cache/remote-source';
import { serializeRules, withExactDiagnostics } from './targets';

async function mapConcurrent(items, limit, callback) {
    const results = new Array(items.length);
    let cursor = 0;
    const worker = async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await callback(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

async function resolveSource(source, project, options) {
    if (source.kind === 'inline') {
        const parsed = parseRuleSet(source.content, {
            sourceId: source.id,
            format: source.format || 'auto',
            preserveComments: project.options?.preserveComments !== false,
        });
        return {
            parsed,
            contentDigest: createHash('sha256').update(`${source.content || ''}`).digest('hex'),
            freshness: { state: 'fresh' },
            diagnostics: [],
        };
    }
    return loadRemoteRuleSource(source, {
        forceRefresh: options.forceRefresh,
        freshnessPolicy: options.freshnessPolicy,
        preserveComments: project.options?.preserveComments !== false,
        now: options.now,
    });
}

export function descriptorForProject(project, { availability = 'available' } = {}) {
    return {
        schema: 'substore.resource-descriptor@1',
        ref: createRuleSetRef(project.id),
        name: project.name,
        displayName: project.name,
        ...(project.description ? { description: project.description } : {}),
        revision: project.revision,
        updatedAt: project.updatedAt,
        contracts: [RULE_STUDIO_CONTRACT],
        representations: [...RULE_STUDIO_REPRESENTATIONS],
        lifecycle: { ...project.lifecycle },
        availability: { status: availability },
        metadata: {
            sourceCount: project.sources.length,
            enabledSourceCount: project.sources.filter(source => source.enabled !== false).length,
            ruleCount: project.lastSummary?.ruleCount || 0,
            warningCount: project.lastSummary?.warningCount || 0,
            errorCount: project.lastSummary?.errorCount || 0,
            ...(project.iconUrl ? { iconUrl: project.iconUrl } : {}),
        },
    };
}

export async function produceRuleSetProject(project, {
    representation,
    platform,
    forceRefresh = false,
    freshnessPolicy = 'allow-stale',
    now = Date.now(),
} = {}) {
    if (!['fresh', 'allow-stale', 'cache-only'].includes(freshnessPolicy)) {
        throw new RuleStudioError(
            'RESOURCE_FRESHNESS_POLICY_UNSUPPORTED',
            `不支持资源新鲜度策略 ${freshnessPolicy}`,
        );
    }
    const resolvedRepresentation = representation || PLATFORM_REPRESENTATION[platform];
    if (!RULE_STUDIO_REPRESENTATIONS.includes(resolvedRepresentation)) {
        throw new RuleStudioError(
            'RESOURCE_REPRESENTATION_UNSUPPORTED',
            `不支持规则集表示 ${resolvedRepresentation || platform || '(empty)'}`,
        );
    }
    const sources = project.sources.filter(source => source.enabled !== false);
    if (!sources.length) {
        throw new RuleStudioError('RESOURCE_CONTENT_INVALID', '规则集没有启用的来源', undefined, 422);
    }
    if (sources.length > RULE_STUDIO_LIMITS.maxEnabledSources) {
        throw new RuleStudioError('RULE_STUDIO_SOURCE_LIMIT_EXCEEDED', '启用来源数量超过限制', undefined, 413);
    }
    const resolvedSources = await mapConcurrent(
        sources,
        RULE_STUDIO_LIMITS.maxConcurrency,
        source => resolveSource(source, project, {
            forceRefresh,
            freshnessPolicy,
            now,
        }),
    );
    const merged = mergeNormalizedRuleSets(
        resolvedSources.map(item => item.parsed),
        { deduplicate: project.options?.deduplicate !== false },
    );
    if (!merged.rules.length) {
        throw new RuleStudioError('RESOURCE_CONTENT_INVALID', '规则集合并后没有有效规则', undefined, 422);
    }
    const serialized = withExactDiagnostics(
        serializeRules(merged.rules, resolvedRepresentation),
        merged.rules,
    );
    const diagnostics = [
        ...resolvedSources.flatMap(item => item.diagnostics || []),
        ...merged.diagnostics,
        ...(serialized.diagnostics || []),
    ];
    const mergedDiagnosticCounts = countDiagnostics(merged.diagnostics);
    const dispositionStats = Object.fromEntries(
        ['exact', 'fallback', 'filtered', 'invalid'].map(disposition => [
            disposition,
            (serialized.stats?.[disposition] || 0) +
                mergedDiagnosticCounts[disposition],
        ]),
    );
    const isStale = resolvedSources.some(item => item.freshness.state === 'stale');
    const fetchedTimes = resolvedSources.map(item => item.freshness.fetchedAt).filter(Number.isFinite);
    const expires = resolvedSources.map(item => item.freshness.expiresAt).filter(Number.isFinite);
    const sourceRevision = createHash('sha256')
        .update(JSON.stringify({
            revision: project.revision,
            contentDigests: resolvedSources.map(item => item.contentDigest),
            representation: resolvedRepresentation,
        }))
        .digest('hex');
    const diagnosticCounts = countDiagnostics(diagnostics);
    return {
        schema: 'substore.resource-output@1',
        ref: createRuleSetRef(project.id),
        representation: resolvedRepresentation,
        body: serialized.body,
        mediaType: serialized.mediaType,
        sourceRevision,
        etag: `\"${sourceRevision}\"`,
        freshness: {
            state: isStale ? 'stale' : 'fresh',
            ...(fetchedTimes.length ? { fetchedAt: Math.min(...fetchedTimes) } : {}),
            ...(expires.length ? { expiresAt: Math.min(...expires) } : {}),
        },
        diagnostics,
        stats: {
            ruleCount: merged.rules.length,
            outputRuleCount:
                (serialized.stats?.exact || 0) +
                (serialized.stats?.fallback || 0),
            ...dispositionStats,
            warningCount: diagnosticCounts.warning,
            errorCount: diagnosticCounts.error,
        },
    };
}
