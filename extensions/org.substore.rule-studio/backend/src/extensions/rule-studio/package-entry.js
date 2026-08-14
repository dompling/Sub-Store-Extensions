import { createRuleStudioAdapter } from './adapter';
import { ruleStudioExtension } from './index';
import { bindRuleStudioSdk, unbindRuleStudioSdk } from './sdk';

export const extensionId = 'org.substore.rule-studio';
export const implementationAbi = 'rule-studio@1';

let adapter = null;
let contributionRegistered = false;

function assertHost(host) {
    if (
        !host ||
        host.apiVersion !== '1.0.0' ||
        host.extensionId !== extensionId ||
        !host.services
    ) {
        const error = new Error('Rule Studio Host API is incompatible');
        error.code = 'EXTENSION_HOST_API_INCOMPATIBLE';
        throw error;
    }
}

export function activate(host) {
    assertHost(host);
    bindRuleStudioSdk(host.services);
    adapter = createRuleStudioAdapter();
    try {
        host.registerAdapter(adapter);
        host.registerContribution(ruleStudioExtension);
        contributionRegistered = true;
        return host.activate();
    } catch (error) {
        if (contributionRegistered) host.unregisterContribution();
        host.unregisterAdapter(adapter);
        contributionRegistered = false;
        adapter = null;
        unbindRuleStudioSdk();
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
        unbindRuleStudioSdk();
    }
    return result;
}
