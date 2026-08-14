export const RULE_STUDIO_EXTENSION_ID = 'org.substore.rule-studio';
export const RULE_STUDIO_MAX_ENABLED_SOURCES = 20;
export const RULE_STUDIO_COMMANDS = {
  add: `${RULE_STUDIO_EXTENSION_ID}.add`,
  catalogs: `${RULE_STUDIO_EXTENSION_ID}.catalogs`,
  addCatalog: `${RULE_STUDIO_EXTENSION_ID}.catalogs.add`,
} as const;

export const RULE_STUDIO_FORMATS: Array<{ value: RuleStudioFormat; key: string }> = [
  { value: 'auto', key: 'auto' },
  { value: 'surge', key: 'surge' },
  { value: 'qx', key: 'qx' },
  { value: 'loon', key: 'loon' },
  { value: 'clash-classical-yaml', key: 'clashClassicalYaml' },
  { value: 'clash-classical-text', key: 'clashClassicalText' },
  { value: 'clash-domain-yaml', key: 'clashDomain' },
  { value: 'clash-ipcidr-yaml', key: 'clashIpcidr' },
];

export const RULE_STUDIO_REPRESENTATIONS: Array<{ value: RuleStudioRepresentation; key: string }> = [
  { value: 'surge-rule-list', key: 'surge' },
  { value: 'qx-filter', key: 'qx' },
  { value: 'loon-rule-list', key: 'loon' },
  { value: 'clash-classical-yaml', key: 'clashClassicalYaml' },
  { value: 'clash-classical-text', key: 'clashClassicalText' },
  { value: 'clash-domain-yaml', key: 'clashDomain' },
  { value: 'clash-ipcidr-yaml', key: 'clashIpcidr' },
  { value: 'normalized-json', key: 'normalized' },
];
