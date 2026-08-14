import { SUBSCRIPTION_DOCTOR_EXTENSION_ID } from './constants';
import { SubscriptionDoctorError } from './errors';

let hostServices = null;

function services() {
    if (!hostServices) {
        throw new SubscriptionDoctorError(
            'EXTENSION_HOST_SDK_UNAVAILABLE',
            'Subscription Doctor Host SDK is unavailable',
            { statusCode: 503 },
        );
    }
    return hostServices;
}

function assertMethod(parent, method) {
    const value = parent?.[method];
    if (typeof value !== 'function') {
        throw new SubscriptionDoctorError(
            'EXTENSION_HOST_API_INCOMPATIBLE',
            `Subscription Doctor requires Host resources.${method}()`,
            { statusCode: 409 },
        );
    }
    return value.bind(parent);
}

export function bindSubscriptionDoctorSdk(value) {
    if (
        !value ||
        value.apiVersion !== '1.0.0' ||
        value.extensionId !== SUBSCRIPTION_DOCTOR_EXTENSION_ID ||
        !value.storage ||
        !value.resources
    ) {
        throw new SubscriptionDoctorError(
            'EXTENSION_HOST_API_INCOMPATIBLE',
            'Subscription Doctor Host SDK is incompatible',
            { statusCode: 409 },
        );
    }
    assertMethod(value.storage, 'read');
    assertMethod(value.storage, 'write');
    assertMethod(value.resources, 'list');
    assertMethod(value.resources, 'get');
    assertMethod(value.resources, 'produce');
    hostServices = value;
}

export function unbindSubscriptionDoctorSdk() {
    hostServices = null;
}

export const storage = Object.freeze({
    read: () => services().storage.read(),
    write: (value) => services().storage.write(value),
});

export const resources = Object.freeze({
    list: (options) => services().resources.list(options),
    get: (ref) => services().resources.get(ref),
    produce: (ref, options) => services().resources.produce(ref, options),
});

