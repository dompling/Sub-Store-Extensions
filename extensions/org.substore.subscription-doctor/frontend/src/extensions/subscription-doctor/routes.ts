import type { FrontendExtensionRouteContribution } from '@/extensions/frontend-contracts';
import {
  SUBSCRIPTION_DOCTOR_EXTENSION_ID,
  SUBSCRIPTION_DOCTOR_PATH,
} from './constants';

const baseMeta = {
  title: 'subscriptionDoctor',
  needTabBar: false,
  needNavBack: true,
  hideSideBarInWideScreenNarrowMode: true,
};

export const subscriptionDoctorRoutes: FrontendExtensionRouteContribution[] = [
  {
    id: `${SUBSCRIPTION_DOCTOR_EXTENSION_ID}.home`,
    path: SUBSCRIPTION_DOCTOR_PATH,
    extensionId: SUBSCRIPTION_DOCTOR_EXTENSION_ID,
    extensionSurfaceId: 'home',
    meta: {
      ...baseMeta,
      backPath: '/extensions',
      extensionId: SUBSCRIPTION_DOCTOR_EXTENSION_ID,
      extensionSurfaceId: 'home',
    },
  },
  {
    id: `${SUBSCRIPTION_DOCTOR_EXTENSION_ID}.result`,
    path: `${SUBSCRIPTION_DOCTOR_PATH}/report/:id`,
    extensionId: SUBSCRIPTION_DOCTOR_EXTENSION_ID,
    extensionSurfaceId: 'result',
    meta: {
      ...baseMeta,
      backPath: SUBSCRIPTION_DOCTOR_PATH,
      extensionId: SUBSCRIPTION_DOCTOR_EXTENSION_ID,
      extensionSurfaceId: 'result',
    },
  },
];

