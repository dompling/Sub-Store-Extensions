import { findByName, storage } from './sdk';

export function readConfigGeneratorStore() {
    const value = storage.read();
    return {
        version: 1,
        projects: Array.isArray(value?.projects) ? value.projects : [],
        ruleSets: Array.isArray(value?.ruleSets) ? value.ruleSets : [],
    };
}

export function writeConfigGeneratorStore(store) {
    const normalized = {
        version: 1,
        projects: store.projects || [],
        ruleSets: store.ruleSets || [],
    };
    storage.write(normalized);
    return normalized;
}

export function initializeConfigGeneratorStore() {
    if (!storage.read()) {
        writeConfigGeneratorStore({ projects: [], ruleSets: [] });
    }
}

export function getProject(name) {
    return findByName(readConfigGeneratorStore().projects, name);
}

export function getRuleSet(name) {
    return findByName(readConfigGeneratorStore().ruleSets, name);
}
