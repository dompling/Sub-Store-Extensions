import manifest from './manifest.json';
import { initializeRuleStudioStore } from './store';

export function createRuleStudioAdapter({ initializeStore } = {}) {
    let active = false;
    const initialize = initializeStore || initializeRuleStudioStore;
    return {
        extensionId: manifest.id,
        manifest,
        activate() {
            if (active) return this.health();
            initialize();
            active = true;
            return this.health();
        },
        deactivate() {
            active = false;
            return this.health();
        },
        health() {
            return {
                active,
                implementationAbi: manifest.host.implementationAbi,
            };
        },
    };
}

export default createRuleStudioAdapter;
