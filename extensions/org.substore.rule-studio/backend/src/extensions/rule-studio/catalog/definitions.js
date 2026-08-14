export const RULE_SOURCE_CATALOGS = Object.freeze([
    Object.freeze({
        id: 'blackmatrix7-surge',
        name: 'Blackmatrix7 · Surge',
        description: 'Blackmatrix7 iOS Rule Script 的 Surge 规则集',
        author: Object.freeze({
            name: 'Blackmatrix7',
            url: 'https://github.com/blackmatrix7',
        }),
        repository: Object.freeze({
            owner: 'blackmatrix7',
            name: 'ios_rule_script',
            ref: 'master',
            url: 'https://github.com/blackmatrix7/ios_rule_script',
        }),
        rootPath: 'rule/Surge',
        fileExtensions: Object.freeze(['.list']),
        format: 'surge',
    }),
]);

export function publicCatalog(catalog) {
    return {
        id: catalog.id,
        name: catalog.name,
        description: catalog.description,
        author: { ...catalog.author },
        repository: {
            owner: catalog.repository.owner,
            name: catalog.repository.name,
            ref: catalog.repository.ref,
            url: catalog.repository.url,
        },
        rootPath: catalog.rootPath,
        format: catalog.format,
        custom: catalog.custom === true,
        ...(catalog.directoryUrl ? { directoryUrl: catalog.directoryUrl } : {}),
    };
}

export function listRuleSourceCatalogs(customCatalogs = []) {
    return [...RULE_SOURCE_CATALOGS, ...customCatalogs].map(publicCatalog);
}

export function findRuleSourceCatalog(id, customCatalogs = []) {
    return [...RULE_SOURCE_CATALOGS, ...customCatalogs]
        .find(catalog => catalog.id === id) || null;
}
