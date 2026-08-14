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
