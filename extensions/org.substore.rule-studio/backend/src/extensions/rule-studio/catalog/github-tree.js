import { createHash } from 'node:crypto';
import { RULE_STUDIO_CATALOG_LIMITS } from '../constants';
import { RuleStudioError } from '../errors';
import { network, runBackendRequestTask } from '../sdk';

const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_ACCEPT = 'application/vnd.github+json';

function responseHeader(response, name) {
    const headers = response?.headers;
    if (typeof headers?.get === 'function') return headers.get(name);
    if (!headers || typeof headers !== 'object') return null;
    const match = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase());
    return match ? headers[match] : null;
}

function apiTreeUrl(catalog, ref, recursive = false) {
    const owner = encodeURIComponent(catalog.repository.owner);
    const repository = encodeURIComponent(catalog.repository.name);
    const tree = encodeURIComponent(ref);
    return `https://api.github.com/repos/${owner}/${repository}/git/trees/${tree}${recursive ? '?recursive=1' : ''}`;
}

async function loadTree(catalog, ref, { recursive = false } = {}) {
    let response;
    try {
        response = await runBackendRequestTask(
            () => network.get({
                url: apiTreeUrl(catalog, ref, recursive),
                headers: {
                    Accept: GITHUB_ACCEPT,
                    'X-GitHub-Api-Version': GITHUB_API_VERSION,
                    'User-Agent': 'Sub-Store-Rule-Studio',
                },
                timeout: RULE_STUDIO_CATALOG_LIMITS.networkTimeoutMs,
            }),
            'rule-studio-source-catalog',
        );
    } catch (error) {
        throw new RuleStudioError(
            error?.code === 'ETIMEDOUT'
                ? 'RULE_STUDIO_CATALOG_FETCH_TIMEOUT'
                : 'RULE_STUDIO_CATALOG_FETCH_FAILED',
            error?.code === 'ETIMEDOUT'
                ? '规则库目录请求超时'
                : '规则库目录获取失败',
            undefined,
            error?.code === 'ETIMEDOUT' ? 504 : 502,
        );
    }

    const statusCode = Number(response?.statusCode || response?.status || 0);
    const remaining = responseHeader(response, 'x-ratelimit-remaining');
    const retryAfter = responseHeader(response, 'retry-after');
    if (
        statusCode === 429 ||
        (statusCode === 403 && (`${remaining}` === '0' || retryAfter != null))
    ) {
        throw new RuleStudioError(
            'RULE_STUDIO_CATALOG_RATE_LIMITED',
            'GitHub 规则库请求次数已达上限，请稍后重试',
            undefined,
            503,
        );
    }
    if (statusCode && (statusCode < 200 || statusCode >= 300)) {
        throw new RuleStudioError(
            'RULE_STUDIO_CATALOG_FETCH_FAILED',
            `规则库目录返回 HTTP ${statusCode}`,
            undefined,
            502,
        );
    }

    let payload;
    try {
        payload = JSON.parse(`${response?.body ?? ''}`);
    } catch {
        throw new RuleStudioError(
            'RULE_STUDIO_CATALOG_RESPONSE_INVALID',
            '规则库目录响应格式无效',
            undefined,
            502,
        );
    }
    if (!payload || !Array.isArray(payload.tree)) {
        throw new RuleStudioError(
            'RULE_STUDIO_CATALOG_RESPONSE_INVALID',
            '规则库目录响应缺少文件树',
            undefined,
            502,
        );
    }
    if (payload.truncated === true) {
        throw new RuleStudioError(
            'RULE_STUDIO_CATALOG_TRUNCATED',
            '规则库目录响应不完整，已拒绝使用残缺索引',
            undefined,
            502,
        );
    }
    return payload.tree;
}

function treeSha(tree, segment) {
    const entry = tree.find(item => item?.type === 'tree' && item.path === segment);
    if (typeof entry?.sha !== 'string' || !entry.sha) {
        throw new RuleStudioError(
            'RULE_STUDIO_CATALOG_PATH_NOT_FOUND',
            '规则库目录结构已变化，找不到配置的规则目录',
            undefined,
            502,
        );
    }
    return entry.sha;
}

function encodedPath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
}

function fileName(path) {
    const basename = path.split('/').pop() || path;
    const dot = basename.lastIndexOf('.');
    return dot > 0 ? basename.slice(0, dot) : basename;
}

function category(path) {
    const segments = path.split('/');
    return segments.length > 1 ? segments[0] : '其他';
}

function itemId(catalog, path) {
    return createHash('sha256')
        .update(`${catalog.id}\0${path}`)
        .digest('hex')
        .slice(0, 24);
}

function rawUrl(catalog, path) {
    const owner = encodeURIComponent(catalog.repository.owner);
    const repository = encodeURIComponent(catalog.repository.name);
    const ref = encodeURIComponent(catalog.repository.ref);
    const fullPath = [catalog.rootPath, path].filter(Boolean).join('/');
    return `https://raw.githubusercontent.com/${owner}/${repository}/${ref}/${encodedPath(fullPath)}`;
}

function isSupportedFile(catalog, item) {
    if (item?.type !== 'blob' || typeof item.path !== 'string') return false;
    if (
        item.path.startsWith('/') ||
        item.path.includes('\\') ||
        item.path.split('/').some(segment => !segment || segment === '.' || segment === '..')
    ) {
        return false;
    }
    const lowerPath = item.path.toLowerCase();
    return catalog.fileExtensions.some(extension => lowerPath.endsWith(extension.toLowerCase()));
}

export async function fetchGitHubCatalogItems(catalog) {
    const segments = catalog.rootPath.split('/').filter(Boolean);
    let ref = catalog.repository.ref;
    for (const segment of segments) {
        ref = treeSha(await loadTree(catalog, ref), segment);
    }
    const subtree = await loadTree(catalog, ref, { recursive: true });
    return subtree
        .filter(item => isSupportedFile(catalog, item))
        .map(item => ({
            id: itemId(catalog, item.path),
            name: fileName(item.path),
            category: category(item.path),
            path: item.path,
            url: rawUrl(catalog, item.path),
            format: catalog.format,
            ...(Number.isFinite(Number(item.size)) ? { size: Number(item.size) } : {}),
        }))
        .sort((left, right) => left.path.localeCompare(right.path, 'en'));
}
