import { defineStore } from '@/extensions/frontend-sdk-v1';
import { useConfigGeneratorApi } from '@/extensions/config-generator/api';
import {
  apiErrorFromResponse,
  extractConfigGeneratorApiError,
  getConfigGeneratorErrorDetails,
  type ConfigGeneratorApiError,
} from '@/extensions/config-generator/domain/requestError';

const api = useConfigGeneratorApi();

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object';

class ConfigGeneratorRequestError extends Error {
  readonly code?: string;
  readonly type?: string;
  readonly details?: unknown;
  readonly issues?: unknown;

  constructor(error: ConfigGeneratorApiError = {}) {
    super(error.message || 'CONFIG_GENERATOR_REQUEST_FAILED');
    this.name = 'ConfigGeneratorRequestError';
    this.code = error.code;
    this.type = error.type;
    this.details = error.details;
    this.issues = error.issues;
  }
}

const unwrap = <T>(response: unknown, fallback: T): T => {
  const apiError = apiErrorFromResponse(response);
  if (apiError) {
    throw new ConfigGeneratorRequestError(apiError);
  }
  const responseData = isRecord(response) ? response.data : undefined;
  const data = isRecord(responseData) ? responseData.data ?? responseData : responseData;
  return (data ?? fallback) as T;
};

const unwrapList = <T>(response: any, key: string): T[] => {
  const data: any = unwrap(response, []);
  if (Array.isArray(data)) return data as T[];
  if (Array.isArray(data?.[key])) return data[key] as T[];
  return [];
};

const getErrorMessage = (error: unknown, fallback: string) => {
  const structuredError = extractConfigGeneratorApiError(error);
  if (structuredError?.message) return structuredError.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

const getErrorCode = (error: unknown) => {
  return extractConfigGeneratorApiError(error)?.code || '';
};

const getStructuredErrorDetails = (error: unknown): unknown[] =>
  getConfigGeneratorErrorDetails(error);

const scopedRuleSetDetails = (details: unknown[], name: string) => details.map((detail) => {
  if (isRecord(detail)) {
    return {
      ...detail,
      scope: { kind: 'ruleSet', name },
    };
  }
  return {
    message: String(detail),
    scope: { kind: 'ruleSet', name },
  };
});

type ConfigGeneratorPreviewDraft = {
  name: string;
  project: ConfigProject;
  ruleSets: RemoteRuleSet[];
  target: ConfigGeneratorTarget;
  body: string;
  stats?: Record<string, number>;
  warnings?: unknown[];
  errors?: unknown[];
  error?: string;
};

export const useConfigGeneratorStore = defineStore('configGenerator', {
  state: () => ({
    projects: [] as ConfigProject[],
    ruleSets: [] as RemoteRuleSet[],
    resourceRuleSets: [] as ResourceDescriptorV1[],
    previewDraft: null as ConfigGeneratorPreviewDraft | null,
    importedProject: null as ConfigProject | null,
    importedRuleSets: [] as RemoteRuleSet[],
    loading: false,
    error: '',
    healthErrorCode: '',
    previewErrors: [] as unknown[],
    validationErrors: [] as unknown[],
  }),
  actions: {
    async fetchProjects() {
      this.loading = true;
      try {
        this.projects = unwrapList<ConfigProject>(await api.getProjects(), 'projects');
        return true;
      } catch (error: any) {
        this.error = getErrorMessage(error, 'CONFIG_GENERATOR_LOAD_FAILED');
        return false;
      } finally {
        this.loading = false;
      }
    },
    async fetchRuleSets() {
      try {
        this.ruleSets = unwrapList<RemoteRuleSet>(await api.getRuleSets(), 'ruleSets');
        return true;
      } catch (error: any) {
        this.error = getErrorMessage(error, 'CONFIG_GENERATOR_RULE_SET_LOAD_FAILED');
        return false;
      }
    },
    async fetchResourceRuleSets() {
      try {
        this.resourceRuleSets = unwrapList<ResourceDescriptorV1>(
          await api.getResourceRuleSets(),
          'resources',
        );
        return true;
      } catch (error: any) {
        this.resourceRuleSets = [];
        this.error = getErrorMessage(error, 'CONFIG_GENERATOR_RESOURCE_RULE_SET_LOAD_FAILED');
        return false;
      }
    },
    async getProject(name: string) {
      return unwrap(await api.getProject(name), null) as ConfigProject | null;
    },
    async getProjectHealth(name: string) {
      this.error = '';
      this.healthErrorCode = '';
      try {
        return unwrap(
          await api.getProjectHealth(name),
          null,
        ) as ConfigGeneratorHealthReport | null;
      } catch (error: unknown) {
        this.healthErrorCode = getErrorCode(error);
        this.error = getErrorMessage(error, 'CONFIG_GENERATOR_HEALTH_FAILED');
        return null;
      }
    },
    async saveRuleSet(ruleSet: RemoteRuleSet, editing = false) {
      this.error = '';
      this.validationErrors = [];
      try {
        const response = editing
          ? await api.updateRuleSet(ruleSet.name, ruleSet)
          : await api.createRuleSet(ruleSet);
        unwrap(response, null);
        return true;
      } catch (error: unknown) {
        this.error = getErrorMessage(error, 'CONFIG_GENERATOR_RULE_SET_SAVE_FAILED');
        this.validationErrors = scopedRuleSetDetails(
          getStructuredErrorDetails(error),
          ruleSet.name,
        );
        return false;
      }
    },
    async removeRuleSet(name: string) {
      try {
        const response = await api.deleteRuleSet(name);
        unwrap(response, null);
        await this.fetchRuleSets();
        return true;
      } catch (error: any) {
        this.error = getErrorMessage(error, 'CONFIG_GENERATOR_RULE_SET_DELETE_FAILED');
        return false;
      }
    },
    async saveProject(project: ConfigProject, editing = false) {
      this.error = '';
      this.validationErrors = [];
      try {
        const response = editing
          ? await api.updateProject(project.name, project)
          : await api.createProject(project);
        unwrap(response, null);
        await this.fetchProjects();
        return true;
      } catch (error: unknown) {
        this.error = getErrorMessage(error, 'CONFIG_GENERATOR_SAVE_FAILED');
        this.validationErrors = getStructuredErrorDetails(error);
        return false;
      }
    },
    async removeProject(name: string) {
      try {
        const response = await api.deleteProject(name);
        unwrap(response, null);
        await this.fetchProjects();
        return true;
      } catch (error: any) {
        this.error = getErrorMessage(error, 'CONFIG_GENERATOR_DELETE_FAILED');
        return false;
      }
    },
    async preview(
      project: ConfigProject,
      ruleSets: RemoteRuleSet[] | undefined,
      target: ConfigGeneratorTarget,
    ) {
      this.error = '';
      this.previewErrors = [];
      try {
        return unwrap(await api.preview(target, { project, ruleSets }), null) as any;
      } catch (error: unknown) {
        this.error = getErrorMessage(error, 'CONFIG_GENERATOR_PREVIEW_FAILED');
        this.previewErrors = getStructuredErrorDetails(error);
        return null;
      }
    },
    setPreviewDraft(draft: ConfigGeneratorPreviewDraft) {
      this.previewDraft = draft;
    },
    clearValidationErrors() {
      this.validationErrors = [];
    },
    takePreviewDraft() {
      const draft = this.previewDraft;
      this.previewDraft = null;
      return draft;
    },
    async importConfig(target: ConfigGeneratorTarget, content: string, sourceContext?: unknown) {
      try {
        return unwrap(await api.importConfig(target, content, sourceContext), null) as ConfigImportDraft | null;
      } catch (error: any) {
        this.error = getErrorMessage(error, 'CONFIG_GENERATOR_IMPORT_FAILED');
        return null;
      }
    },
    setImportedProject(project: ConfigProject, ruleSets: RemoteRuleSet[] = []) {
      this.importedProject = project;
      this.importedRuleSets = ruleSets;
    },
    takeImportedProject() {
      const project = this.importedProject;
      this.importedProject = null;
      return project;
    },
    takeImportedRuleSets() {
      const ruleSets = this.importedRuleSets;
      this.importedRuleSets = [];
      return ruleSets;
    },
  },
});
