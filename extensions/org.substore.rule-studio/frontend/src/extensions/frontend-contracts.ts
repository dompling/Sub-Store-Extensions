import type { Component } from 'vue';
import type { RouteMeta } from 'vue-router';
import type { ExtensionManifest, ExtensionRouteContribution } from '@/extensions/contracts';

export interface FrontendExtensionRouteMeta extends RouteMeta {
  title: string;
  needTabBar: boolean;
  needNavBack: boolean;
  backPath?: string;
  supportsListViewMode?: boolean;
  supportsListSearch?: boolean;
  hideSideBarInWideScreenNarrowMode?: boolean;
  extensionId: string;
  extensionSurfaceId: string;
  pageActions?: {
    addCommand?: string;
    addLabelKey?: string;
    settingsCommand?: string;
    settingsLabelKey?: string;
  };
}

export interface FrontendExtensionRouteContribution extends ExtensionRouteContribution {
  path: string;
  extensionId: string;
  extensionSurfaceId: string;
  meta: FrontendExtensionRouteMeta;
}

export type FrontendExtensionSurfaceLoader = () => Promise<{ default?: Component } | Component>;

export interface FrontendExtensionDefinition {
  id: string;
  manifest?: ExtensionManifest;
  version?: string;
  implementationAbi?: string;
  openPath?: string;
  routes: FrontendExtensionRouteContribution[];
  surfaces: Record<string, FrontendExtensionSurfaceLoader>;
  dispose?: () => void | Promise<void>;
}
