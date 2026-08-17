import { defineStore } from '@/extensions/frontend-sdk-v1';
import { useRuleStudioApi } from './api';

const api = useRuleStudioApi();

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object';

const unwrap = <T>(response: any, fallback: T): T => {
  const envelope = response?.data;
  if (envelope?.status === 'failed') {
    const error = new Error(envelope.error?.message || 'RULE_STUDIO_REQUEST_FAILED') as Error & {
      code?: string;
      details?: unknown;
    };
    error.code = envelope.error?.code;
    error.details = envelope.error?.details;
    throw error;
  }
  const data = isRecord(envelope) && 'data' in envelope ? envelope.data : envelope;
  return (data ?? fallback) as T;
};

const messageFrom = (error: unknown, fallback: string) => error instanceof Error
  ? error.message || fallback
  : fallback;

export const useRuleStudioStore = defineStore('ruleStudio', {
  state: () => ({
    projects: [] as RuleStudioDescriptor[],
    archivedProjects: [] as RuleStudioDescriptor[],
    sourceCatalogs: [] as RuleStudioSourceCatalog[],
    sourceCatalogResults: {} as Record<string, RuleStudioCatalogItemsResult>,
    previewDraft: null as { project: RuleStudioProject; output: RuleStudioOutput } | null,
    loading: false,
    catalogLoading: false,
    error: '',
  }),
  actions: {
    async fetchProjects(includeArchived = false) {
      this.loading = true;
      this.error = '';
      try {
        const items = unwrap<RuleStudioDescriptor[]>(await api.getProjects(includeArchived), []);
        this.projects = items.filter(item => item.lifecycle.state !== 'archived');
        this.archivedProjects = items.filter(item => item.lifecycle.state === 'archived');
        return true;
      } catch (error) {
        this.error = messageFrom(error, 'RULE_STUDIO_LOAD_FAILED');
        return false;
      } finally {
        this.loading = false;
      }
    },
    async getProject(id: string) {
      try {
        return unwrap<RuleStudioProject | null>(await api.getProject(id), null);
      } catch (error) {
        this.error = messageFrom(error, 'RULE_STUDIO_LOAD_FAILED');
        return null;
      }
    },
    async saveProject(project: Partial<RuleStudioProject>, editing: boolean) {
      this.error = '';
      try {
        return unwrap<RuleStudioProject | null>(
          editing
            ? await api.updateProject(project.id!, project)
            : await api.createProject(project),
          null,
        );
      } catch (error) {
        this.error = messageFrom(error, 'RULE_STUDIO_SAVE_FAILED');
        return null;
      }
    },
    async archiveProject(id: string) {
      try {
        unwrap(await api.archiveProject(id), null);
        await this.fetchProjects(true);
        return true;
      } catch (error) {
        this.error = messageFrom(error, 'RULE_STUDIO_ARCHIVE_FAILED');
        return false;
      }
    },
    async deleteProject(id: string) {
      try {
        unwrap(await api.deleteProject(id), null);
        await this.fetchProjects(true);
        return true;
      } catch (error) {
        this.error = messageFrom(error, 'RULE_STUDIO_DELETE_FAILED');
        return false;
      }
    },
    async restoreProject(id: string) {
      try {
        unwrap(await api.restoreProject(id), null);
        await this.fetchProjects(true);
        return true;
      } catch (error) {
        this.error = messageFrom(error, 'RULE_STUDIO_RESTORE_FAILED');
        return false;
      }
    },
    async preview(project: RuleStudioProject, representation: RuleStudioRepresentation, forceRefresh = false) {
      this.error = '';
      try {
        return unwrap<RuleStudioOutput | null>(await api.preview({ project, representation, forceRefresh }), null);
      } catch (error) {
        this.error = messageFrom(error, 'RULE_STUDIO_PREVIEW_FAILED');
        return null;
      }
    },
    async refresh(id: string) {
      try {
        const result = unwrap<RuleStudioOutput | null>(await api.refresh(id), null);
        await this.fetchProjects(true);
        return result;
      } catch (error) {
        this.error = messageFrom(error, 'RULE_STUDIO_REFRESH_FAILED');
        return null;
      }
    },
    async fetchSourceCatalogs() {
      this.catalogLoading = true;
      this.error = '';
      try {
        this.sourceCatalogs = unwrap<RuleStudioSourceCatalog[]>(
          await api.getSourceCatalogs(),
          [],
        );
        return this.sourceCatalogs;
      } catch (error) {
        this.error = messageFrom(error, 'RULE_STUDIO_CATALOG_LOAD_FAILED');
        return [];
      } finally {
        this.catalogLoading = false;
      }
    },
    async saveCatalogSettings(enabledCatalogIds: string[]) {
      this.catalogLoading = true;
      this.error = '';
      try {
        unwrap<RuleStudioCatalogSettings>(
          await api.updateSourceCatalogSettings(enabledCatalogIds),
          { enabledCatalogIds: [] },
        );
        await this.fetchSourceCatalogs();
        return true;
      } catch (error) {
        this.error = messageFrom(error, 'RULE_STUDIO_CATALOG_SETTINGS_SAVE_FAILED');
        return false;
      } finally {
        this.catalogLoading = false;
      }
    },
    async createCustomCatalog(input: RuleStudioCustomCatalogInput) {
      this.catalogLoading = true;
      this.error = '';
      try {
        const catalog = unwrap<RuleStudioSourceCatalog | null>(
          await api.createSourceCatalog(input),
          null,
        );
        await this.fetchSourceCatalogs();
        return catalog;
      } catch (error) {
        this.error = messageFrom(error, 'RULE_STUDIO_CUSTOM_CATALOG_CREATE_FAILED');
        return null;
      } finally {
        this.catalogLoading = false;
      }
    },
    async updateCustomCatalog(id: string, input: RuleStudioCustomCatalogInput) {
      this.catalogLoading = true;
      this.error = '';
      try {
        const catalog = unwrap<RuleStudioSourceCatalog | null>(
          await api.updateSourceCatalog(id, input),
          null,
        );
        await this.fetchSourceCatalogs();
        return catalog;
      } catch (error) {
        this.error = messageFrom(error, 'RULE_STUDIO_CUSTOM_CATALOG_UPDATE_FAILED');
        return null;
      } finally {
        this.catalogLoading = false;
      }
    },
    async deleteCustomCatalog(id: string) {
      this.catalogLoading = true;
      this.error = '';
      try {
        unwrap(await api.deleteSourceCatalog(id), null);
        delete this.sourceCatalogResults[id];
        await this.fetchSourceCatalogs();
        return true;
      } catch (error) {
        this.error = messageFrom(error, 'RULE_STUDIO_CUSTOM_CATALOG_DELETE_FAILED');
        return false;
      } finally {
        this.catalogLoading = false;
      }
    },
    async fetchSourceCatalogItems(id: string, refresh = false) {
      this.catalogLoading = true;
      this.error = '';
      try {
        const result = unwrap<RuleStudioCatalogItemsResult | null>(
          await api.getSourceCatalogItems(id, refresh),
          null,
        );
        if (result) this.sourceCatalogResults[id] = result;
        return result;
      } catch (error) {
        this.error = messageFrom(error, 'RULE_STUDIO_CATALOG_LOAD_FAILED');
        return null;
      } finally {
        this.catalogLoading = false;
      }
    },
    setPreviewDraft(project: RuleStudioProject, output: RuleStudioOutput) {
      this.previewDraft = { project, output };
    },
    takePreviewDraft() {
      const draft = this.previewDraft;
      this.previewDraft = null;
      return draft;
    },
  },
});
