import { createHash } from 'node:crypto';
import { RULE_STUDIO_CATALOG_LIMITS } from '../constants';
import { RuleStudioError } from '../errors';
import { cache } from '../sdk';
import {
    findRuleSourceCatalog,
    listRuleSourceCatalogs as listCatalogDefinitions,
    publicCatalog,
} from './definitions';
import { fetchGitHubCatalogItems } from './github-tree';

const CACHE_SCHEMA_VERSION = 1;

function cacheKeyFor(catalog) {
    const fingerprint = createHash('sha256').update(JSON.stringify({
        owner: catalog.repository.owner,
        repository: catalog.repository.name,
        ref: catalog.repository.ref,
        rootPath: catalog.rootPath,
        fileExtensions: catalog.fileExtensions,
        format: catalog.format,
    })).digest('hex').slice(0, 16);
    return `source-catalog:${catalog.id}:${fingerprint}`;
}

function validCached(cached) {
    return cached?.schemaVersion === CACHE_SCHEMA_VERSION && Array.isArray(cached.items);
}

function requireCatalog(id, customCatalogs = []) {
    const catalog = findRuleSourceCatalog(id, customCatalogs);
    if (!catalog) {
        throw new RuleStudioError(
            'RULE_STUDIO_CATALOG_NOT_FOUND',
            '找不到规则库',
            undefined,
            404,
        );
    }
    return catalog;
}

function cachedPayload(catalog, cached, state, warningCode) {
    return {
        catalog: publicCatalog(catalog),
        items: cached.items,
        freshness: {
            state,
            fetchedAt: cached.fetchedAt,
            expiresAt: state === 'fresh' ? cached.freshUntil : cached.staleUntil,
        },
        ...(warningCode ? { warningCode } : {}),
    };
}

function catalogCacheState(catalog, now = Date.now()) {
    const cached = cache.get(cacheKeyFor(catalog));
    if (!validCached(cached)) return { state: 'empty' };
    if (cached.freshUntil > now) {
        return {
            state: 'fresh',
            fetchedAt: cached.fetchedAt,
            expiresAt: cached.freshUntil,
        };
    }
    if (cached.staleUntil > now) {
        return {
            state: 'stale',
            fetchedAt: cached.fetchedAt,
            expiresAt: cached.staleUntil,
        };
    }
    return {
        state: 'expired',
        fetchedAt: cached.fetchedAt,
        expiresAt: cached.staleUntil,
    };
}

export function listRuleSourceCatalogs({
    enabledCatalogIds = [],
    customCatalogs = [],
    now = Date.now(),
} = {}) {
    const enabled = new Set(enabledCatalogIds);
    return listCatalogDefinitions(customCatalogs).map(catalog => ({
        ...catalog,
        enabled: enabled.has(catalog.id),
        cache: catalogCacheState(requireCatalog(catalog.id, customCatalogs), now),
    }));
}

export async function loadRuleSourceCatalogItems(id, {
    customCatalogs = [],
    forceRefresh = false,
    now = Date.now(),
} = {}) {
    const catalog = requireCatalog(id, customCatalogs);
    const key = cacheKeyFor(catalog);
    const cached = cache.get(key);
    if (!forceRefresh && validCached(cached) && cached.freshUntil > now) {
        return cachedPayload(catalog, cached, 'fresh');
    }
    try {
        const items = await fetchGitHubCatalogItems(catalog);
        const next = {
            schemaVersion: CACHE_SCHEMA_VERSION,
            items,
            fetchedAt: now,
            freshUntil: now + RULE_STUDIO_CATALOG_LIMITS.freshTtlMs,
            staleUntil: now + RULE_STUDIO_CATALOG_LIMITS.maxStaleMs,
        };
        cache.set(key, next, RULE_STUDIO_CATALOG_LIMITS.maxStaleMs);
        return cachedPayload(catalog, next, 'fresh');
    } catch (error) {
        if (validCached(cached) && cached.staleUntil > now) {
            return cachedPayload(
                catalog,
                cached,
                'stale',
                error?.code || 'RULE_STUDIO_CATALOG_FETCH_FAILED',
            );
        }
        if (error instanceof RuleStudioError) throw error;
        throw new RuleStudioError(
            'RULE_STUDIO_CATALOG_FETCH_FAILED',
            '规则库目录获取失败且没有可用缓存',
            undefined,
            502,
        );
    }
}
