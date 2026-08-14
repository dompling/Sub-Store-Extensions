import type { FrontendExtensionRouteContribution } from '@/extensions/frontend-contracts';
import { RULE_STUDIO_COMMANDS, RULE_STUDIO_EXTENSION_ID } from './constants';

const baseMeta = {
  title: 'ruleStudio',
  needTabBar: false,
  needNavBack: true,
  hideSideBarInWideScreenNarrowMode: true,
};

export const ruleStudioRoutes: FrontendExtensionRouteContribution[] = [
  {
    id: `${RULE_STUDIO_EXTENSION_ID}.list`,
    path: '/extensions/rule-studio',
    extensionId: RULE_STUDIO_EXTENSION_ID,
    extensionSurfaceId: 'list',
    meta: {
      ...baseMeta,
      backPath: '/extensions',
      supportsListViewMode: true,
      pageActions: {
        addCommand: RULE_STUDIO_COMMANDS.add,
        addLabelKey: 'ruleStudio.create',
        settingsCommand: RULE_STUDIO_COMMANDS.catalogs,
        settingsLabelKey: 'ruleStudio.catalog.manage',
      },
      extensionId: RULE_STUDIO_EXTENSION_ID,
      extensionSurfaceId: 'list',
    },
  },
  {
    id: `${RULE_STUDIO_EXTENSION_ID}.catalogs`,
    path: '/extensions/rule-studio/catalogs',
    extensionId: RULE_STUDIO_EXTENSION_ID,
    extensionSurfaceId: 'catalogs',
    meta: {
      ...baseMeta,
      title: 'ruleStudioCatalogs',
      backPath: '/extensions/rule-studio',
      pageActions: {
        addCommand: RULE_STUDIO_COMMANDS.addCatalog,
        addLabelKey: 'ruleStudio.catalog.add',
      },
      extensionId: RULE_STUDIO_EXTENSION_ID,
      extensionSurfaceId: 'catalogs',
    },
  },
  {
    id: `${RULE_STUDIO_EXTENSION_ID}.editor`,
    path: '/extensions/rule-studio/edit/:id',
    extensionId: RULE_STUDIO_EXTENSION_ID,
    extensionSurfaceId: 'editor',
    meta: {
      ...baseMeta,
      backPath: '/extensions/rule-studio',
      extensionId: RULE_STUDIO_EXTENSION_ID,
      extensionSurfaceId: 'editor',
    },
  },
  {
    id: `${RULE_STUDIO_EXTENSION_ID}.preview`,
    path: '/extensions/rule-studio/preview/:id',
    extensionId: RULE_STUDIO_EXTENSION_ID,
    extensionSurfaceId: 'preview',
    meta: {
      ...baseMeta,
      title: 'preview',
      backPath: '/extensions/rule-studio',
      extensionId: RULE_STUDIO_EXTENSION_ID,
      extensionSurfaceId: 'preview',
    },
  },
];
