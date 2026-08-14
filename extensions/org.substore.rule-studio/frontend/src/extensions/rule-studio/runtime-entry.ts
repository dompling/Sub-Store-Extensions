import type { FrontendExtensionDefinition } from '@/extensions/frontend-contracts';
import { RULE_STUDIO_EXTENSION_ID } from './constants';
import { disposeRuleStudioMessages } from './i18n';
import ListPage from './pages/ListPage.vue';
import EditorPage from './pages/EditorPage.vue';
import PreviewPage from './pages/PreviewPage.vue';
import CatalogSettingsPage from './pages/CatalogSettingsPage.vue';
import { ruleStudioRoutes } from './routes';

declare const __SUBSTORE_EXTENSION_VERSION__: string;

const definition: FrontendExtensionDefinition = {
  id: RULE_STUDIO_EXTENSION_ID,
  version: __SUBSTORE_EXTENSION_VERSION__,
  implementationAbi: 'rule-studio-ui@1',
  openPath: '/extensions/rule-studio',
  routes: ruleStudioRoutes,
  surfaces: {
    list: async () => ListPage,
    editor: async () => EditorPage,
    preview: async () => PreviewPage,
    catalogs: async () => CatalogSettingsPage,
  },
  dispose: disposeRuleStudioMessages,
};

type RegistrationHost = typeof globalThis & {
  __SUBSTORE_REGISTER_FRONTEND_EXTENSION__?: (extension: FrontendExtensionDefinition) => void;
};
const host = globalThis as RegistrationHost;
if (typeof host.__SUBSTORE_REGISTER_FRONTEND_EXTENSION__ !== 'function') {
  throw new Error('Sub-Store frontend extension Host is unavailable');
}
host.__SUBSTORE_REGISTER_FRONTEND_EXTENSION__(definition);
