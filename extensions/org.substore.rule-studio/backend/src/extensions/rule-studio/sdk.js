let hostServices = null;

function services() {
    if (!hostServices) {
        const error = new Error('Rule Studio Host SDK is not bound');
        error.code = 'EXTENSION_HOST_SDK_UNAVAILABLE';
        throw error;
    }
    return hostServices;
}

export function bindRuleStudioSdk(value) {
    if (
        !value ||
        value.apiVersion !== '1.0.0' ||
        value.extensionId !== 'org.substore.rule-studio'
    ) {
        const error = new Error('Rule Studio Host SDK is incompatible');
        error.code = 'EXTENSION_HOST_API_INCOMPATIBLE';
        throw error;
    }
    hostServices = value;
}

export function unbindRuleStudioSdk() {
    hostServices = null;
}

export const storage = Object.freeze({
    read: () => services().storage.read(),
    write: value => services().storage.write(value),
});

export const network = Object.freeze({
    get: options => services().network.get(options),
});

function cleanGitHubToken(value) {
    const token = typeof value === 'string'
        ? value.trim().replace(/^(?:bearer|token)\s+/i, '')
        : '';
    if (!token || /[\r\n]/.test(token)) return '';
    return token;
}

function tokenFromRecord(record, keys) {
    if (!record || typeof record !== 'object') return '';
    for (const key of keys) {
        const token = cleanGitHubToken(record[key]);
        if (token) return token;
    }
    return '';
}

async function tokenFromReader(reader, keys) {
    if (typeof reader !== 'function') return '';
    for (const key of keys) {
        try {
            const value = await reader(key);
            const token = cleanGitHubToken(value) ||
                tokenFromRecord(value, ['token', 'accessToken', 'githubToken', 'value']);
            if (token) return token;
        } catch {
            // Optional Host services may reject unknown keys; keep anonymous fetch as fallback.
        }
    }
    return '';
}

function boundReader(record, method) {
    const reader = record?.[method];
    return typeof reader === 'function' ? key => reader.call(record, key) : null;
}

export const credentials = Object.freeze({
    async githubToken() {
        const current = services();
        const direct = cleanGitHubToken(current.githubToken) ||
            cleanGitHubToken(current.github?.token) ||
            cleanGitHubToken(current.github?.accessToken) ||
            tokenFromRecord(current.credentials, ['githubToken', 'github', 'GITHUB_TOKEN', 'GH_TOKEN']) ||
            tokenFromRecord(current.tokens, ['githubToken', 'github', 'GITHUB_TOKEN', 'GH_TOKEN']) ||
            tokenFromRecord(current.settings, ['githubToken', 'GITHUB_TOKEN', 'GH_TOKEN']) ||
            tokenFromRecord(current.config, ['githubToken', 'GITHUB_TOKEN', 'GH_TOKEN']) ||
            tokenFromRecord(current.environment, ['GITHUB_TOKEN', 'GH_TOKEN', 'SUB_STORE_GITHUB_TOKEN', 'SUBSTORE_GITHUB_TOKEN']);
        if (direct) return direct;

        const keys = [
            'github.token',
            'githubToken',
            'GITHUB_TOKEN',
            'GH_TOKEN',
            'SUB_STORE_GITHUB_TOKEN',
            'SUBSTORE_GITHUB_TOKEN',
        ];
        return await tokenFromReader(boundReader(current.github, 'getToken'), ['github']) ||
            await tokenFromReader(boundReader(current.credentials, 'get'), keys) ||
            await tokenFromReader(boundReader(current.secrets, 'get'), keys) ||
            await tokenFromReader(boundReader(current.settings, 'get'), keys) ||
            await tokenFromReader(boundReader(current.config, 'get'), keys) ||
            await tokenFromReader(boundReader(current.environment, 'get'), keys) ||
            tokenFromRecord(globalThis.process?.env, keys);
    },
});

export const cache = Object.freeze({
    get: (...args) => services().cache.get(...args),
    set: (...args) => services().cache.set(...args),
});

export const request = Object.freeze({
    resolveClientTarget(value) {
        const method = services().request?.resolveClientTarget;
        return typeof method === 'function' ? method(value) : null;
    },
});

export const resources = Object.freeze({
    list: options => {
        const method = services().resources?.list;
        if (typeof method !== 'function') {
            const error = new Error('Host Resource Broker list API is unavailable');
            error.code = 'EXTENSION_HOST_RESOURCE_BROKER_UNAVAILABLE';
            throw error;
        }
        return method(options);
    },
    get: ref => {
        const method = services().resources?.get;
        if (typeof method !== 'function') {
            const error = new Error('Host Resource Broker get API is unavailable');
            error.code = 'EXTENSION_HOST_RESOURCE_BROKER_UNAVAILABLE';
            throw error;
        }
        return method(ref);
    },
    produce: (ref, options) => {
        const method = services().resources?.produce;
        if (typeof method !== 'function') {
            const error = new Error('Host Resource Broker produce API is unavailable');
            error.code = 'EXTENSION_HOST_RESOURCE_BROKER_UNAVAILABLE';
            throw error;
        }
        return method(ref, options);
    },
});

export const references = Object.freeze({
    async listIncoming(ref) {
        try {
            const method = services().references?.listIncoming;
            if (typeof method !== 'function') {
                return { available: false, items: [] };
            }
            const result = await method(ref);
            if (Array.isArray(result)) {
                return { available: true, items: result };
            }
            if (!result || !Array.isArray(result.items)) {
                return { available: false, items: [] };
            }
            return {
                available: result.available !== false,
                items: result.items,
            };
        } catch {
            return { available: false, items: [] };
        }
    },
});

export function runBackendRequestTask(task, label) {
    return services().tasks.runRequest(task, label);
}

export function success(response, data, statusCode = 200) {
    response.status(statusCode).json({ status: 'success', data });
}

export function failed(response, error, statusCode = 500) {
    response.status(statusCode).json({
        status: 'failed',
        error: {
            code: error.code || 'RULE_STUDIO_OPERATION_FAILED',
            type: error.name || 'Error',
            message: error.message || '规则集配置操作失败',
            ...(error.details === undefined ? {} : { details: error.details }),
        },
    });
}
