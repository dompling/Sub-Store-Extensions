type RuleStudioFormat =
  | 'auto'
  | 'surge'
  | 'qx'
  | 'loon'
  | 'clash-classical-yaml'
  | 'clash-classical-text'
  | 'clash-domain-yaml'
  | 'clash-ipcidr-yaml';

type RuleStudioRepresentation =
  | 'normalized-json'
  | 'surge-rule-list'
  | 'qx-filter'
  | 'clash-classical-yaml'
  | 'clash-classical-text'
  | 'clash-domain-yaml'
  | 'clash-ipcidr-yaml'
  | 'loon-rule-list';

interface RuleStudioSource {
  id: string;
  kind: 'url' | 'inline';
  name?: string;
  url?: string;
  content?: string;
  enabled: boolean;
  format: RuleStudioFormat;
}

interface RuleStudioSourceCatalog {
  id: string;
  name: string;
  description?: string;
  author?: { name: string; url?: string };
  repository: {
    owner: string;
    name: string;
    ref: string;
    url?: string;
  };
  rootPath: string;
  directoryUrl?: string;
  format: RuleStudioFormat;
  custom?: boolean;
  enabled: boolean;
  cache?: {
    state: 'empty' | 'fresh' | 'stale' | 'expired';
    fetchedAt?: number;
    expiresAt?: number;
  };
}

interface RuleStudioCustomCatalogInput {
  url: string;
  name?: string;
  description?: string;
  authorName?: string;
  format: RuleStudioFormat;
}

interface RuleStudioCatalogSettings {
  enabledCatalogIds: string[];
}

interface RuleStudioCatalogItem {
  id: string;
  name: string;
  category: string;
  path: string;
  url: string;
  format: RuleStudioFormat;
  size?: number;
  catalogId?: string;
  catalogName?: string;
}

interface RuleStudioCatalogItemsResult {
  catalog: RuleStudioSourceCatalog;
  items: RuleStudioCatalogItem[];
  freshness: {
    state: 'fresh' | 'stale';
    fetchedAt?: number;
    expiresAt?: number;
  };
  warningCode?: string;
}

interface RuleStudioProject {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  lifecycle: { state: 'active' | 'archived'; archivedAt?: number };
  sources: RuleStudioSource[];
  options: { deduplicate: boolean; preserveComments: boolean };
  revision: number;
  createdAt: number;
  updatedAt: number;
  lastSummary?: {
    ruleCount: number;
    warningCount: number;
    errorCount: number;
    refreshedAt: number;
    freshness: 'fresh' | 'stale';
  };
  incoming?: { available: boolean; count: number; owners: unknown[] };
}

interface RuleStudioDescriptor {
  ref: { id: string };
  name: string;
  displayName?: string;
  description?: string;
  revision: number;
  updatedAt: number;
  lifecycle: { state: 'active' | 'archived'; archivedAt?: number };
  metadata: {
    sourceCount: number;
    enabledSourceCount: number;
    ruleCount: number;
    warningCount: number;
    errorCount: number;
    iconUrl?: string;
  };
}

interface RuleStudioDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  path?: string;
  sourceLine?: number;
  details?: { disposition?: 'exact' | 'fallback' | 'filtered' | 'invalid'; [key: string]: unknown };
}

interface RuleStudioOutput {
  representation: RuleStudioRepresentation;
  body: string;
  mediaType: string;
  sourceRevision: string;
  freshness: { state: 'fresh' | 'stale'; fetchedAt?: number; expiresAt?: number };
  diagnostics: RuleStudioDiagnostic[];
  stats: Record<string, number>;
}
