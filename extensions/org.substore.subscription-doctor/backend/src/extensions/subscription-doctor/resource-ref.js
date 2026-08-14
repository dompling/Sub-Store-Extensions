import { RESOURCE_REF_SCHEMA } from './constants';
import { SubscriptionDoctorError } from './errors';

const TYPE_CONTRACT = Object.freeze({
    subscription: 'substore.subscription@1',
    collection: 'substore.collection@1',
});
const SAFE_ID = /^[^\u0000-\u001f\u007f]{1,512}$/;

export function normalizeResourceRef(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new SubscriptionDoctorError(
            'RESOURCE_REF_INVALID',
            'Resource reference must be an object',
        );
    }
    const normalized = {};
    for (const field of [
        'schema',
        'providerId',
        'providerContributionId',
        'type',
        'id',
        'contract',
    ]) {
        if (typeof input[field] !== 'string' || !SAFE_ID.test(input[field])) {
            throw new SubscriptionDoctorError(
                'RESOURCE_REF_INVALID',
                `Resource reference ${field} is invalid`,
                { details: { field } },
            );
        }
        normalized[field] = input[field];
    }
    if (normalized.schema !== RESOURCE_REF_SCHEMA) {
        throw new SubscriptionDoctorError(
            'RESOURCE_REF_INVALID',
            'Resource reference schema is unsupported',
            { details: { field: 'schema' } },
        );
    }
    if (!TYPE_CONTRACT[normalized.type]) {
        throw new SubscriptionDoctorError(
            'EXTENSION_PERMISSION_SCOPE_DENIED',
            `Resource type ${normalized.type} cannot be diagnosed`,
            { statusCode: 403, details: { type: normalized.type } },
        );
    }
    if (TYPE_CONTRACT[normalized.type] !== normalized.contract) {
        throw new SubscriptionDoctorError(
            'RESOURCE_CONTRACT_INCOMPATIBLE',
            `Resource contract ${normalized.contract} is incompatible`,
            { statusCode: 409, details: { type: normalized.type } },
        );
    }
    return Object.freeze(normalized);
}

export function resourceRefKey(input) {
    const ref = normalizeResourceRef(input);
    return [
        ref.providerId,
        ref.providerContributionId,
        ref.type,
        ref.id,
        ref.contract,
    ].join('\u0000');
}

