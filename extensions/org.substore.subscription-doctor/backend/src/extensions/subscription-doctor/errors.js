const SAFE_CODES = new Set([
    'RESOURCE_REF_INVALID',
    'RESOURCE_NOT_FOUND',
    'RESOURCE_PROVIDER_NOT_INSTALLED',
    'RESOURCE_PROVIDER_DISABLED',
    'RESOURCE_PROVIDER_UPDATING',
    'RESOURCE_CONTRACT_INCOMPATIBLE',
    'RESOURCE_REPRESENTATION_UNSUPPORTED',
    'RESOURCE_CONTENT_INVALID',
    'RESOURCE_UPSTREAM_FETCH_FAILED',
    'RESOURCE_UPSTREAM_TIMEOUT',
    'EXTENSION_PERMISSION_DENIED',
    'EXTENSION_PERMISSION_SCOPE_DENIED',
]);

const STATUS_BY_CODE = Object.freeze({
    RESOURCE_REF_INVALID: 400,
    RESOURCE_REPRESENTATION_UNSUPPORTED: 400,
    EXTENSION_PERMISSION_DENIED: 403,
    EXTENSION_PERMISSION_SCOPE_DENIED: 403,
    RESOURCE_NOT_FOUND: 404,
    RESOURCE_PROVIDER_NOT_INSTALLED: 409,
    RESOURCE_PROVIDER_DISABLED: 409,
    RESOURCE_PROVIDER_UPDATING: 409,
    RESOURCE_CONTRACT_INCOMPATIBLE: 409,
    RESOURCE_CONTENT_INVALID: 422,
    RESOURCE_UPSTREAM_FETCH_FAILED: 502,
    RESOURCE_UPSTREAM_TIMEOUT: 504,
});

const MESSAGE_BY_CODE = Object.freeze({
    RESOURCE_REF_INVALID: 'Resource reference is invalid',
    RESOURCE_REPRESENTATION_UNSUPPORTED: 'Resource representation is unsupported',
    EXTENSION_PERMISSION_DENIED: 'Subscription Doctor does not have the required permission',
    EXTENSION_PERMISSION_SCOPE_DENIED: 'Resource type is outside Subscription Doctor permission scope',
    RESOURCE_NOT_FOUND: 'The selected resource was not found',
    RESOURCE_PROVIDER_NOT_INSTALLED: 'The resource provider is not installed',
    RESOURCE_PROVIDER_DISABLED: 'The resource provider is disabled',
    RESOURCE_PROVIDER_UPDATING: 'The resource provider is updating',
    RESOURCE_CONTRACT_INCOMPATIBLE: 'The resource contract is incompatible',
    RESOURCE_CONTENT_INVALID: 'The resource did not produce valid node content',
    RESOURCE_UPSTREAM_FETCH_FAILED: 'The provider could not fetch the resource',
    RESOURCE_UPSTREAM_TIMEOUT: 'The provider timed out while producing the resource',
});

function plainDetails(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const details = {};
    for (const key of ['field', 'type', 'representation', 'reasonCode']) {
        const candidate = `${value[key] ?? ''}`;
        if (/^[A-Za-z0-9_.\[\]-]{1,128}$/.test(candidate)) {
            details[key] = candidate;
        }
    }
    return Object.keys(details).length ? details : undefined;
}

export class SubscriptionDoctorError extends Error {
    constructor(code, message, { statusCode = 400, details } = {}) {
        super(message || code);
        this.name = 'SubscriptionDoctorError';
        this.code = code;
        this.statusCode = statusCode;
        this.details = plainDetails(details);
    }
}

export function normalizePublicError(error) {
    if (error instanceof SubscriptionDoctorError) return error;
    const code = SAFE_CODES.has(error?.code)
        ? error.code
        : 'SUBSCRIPTION_DOCTOR_CHECK_FAILED';
    return new SubscriptionDoctorError(
        code,
        SAFE_CODES.has(error?.code)
            ? MESSAGE_BY_CODE[code] || code
            : 'Subscription health check could not be completed',
        {
            statusCode:
                STATUS_BY_CODE[code] ||
                (Number.isInteger(error?.statusCode)
                    ? error.statusCode
                    : 502),
            details: error?.details,
        },
    );
}

export function success(response, data, statusCode = 200) {
    response.status(statusCode).json({ status: 'success', data });
}

export function failed(response, input) {
    const error = normalizePublicError(input);
    response.status(error.statusCode).json({
        status: 'failed',
        error: {
            code: error.code,
            type: error.name,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
        },
    });
}
