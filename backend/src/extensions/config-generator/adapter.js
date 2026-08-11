import manifest from './manifest.json';
import { initializeConfigGeneratorStore } from './store';

export const CONFIG_GENERATOR_EXTENSION_ID = manifest.id;

export function createConfigGeneratorAdapter({ initializeStore } = {}) {
    let active = false;
    const initialize = initializeStore || initializeConfigGeneratorStore;
    return {
        extensionId: CONFIG_GENERATOR_EXTENSION_ID,
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

export default createConfigGeneratorAdapter;
