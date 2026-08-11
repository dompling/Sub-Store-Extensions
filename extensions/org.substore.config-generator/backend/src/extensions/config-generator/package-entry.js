import { createConfigGeneratorAdapter } from './adapter';
import { configGeneratorExtension } from './index';
import {
    bindConfigGeneratorSdk,
    unbindConfigGeneratorSdk,
} from './sdk';

export const extensionId = 'org.substore.config-generator';
export const implementationAbi = 'config-generator@1';

let adapter = null;
let contributionRegistered = false;

function assertHost(host) {
    if (
        !host ||
        host.apiVersion !== '1.0.0' ||
        host.extensionId !== extensionId ||
        !host.services
    ) {
        const error = new Error('Config generator Host API is incompatible');
        error.code = 'EXTENSION_HOST_API_INCOMPATIBLE';
        throw error;
    }
}

export function activate(host) {
    assertHost(host);
    bindConfigGeneratorSdk(host.services);
    adapter = createConfigGeneratorAdapter();
    try {
        host.registerAdapter(adapter);
        host.registerContribution(configGeneratorExtension);
        contributionRegistered = true;
        return host.activate();
    } catch (error) {
        if (contributionRegistered) host.unregisterContribution();
        host.unregisterAdapter(adapter);
        contributionRegistered = false;
        adapter = null;
        unbindConfigGeneratorSdk();
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
        unbindConfigGeneratorSdk();
    }
    return result;
}
