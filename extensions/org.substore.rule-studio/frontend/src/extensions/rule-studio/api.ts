import { request } from '@/extensions/frontend-sdk-v1';

export function useRuleStudioApi() {
  return {
    getProjects: (archived = false) => request({
      url: '/api/extensions/rule-studio/projects',
      method: 'get',
      params: archived ? { archived: true } : undefined,
    }),
    getProject: (id: string) => request({
      url: `/api/extensions/rule-studio/project/${encodeURIComponent(id)}`,
      method: 'get',
    }),
    createProject: (project: Partial<RuleStudioProject>) => request({
      url: '/api/extensions/rule-studio/projects',
      method: 'post',
      data: project,
    }),
    updateProject: (id: string, project: Partial<RuleStudioProject>) => request({
      url: `/api/extensions/rule-studio/project/${encodeURIComponent(id)}`,
      method: 'patch',
      data: project,
    }),
    archiveProject: (id: string) => request({
      url: `/api/extensions/rule-studio/project/${encodeURIComponent(id)}`,
      method: 'delete',
    }),
    deleteProject: (id: string) => request({
      url: `/api/extensions/rule-studio/project/${encodeURIComponent(id)}/permanent`,
      method: 'delete',
    }),
    restoreProject: (id: string) => request({
      url: `/api/extensions/rule-studio/project/${encodeURIComponent(id)}/restore`,
      method: 'post',
    }),
    preview: (data: { project?: RuleStudioProject; id?: string; representation: RuleStudioRepresentation; forceRefresh?: boolean }) => request({
      url: '/api/extensions/rule-studio/preview',
      method: 'post',
      data,
    }),
    refresh: (id: string, representation: RuleStudioRepresentation = 'normalized-json') => request({
      url: `/api/extensions/rule-studio/project/${encodeURIComponent(id)}/refresh`,
      method: 'post',
      data: { representation },
    }),
    getSourceCatalogs: () => request({
      url: '/api/extensions/rule-studio/source-catalogs',
      method: 'get',
    }),
    createSourceCatalog: (data: RuleStudioCustomCatalogInput) => request({
      url: '/api/extensions/rule-studio/source-catalogs',
      method: 'post',
      data,
    }),
    updateSourceCatalog: (id: string, data: RuleStudioCustomCatalogInput) => request({
      url: `/api/extensions/rule-studio/source-catalogs/${encodeURIComponent(id)}`,
      method: 'patch',
      data,
    }),
    deleteSourceCatalog: (id: string) => request({
      url: `/api/extensions/rule-studio/source-catalogs/${encodeURIComponent(id)}`,
      method: 'delete',
    }),
    updateSourceCatalogSettings: (enabledCatalogIds: string[]) => request({
      url: '/api/extensions/rule-studio/source-catalogs/settings',
      method: 'patch',
      data: { enabledCatalogIds },
    }),
    getSourceCatalogItems: (id: string, refresh = false) => request({
      url: `/api/extensions/rule-studio/source-catalogs/${encodeURIComponent(id)}/items`,
      method: 'get',
      params: refresh ? { refresh: true } : undefined,
    }),
  };
}
