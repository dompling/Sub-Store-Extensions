import { findByName, storage } from './sdk';

export const CONFIG_GENERATOR_STORE_VERSION = 2;

export function migrateConfigGeneratorStore(value) {
    return {
        version: CONFIG_GENERATOR_STORE_VERSION,
        projects: Array.isArray(value?.projects) ? value.projects : [],
        ruleSets: Array.isArray(value?.ruleSets) ? value.ruleSets : [],
        referenceIndex:
            value?.referenceIndex && typeof value.referenceIndex === 'object'
                ? value.referenceIndex
                : { state: 'unknown' },
    };
}

export function readConfigGeneratorStore() {
    return migrateConfigGeneratorStore(storage.read());
}

export function writeConfigGeneratorStore(store) {
    const normalized = migrateConfigGeneratorStore({
        ...store,
        projects: store.projects || [],
        ruleSets: store.ruleSets || [],
    });
    storage.write(normalized);
    return normalized;
}

export function initializeConfigGeneratorStore() {
    const current = storage.read();
    if (!current || current.version !== CONFIG_GENERATOR_STORE_VERSION)
        writeConfigGeneratorStore(migrateConfigGeneratorStore(current));
}

export function getProject(name) {
    return findByName(readConfigGeneratorStore().projects, name);
}

export function getRuleSet(name) {
    return findByName(readConfigGeneratorStore().ruleSets, name);
}
