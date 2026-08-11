let hostServices = null;

function services() {
    if (!hostServices) {
        const error = new Error('Config generator Host SDK is not bound');
        error.code = 'EXTENSION_HOST_SDK_UNAVAILABLE';
        throw error;
    }
    return hostServices;
}

export function bindConfigGeneratorSdk(value) {
    if (
        !value ||
        value.apiVersion !== '1.0.0' ||
        value.extensionId !== 'org.substore.config-generator'
    ) {
        const error = new Error('Config generator Host SDK is incompatible');
        error.code = 'EXTENSION_HOST_API_INCOMPATIBLE';
        throw error;
    }
    hostServices = value;
}

export function unbindConfigGeneratorSdk() {
    hostServices = null;
}

export const storage = Object.freeze({
    read: () => services().storage.read(),
    write: (value) => services().storage.write(value),
});

export const resources = Object.freeze({
    listArtifacts: () => services().resources.listArtifacts(),
});

export const network = Object.freeze({
    get: (options) => services().network.get(options),
});

export const transform = Object.freeze({
    processResponse: (...args) => services().transform.processResponse(...args),
});

export const cache = Object.freeze({
    get: (...args) => services().cache.get(...args),
    set: (...args) => services().cache.set(...args),
});

export function runBackendRequestTask(task, label) {
    return services().tasks.runRequest(task, label);
}

class BaseError {
    constructor(code, message, details) {
        this.code = code;
        this.message = message;
        this.details = details;
    }
}

export class RequestInvalidError extends BaseError {
    constructor(code, message, details) {
        super(code, message, details);
        this.type = 'RequestInvalidError';
    }
}

export class ResourceNotFoundError extends BaseError {
    constructor(code, message, details) {
        super(code, message, details);
        this.type = 'ResourceNotFoundError';
    }
}

export function success(resp, data, statusCode) {
    resp.status(statusCode || 200).json({ status: 'success', data });
}

export function failed(resp, error, statusCode) {
    resp.status(statusCode || 500).json({
        status: 'failed',
        error: {
            code: error.code,
            type: error.type,
            message: error.message,
            details: resp.req?.route?.path?.startsWith('/share/')
                ? '详情请查看日志'
                : error.details,
        },
    });
}

export function findByName(list, name, field = 'name') {
    return list.find((item) => item[field] === name);
}

export function deleteByName(list, name, field = 'name') {
    const index = list.findIndex((item) => item[field] === name);
    if (index >= 0) list.splice(index, 1);
}

export function updateByName(list, name, newItem, field = 'name') {
    const index = list.findIndex((item) => item[field] === name);
    if (index >= 0) list[index] = newItem;
}
