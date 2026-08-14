import { createHash } from 'node:crypto';
import { RULE_STUDIO_LIMITS } from '../constants';
import { diagnostic } from '../diagnostics';
import { RuleStudioError } from '../errors';
import { parseRuleSet } from '../parser';
import { cache, network, runBackendRequestTask } from '../sdk';

const cacheKeyFor = url => `remote-source:${createHash('sha256').update(url).digest('hex')}`;

function header(response, name) {
    const headers = response?.headers;
    if (typeof headers?.get === 'function') return headers.get(name);
    if (!headers || typeof headers !== 'object') return null;
    const match = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase());
    return match ? headers[match] : null;
}

function staleResult(cached, source, reasonCode, now) {
    return {
        parsed: cached.parsed,
        contentDigest: cached.contentDigest,
        freshness: {
            state: 'stale',
            fetchedAt: cached.fetchedAt,
            expiresAt: cached.staleUntil,
        },
        diagnostics: [diagnostic({
            severity: 'warning',
            code: reasonCode,
            message: '远程来源更新失败，已使用最近一次成功内容',
            path: `sources.${source.id}`,
            details: { staleAgeMs: Math.max(0, now - cached.fetchedAt) },
        })],
    };
}

function cachedResult(cached, source, now) {
    if (!cached?.parsed || cached.staleUntil <= now) {
        throw new RuleStudioError(
            'RESOURCE_CACHE_MISS',
            '远程规则集没有可用缓存',
            { sourceId: source.id },
            409,
        );
    }
    if (cached.freshUntil > now) {
        return {
            parsed: cached.parsed,
            contentDigest: cached.contentDigest,
            freshness: {
                state: 'fresh',
                fetchedAt: cached.fetchedAt,
                expiresAt: cached.freshUntil,
            },
            diagnostics: [],
        };
    }
    return staleResult(cached, source, 'RESOURCE_STALE', now);
}

export async function loadRemoteRuleSource(source, {
    forceRefresh = false,
    freshnessPolicy = 'allow-stale',
    now = Date.now(),
    preserveComments = true,
} = {}) {
    const key = cacheKeyFor(source.url);
    const cached = cache.get(key);
    if (freshnessPolicy === 'cache-only') {
        return cachedResult(cached, source, now);
    }
    if (!forceRefresh && cached?.freshUntil > now && cached?.parsed) {
        return {
            parsed: cached.parsed,
            contentDigest: cached.contentDigest,
            freshness: {
                state: 'fresh',
                fetchedAt: cached.fetchedAt,
                expiresAt: cached.freshUntil,
            },
            diagnostics: [],
        };
    }
    const headers = {};
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    else if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
    try {
        const response = await runBackendRequestTask(
            () => network.get({
                url: source.url,
                headers,
                timeout: RULE_STUDIO_LIMITS.networkTimeoutMs,
            }),
            'rule-studio-remote-source',
        );
        const statusCode = Number(response?.statusCode || response?.status || 0);
        if (statusCode === 304 && cached?.parsed) {
            const refreshed = {
                ...cached,
                fetchedAt: now,
                freshUntil: now + RULE_STUDIO_LIMITS.freshTtlMs,
                staleUntil: now + RULE_STUDIO_LIMITS.maxStaleMs,
            };
            cache.set(key, refreshed, RULE_STUDIO_LIMITS.maxStaleMs);
            return {
                parsed: refreshed.parsed,
                contentDigest: refreshed.contentDigest,
                freshness: { state: 'fresh', fetchedAt: now, expiresAt: refreshed.freshUntil },
                diagnostics: [],
            };
        }
        if (statusCode && (statusCode < 200 || statusCode >= 300)) {
            throw new RuleStudioError('RESOURCE_UPSTREAM_FETCH_FAILED', `远程规则集返回 HTTP ${statusCode}`, undefined, 502);
        }
        const body = `${response?.body ?? ''}`;
        if (Buffer.byteLength(body, 'utf8') > RULE_STUDIO_LIMITS.maxSourceBytes) {
            throw new RuleStudioError('RESOURCE_CONTENT_TOO_LARGE', '远程规则集超过 10 MiB 限制', undefined, 413);
        }
        const parsed = parseRuleSet(body, {
            sourceId: source.id,
            format: source.format || 'auto',
            preserveComments,
        });
        if (!parsed.rules.length) {
            throw new RuleStudioError('RESOURCE_CONTENT_INVALID', '远程规则集没有有效规则', undefined, 422);
        }
        const contentDigest = createHash('sha256').update(body).digest('hex');
        const next = {
            parsed,
            contentDigest,
            etag: header(response, 'etag'),
            lastModified: header(response, 'last-modified'),
            fetchedAt: now,
            freshUntil: now + RULE_STUDIO_LIMITS.freshTtlMs,
            staleUntil: now + RULE_STUDIO_LIMITS.maxStaleMs,
        };
        cache.set(key, next, RULE_STUDIO_LIMITS.maxStaleMs);
        return {
            parsed,
            contentDigest,
            freshness: { state: 'fresh', fetchedAt: now, expiresAt: next.freshUntil },
            diagnostics: [],
        };
    } catch (error) {
        if (cached?.parsed && cached.staleUntil > now) {
            return staleResult(
                cached,
                source,
                error?.code === 'RESOURCE_CONTENT_INVALID'
                    ? 'RESOURCE_CONTENT_INVALID'
                    : 'RESOURCE_STALE',
                now,
            );
        }
        if (error instanceof RuleStudioError) throw error;
        throw new RuleStudioError(
            error?.code === 'ETIMEDOUT' ? 'RESOURCE_UPSTREAM_TIMEOUT' : 'RESOURCE_UPSTREAM_FETCH_FAILED',
            error?.code === 'ETIMEDOUT'
                ? '远程规则集请求超时'
                : '远程规则集获取失败且没有可用缓存',
            undefined,
            error?.code === 'ETIMEDOUT' ? 504 : 502,
        );
    }
}

export function remoteSourceCacheKey(url) {
    return cacheKeyFor(url);
}
