import { RULE_STUDIO_STORE_SCHEMA_VERSION } from './constants';
import { RuleStudioError } from './errors';
import { storage } from './sdk';
import { normalizeStoredCustomCatalog } from './catalog/custom';

const emptyStore = () => ({
    schemaVersion: RULE_STUDIO_STORE_SCHEMA_VERSION,
    projects: [],
    catalogSettings: {
        enabledCatalogIds: [],
        customCatalogs: [],
    },
});

function normalizeCatalogSettings(value) {
    const ids = Array.isArray(value?.enabledCatalogIds)
        ? value.enabledCatalogIds.filter(id => typeof id === 'string' && id)
        : [];
    const customCatalogs = Array.isArray(value?.customCatalogs)
        ? value.customCatalogs.map(normalizeStoredCustomCatalog)
        : [];
    const uniqueCatalogs = [...new Map(customCatalogs.map(catalog => [catalog.id, catalog])).values()];
    return {
        enabledCatalogIds: [...new Set(ids)],
        customCatalogs: uniqueCatalogs,
    };
}

function normalizeStore(value) {
    if (value == null) return emptyStore();
    if (![1, 2, RULE_STUDIO_STORE_SCHEMA_VERSION].includes(value.schemaVersion)) {
        throw new RuleStudioError(
            'RULE_STUDIO_STORE_SCHEMA_UNSUPPORTED',
            `不支持规则集配置存储版本 ${value.schemaVersion}`,
            undefined,
            409,
        );
    }
    if (!Array.isArray(value.projects)) {
        throw new RuleStudioError(
            'RULE_STUDIO_STORE_INVALID',
            '规则集配置存储已损坏',
            undefined,
            409,
        );
    }
    return {
        schemaVersion: RULE_STUDIO_STORE_SCHEMA_VERSION,
        projects: value.projects,
        catalogSettings: value.schemaVersion < 3
            ? normalizeCatalogSettings({
                enabledCatalogIds: value.schemaVersion === 1
                    ? []
                    : value.catalogSettings?.enabledCatalogIds,
            })
            : normalizeCatalogSettings(value.catalogSettings),
    };
}

export function readRuleStudioStore() {
    return normalizeStore(storage.read());
}

export function writeRuleStudioStore(store) {
    const normalized = normalizeStore(store);
    storage.write(normalized);
    return normalized;
}

export function initializeRuleStudioStore() {
    const normalized = normalizeStore(storage.read());
    storage.write(normalized);
    return normalized;
}

export function findProjectById(store, id) {
    return store.projects.find(project => project.id === id) || null;
}

export function findProjectByName(store, name) {
    return store.projects.find(project => project.name === name) || null;
}

export function replaceProject(store, next) {
    const index = store.projects.findIndex(project => project.id === next.id);
    if (index < 0) store.projects.push(next);
    else store.projects[index] = next;
    return next;
}

export function replaceCatalogSettings(store, settings) {
    store.catalogSettings = normalizeCatalogSettings({
        ...store.catalogSettings,
        ...settings,
    });
    return store.catalogSettings;
}

export function replaceCustomCatalog(store, catalog) {
    const customCatalogs = [...store.catalogSettings.customCatalogs];
    const index = customCatalogs.findIndex(item => item.id === catalog.id);
    if (index < 0) customCatalogs.push(catalog);
    else customCatalogs[index] = catalog;
    store.catalogSettings = normalizeCatalogSettings({
        ...store.catalogSettings,
        customCatalogs,
    });
    return store.catalogSettings.customCatalogs.find(item => item.id === catalog.id);
}

export function removeCustomCatalog(store, id) {
    const customCatalogs = store.catalogSettings.customCatalogs.filter(item => item.id !== id);
    store.catalogSettings = normalizeCatalogSettings({
        enabledCatalogIds: store.catalogSettings.enabledCatalogIds.filter(item => item !== id),
        customCatalogs,
    });
}
