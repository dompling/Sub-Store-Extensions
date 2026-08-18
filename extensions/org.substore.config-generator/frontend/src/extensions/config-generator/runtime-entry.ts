import type { FrontendExtensionDefinition } from '@/extensions/frontend-contracts';
import { CONFIG_GENERATOR_EXTENSION_ID } from './constants';
import { configGeneratorRoutes } from './routes';
import ListPage from './pages/ListPage.vue';
import EditorPage from './pages/EditorPage.vue';
import ImportPage from './pages/ImportPage.vue';
import PreviewPage from './pages/PreviewPage.vue';
import HealthPage from './pages/HealthPage.vue';
import { disposeConfigGeneratorMessages } from './i18n';

declare const __SUBSTORE_EXTENSION_VERSION__: string;

const definition: FrontendExtensionDefinition = {
  id: CONFIG_GENERATOR_EXTENSION_ID,
  version: __SUBSTORE_EXTENSION_VERSION__,
  implementationAbi: 'config-generator-ui@1',
  openPath: '/extensions/config-generator',
  routes: configGeneratorRoutes,
  surfaces: {
    list: async () => ListPage,
    editor: async () => EditorPage,
    import: async () => ImportPage,
    preview: async () => PreviewPage,
    health: async () => HealthPage,
  },
  dispose: disposeConfigGeneratorMessages,
};

type ExtensionRegistrationHost = typeof globalThis & {
  __SUBSTORE_REGISTER_FRONTEND_EXTENSION__?: (
    extension: FrontendExtensionDefinition,
  ) => void;
};

const host = globalThis as ExtensionRegistrationHost;
if (typeof host.__SUBSTORE_REGISTER_FRONTEND_EXTENSION__ !== 'function') {
  throw new Error('Sub-Store frontend extension Host is unavailable');
}
host.__SUBSTORE_REGISTER_FRONTEND_EXTENSION__(definition);
