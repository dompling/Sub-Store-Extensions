import type { FrontendExtensionRouteContribution } from '@/extensions/frontend-contracts';
import {
  CONFIG_GENERATOR_COMMANDS,
  CONFIG_GENERATOR_EXTENSION_ID,
} from './constants';

const baseMeta = {
  title: 'configGenerator',
  needTabBar: false,
  needNavBack: true,
  hideSideBarInWideScreenNarrowMode: true,
};

export const configGeneratorRoutes: FrontendExtensionRouteContribution[] = [
  {
    id: `${CONFIG_GENERATOR_EXTENSION_ID}.list`,
    path: '/extensions/config-generator',
    extensionId: CONFIG_GENERATOR_EXTENSION_ID,
    extensionSurfaceId: 'list',
    meta: {
      ...baseMeta,
      backPath: '/extensions',
      supportsListViewMode: true,
      pageActions: {
        addCommand: CONFIG_GENERATOR_COMMANDS.add,
        addLabelKey: 'configGenerator.create',
        importCommand: CONFIG_GENERATOR_COMMANDS.import,
        importLabelKey: 'configGenerator.import',
      },
      extensionId: CONFIG_GENERATOR_EXTENSION_ID,
      extensionSurfaceId: 'list',
    },
  },
  {
    id: `${CONFIG_GENERATOR_EXTENSION_ID}.editor`,
    path: '/extensions/config-generator/edit/:name',
    extensionId: CONFIG_GENERATOR_EXTENSION_ID,
    extensionSurfaceId: 'editor',
    meta: {
      ...baseMeta,
      backPath: '/extensions/config-generator',
      extensionId: CONFIG_GENERATOR_EXTENSION_ID,
      extensionSurfaceId: 'editor',
    },
  },
  {
    id: `${CONFIG_GENERATOR_EXTENSION_ID}.import`,
    path: '/extensions/config-generator/import',
    extensionId: CONFIG_GENERATOR_EXTENSION_ID,
    extensionSurfaceId: 'import',
    meta: {
      ...baseMeta,
      backPath: '/extensions/config-generator',
      extensionId: CONFIG_GENERATOR_EXTENSION_ID,
      extensionSurfaceId: 'import',
    },
  },
  {
    id: `${CONFIG_GENERATOR_EXTENSION_ID}.preview`,
    path: '/extensions/config-generator/preview/:name',
    extensionId: CONFIG_GENERATOR_EXTENSION_ID,
    extensionSurfaceId: 'preview',
    meta: {
      title: 'preview',
      needTabBar: false,
      needNavBack: true,
      backPath: '/extensions/config-generator',
      hideSideBarInWideScreenNarrowMode: true,
      extensionId: CONFIG_GENERATOR_EXTENSION_ID,
      extensionSurfaceId: 'preview',
    },
  },
  {
    id: `${CONFIG_GENERATOR_EXTENSION_ID}.health`,
    path: '/extensions/config-generator/health/:name',
    extensionId: CONFIG_GENERATOR_EXTENSION_ID,
    extensionSurfaceId: 'health',
    meta: {
      ...baseMeta,
      title: 'configGeneratorHealth',
      backPath: '/extensions/config-generator',
      extensionId: CONFIG_GENERATOR_EXTENSION_ID,
      extensionSurfaceId: 'health',
    },
  },
];
