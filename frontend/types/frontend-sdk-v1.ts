/**
 * Compile-time view of the Host-owned frontend SDK.
 *
 * Vite externalizes this module to __SUBSTORE_EXTENSION_FRONTEND_SDK_V1__.
 * These declarations are never included in the extension bundle.
 */
export * from 'vue';
export { defineStore } from 'pinia';
export { useI18n } from 'vue-i18n';
export { useRoute, useRouter } from 'vue-router';
export { Dialog, Toast } from '@nutui/nutui';
export { default as draggable } from 'vuedraggable';

import type { Component } from 'vue';

// Host stores are intentionally opaque to an independently built extension.
// The runtime SDK provides Pinia's real storeToRefs implementation; keeping
// this compile-time facade generic prevents the extension repository from
// importing Host-private store declarations.
export const storeToRefs: (...args: any[]) => any = undefined as any;
export const request: any = undefined;
export const useCodeStore: any = undefined;
export const useGlobalStore: any = undefined;
export const useMethodStore: any = undefined;
export const useSettingsStore: any = undefined;
export const useSubsStore: any = undefined;
export const useSystemStore: any = undefined;
export const useHostAPI: any = undefined;
export const useListViewMode: any = undefined;

export const ActionBlock: Component = undefined as any;
export const CodeMirrorView: Component = undefined as any;
export const EditorGroupingTips: Component = undefined as any;
export const IconPopup: Component = undefined as any;
export const PreviewPanel: Component = undefined as any;
