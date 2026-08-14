import type { Component } from 'vue';
import type { RouteMeta } from 'vue-router';

export interface FrontendExtensionRouteMeta extends RouteMeta {
  title: string;
  needTabBar: boolean;
  needNavBack: boolean;
  backPath?: string;
  hideSideBarInWideScreenNarrowMode?: boolean;
  extensionId: string;
  extensionSurfaceId: string;
}

export interface FrontendExtensionRouteContribution {
  id: string;
  path: string;
  extensionId: string;
  extensionSurfaceId: string;
  meta: FrontendExtensionRouteMeta;
}

export type FrontendExtensionSurfaceLoader = () => Promise<{
  default?: Component;
} | Component>;

export interface FrontendExtensionDefinition {
  id: string;
  version?: string;
  implementationAbi?: string;
  openPath?: string;
  routes: FrontendExtensionRouteContribution[];
  surfaces: Record<string, FrontendExtensionSurfaceLoader>;
  dispose?: () => void | Promise<void>;
}
