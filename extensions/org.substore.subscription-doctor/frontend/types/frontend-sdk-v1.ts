/** Compile-time facade for the Host-owned frontend SDK. */
export * from 'vue';
export { defineStore } from 'pinia';
export { useI18n } from 'vue-i18n';
export { useRoute, useRouter } from 'vue-router';
export { Dialog, Toast } from '@nutui/nutui';

export const storeToRefs: (...args: any[]) => any = undefined as any;
export const request: any = undefined;
export const useGlobalStore: any = undefined;
export const useListViewMode: any = undefined;
export const useSettingsStore: any = undefined;
