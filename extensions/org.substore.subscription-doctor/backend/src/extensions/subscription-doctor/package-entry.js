import { createSubscriptionDoctorAdapter } from './adapter';
import { subscriptionDoctorExtension } from './index';
import {
    bindSubscriptionDoctorSdk,
    unbindSubscriptionDoctorSdk,
} from './sdk';
import {
    SUBSCRIPTION_DOCTOR_EXTENSION_ID,
    SUBSCRIPTION_DOCTOR_IMPLEMENTATION_ABI,
} from './constants';

export const extensionId = SUBSCRIPTION_DOCTOR_EXTENSION_ID;
export const implementationAbi = SUBSCRIPTION_DOCTOR_IMPLEMENTATION_ABI;

let adapter = null;
let contributionRegistered = false;

function assertHost(host) {
    if (
        !host ||
        host.apiVersion !== '1.0.0' ||
        host.extensionId !== extensionId ||
        !host.services
    ) {
        const error = new Error('Subscription Doctor Host API is incompatible');
        error.code = 'EXTENSION_HOST_API_INCOMPATIBLE';
        throw error;
    }
}

export function activate(host) {
    assertHost(host);
    bindSubscriptionDoctorSdk(host.services);
    adapter = createSubscriptionDoctorAdapter();
    try {
        host.registerAdapter(adapter);
        host.registerContribution(subscriptionDoctorExtension);
        contributionRegistered = true;
        return host.activate();
    } catch (error) {
        if (contributionRegistered) host.unregisterContribution();
        if (adapter) host.unregisterAdapter(adapter);
        contributionRegistered = false;
        adapter = null;
        unbindSubscriptionDoctorSdk();
        throw error;
    }
}

export function deactivate(host) {
    let result;
    try {
        result = host?.deactivate?.();
    } finally {
        if (contributionRegistered) host?.unregisterContribution?.();
        if (adapter) host?.unregisterAdapter?.(adapter);
        contributionRegistered = false;
        adapter = null;
        unbindSubscriptionDoctorSdk();
    }
    return result;
}

