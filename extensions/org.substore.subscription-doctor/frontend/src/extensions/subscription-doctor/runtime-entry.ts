import type { FrontendExtensionDefinition } from '@/extensions/frontend-contracts';
import {
  SUBSCRIPTION_DOCTOR_EXTENSION_ID,
  SUBSCRIPTION_DOCTOR_PATH,
} from './constants';
import { subscriptionDoctorRoutes } from './routes';
import HomePage from './pages/HomePage.vue';
import ResultPage from './pages/ResultPage.vue';
import { disposeSubscriptionDoctorMessages } from './i18n';

declare const __SUBSTORE_EXTENSION_VERSION__: string;

const definition: FrontendExtensionDefinition = {
  id: SUBSCRIPTION_DOCTOR_EXTENSION_ID,
  version: __SUBSTORE_EXTENSION_VERSION__,
  implementationAbi: 'subscription-doctor-ui@1',
  openPath: SUBSCRIPTION_DOCTOR_PATH,
  routes: subscriptionDoctorRoutes,
  surfaces: {
    home: async () => HomePage,
    result: async () => ResultPage,
  },
  dispose: disposeSubscriptionDoctorMessages,
};

type RegistrationHost = typeof globalThis & {
  __SUBSTORE_REGISTER_FRONTEND_EXTENSION__?: (
    extension: FrontendExtensionDefinition,
  ) => void;
};

const host = globalThis as RegistrationHost;
if (typeof host.__SUBSTORE_REGISTER_FRONTEND_EXTENSION__ !== 'function') {
  throw new Error('Sub-Store frontend extension Host is unavailable');
}
host.__SUBSTORE_REGISTER_FRONTEND_EXTENSION__(definition);

