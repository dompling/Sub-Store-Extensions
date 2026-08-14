export const RULE_STUDIO_EXTENSION_ID = 'org.substore.rule-studio';
export const RULE_STUDIO_CONTRIBUTION_ID = `${RULE_STUDIO_EXTENSION_ID}.rule-sets`;
export const RULE_STUDIO_CONTRACT = 'substore.rule-set@1';
export const RULE_STUDIO_RESOURCE_TYPE = 'rule-set';
export const RULE_STUDIO_IMPLEMENTATION_ABI = 'rule-studio@1';
export const RULE_STUDIO_STORE_SCHEMA_VERSION = 3;
export const RULE_STUDIO_PARSER_VERSION = 'parser-1';

export const RULE_STUDIO_FORMATS = Object.freeze([
    'auto',
    'surge',
    'qx',
    'loon',
    'clash-classical-yaml',
    'clash-classical-text',
    'clash-domain-yaml',
    'clash-ipcidr-yaml',
]);

export const RULE_STUDIO_REPRESENTATIONS = Object.freeze([
    'normalized-json',
    'surge-rule-list',
    'qx-filter',
    'clash-classical-yaml',
    'clash-classical-text',
    'clash-domain-yaml',
    'clash-ipcidr-yaml',
    'loon-rule-list',
]);

export const RULE_STUDIO_LIMITS = Object.freeze({
    maxSourceBytes: 10 * 1024 * 1024,
    maxEnabledSources: 20,
    maxRules: 200000,
    networkTimeoutMs: 15000,
    maxConcurrency: 4,
    freshTtlMs: 60 * 60 * 1000,
    maxStaleMs: 7 * 24 * 60 * 60 * 1000,
});

export const RULE_STUDIO_CATALOG_LIMITS = Object.freeze({
    freshTtlMs: 24 * 60 * 60 * 1000,
    maxStaleMs: 7 * 24 * 60 * 60 * 1000,
    networkTimeoutMs: 15000,
});

export const PLATFORM_REPRESENTATION = Object.freeze({
    Surge: 'surge-rule-list',
    QX: 'qx-filter',
    Clash: 'clash-classical-yaml',
    Loon: 'loon-rule-list',
});
