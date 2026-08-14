<template>
  <nut-popup
    :visible="visible"
    position="bottom"
    round
    pop-class="rule-studio-catalog-picker-popup"
    :lock-scroll="true"
    :safe-area-inset-bottom="true"
    :z-index="13000"
    @update:visible="handleVisibleChange"
  >
    <section class="catalog-dialog-shell" role="dialog" aria-modal="true" :aria-label="t('ruleStudio.catalog.title')">
      <header class="catalog-header">
        <span class="header-title">
          <small>{{ t('ruleStudio.catalog.enabledSummary', { count: catalogs.length }) }}</small>
          <strong>{{ t('ruleStudio.catalog.title') }}</strong>
          <p>{{ t('ruleStudio.catalog.selectedSummary', { selected: selectedIds.size, remaining }) }}</p>
        </span>
        <span class="header-actions">
          <button type="button" class="header-icon" :aria-label="t('ruleStudio.refresh')" :disabled="loading" @click="refreshCatalogs">
            <font-awesome-icon icon="fa-solid fa-arrows-rotate" :class="{ spinning: loading }" />
          </button>
          <button type="button" class="header-icon" :aria-label="t('ruleStudio.cancel')" @click="close">
            <font-awesome-icon icon="fa-solid fa-xmark" />
          </button>
        </span>
      </header>

      <div class="catalog-content">
        <section class="catalog-source-card">
          <span class="catalog-avatar"><font-awesome-icon icon="fa-solid fa-layer-group" /></span>
          <span class="catalog-source-copy">
            <strong>{{ t('ruleStudio.catalog.enabledSummary', { count: catalogs.length }) }}</strong>
            <small>{{ catalogNames }}</small>
          </span>
          <span v-if="hasStaleCatalog" class="freshness stale">{{ t('ruleStudio.catalog.stale') }}</span>
          <span v-else-if="hasAnyResult" class="freshness fresh">{{ t('ruleStudio.catalog.fresh') }}</span>
        </section>

        <section class="catalog-toolbar">
          <label class="catalog-search">
            <font-awesome-icon icon="fa-solid fa-magnifying-glass" />
            <input v-model.trim="query" type="search" :placeholder="t('ruleStudio.catalog.searchPlaceholder')">
            <button v-if="query" type="button" :aria-label="t('ruleStudio.catalog.clearSearch')" @click="query = ''">
              <font-awesome-icon icon="fa-solid fa-circle-xmark" />
            </button>
          </label>
          <button type="button" class="catalog-picker-field compact" :aria-label="t('ruleStudio.catalog.filter')" @click="openFilterPicker">
            <span>{{ filterGroup || t('ruleStudio.catalog.allCategories') }}</span>
            <font-awesome-icon icon="fa-solid fa-chevron-down" />
          </button>
        </section>

        <p v-if="hasStaleCatalog" class="catalog-warning">
          <font-awesome-icon icon="fa-solid fa-triangle-exclamation" />
          {{ t('ruleStudio.catalog.staleWarning') }}
        </p>

        <section v-if="loading && !hasAnyResult" class="catalog-state">
          <span class="state-spinner" />
          <strong>{{ t('ruleStudio.catalog.loading') }}</strong>
          <p>{{ t('ruleStudio.catalog.loadingDescription') }}</p>
        </section>

        <section v-else-if="error && !hasAnyResult" class="catalog-state error">
          <font-awesome-icon icon="fa-solid fa-cloud-arrow-down" />
          <strong>{{ t('ruleStudio.catalog.loadFailed') }}</strong>
          <p>{{ error }}</p>
          <button type="button" @click="refreshCatalogs">{{ t('ruleStudio.catalog.retry') }}</button>
        </section>

        <template v-else>
          <div class="result-summary">
            <span>{{ t('ruleStudio.catalog.resultCount', { count: filteredItems.length }) }}</span>
            <span v-if="remaining === 0" class="limit-reached">{{ t('ruleStudio.catalog.limitReached') }}</span>
          </div>

          <section v-if="visibleItems.length" class="catalog-list">
            <button
              v-for="item in visibleItems"
              :key="itemKey(item)"
              type="button"
              class="catalog-item"
              :class="{ selected: selectedIds.has(itemKey(item)), added: addedUrls.has(item.url) }"
              :aria-pressed="selectedIds.has(itemKey(item))"
              :disabled="addedUrls.has(item.url)"
              @click="toggle(item)"
            >
              <span class="selection-marker">
                <font-awesome-icon v-if="addedUrls.has(item.url) || selectedIds.has(itemKey(item))" icon="fa-solid fa-check" />
              </span>
              <span class="catalog-item-copy">
                <strong>{{ item.name }}</strong>
                <small>{{ item.catalogName }} · {{ item.category }} · {{ item.path }}</small>
              </span>
              <span class="catalog-item-meta">
                <small v-if="item.size">{{ formatBytes(item.size) }}</small>
                <em v-if="addedUrls.has(item.url)">{{ t('ruleStudio.catalog.added') }}</em>
              </span>
            </button>
          </section>

          <section v-else class="catalog-state compact">
            <font-awesome-icon icon="fa-solid fa-magnifying-glass" />
            <strong>{{ t('ruleStudio.catalog.emptyTitle') }}</strong>
            <p>{{ t('ruleStudio.catalog.emptyDescription') }}</p>
          </section>

          <button v-if="visibleItems.length < filteredItems.length" type="button" class="load-more" @click="visibleLimit += PAGE_SIZE">
            {{ t('ruleStudio.catalog.loadMore', { count: filteredItems.length - visibleItems.length }) }}
          </button>
        </template>
      </div>

      <footer class="catalog-footer">
        <button type="button" class="cancel-button" @click="close">{{ t('ruleStudio.cancel') }}</button>
        <button type="button" class="confirm-button" :disabled="!selectedIds.size" @click="confirm">
          {{ t('ruleStudio.catalog.addSelected', { count: selectedIds.size }) }}
        </button>
      </footer>
    </section>
  </nut-popup>

  <RuleStudioOptionPicker
    v-model="pickerModel"
    v-model:visible="pickerVisible"
    :options="pickerColumns"
    :title="t('ruleStudio.catalog.filter')"
    :cancel-text="t('ruleStudio.cancel')"
    :confirm-text="t('ruleStudio.confirm')"
    allow-empty
    @confirm="confirmPicker"
  />
</template>

<script setup lang="ts">
import {
  computed,
  ref,
  Toast,
  watch,
} from '@/extensions/frontend-sdk-v1';
import { RULE_STUDIO_MAX_ENABLED_SOURCES } from '../constants';
import RuleStudioOptionPicker from './RuleStudioOptionPicker.vue';
import { useRuleStudioI18n } from '../i18n';
import { useRuleStudioStore } from '../store';

const props = defineProps<{
  visible: boolean;
  sources: RuleStudioSource[];
  catalogs: RuleStudioSourceCatalog[];
  catalogResults: Record<string, RuleStudioCatalogItemsResult>;
}>();
const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'add', items: RuleStudioCatalogItem[]): void;
}>();

const PAGE_SIZE = 120;
const { t } = useRuleStudioI18n();
const ruleStore = useRuleStudioStore();
const selectedIds = ref(new Set<string>());
const query = ref('');
const filterGroup = ref('');
const visibleLimit = ref(PAGE_SIZE);
const pickerVisible = ref(false);
const pickerModel = ref('');

const catalogs = computed(() => props.catalogs);
const catalogResults = computed(() => props.catalogResults);
const loading = computed(() => ruleStore.catalogLoading);
const error = computed(() => ruleStore.error);
const hasAnyResult = computed(() => catalogs.value.some(catalog => Boolean(catalogResults.value[catalog.id])));
const hasStaleCatalog = computed(() => catalogs.value.some(catalog => catalogResults.value[catalog.id]?.freshness.state === 'stale'));
const catalogNames = computed(() => catalogs.value.map(catalog => catalog.name).join('、'));
const addedUrls = computed(() => new Set(
  props.sources
    .filter(source => source.kind === 'url' && source.url?.trim())
    .map(source => source.url!.trim()),
));
const isPristinePlaceholder = (source: RuleStudioSource) => source.kind === 'inline'
  && !source.name?.trim()
  && !source.content?.trim()
  && source.format === 'auto';
const enabledSourceCount = computed(() => props.sources.filter(source => source.enabled && !isPristinePlaceholder(source)).length);
const remaining = computed(() => Math.max(
  0,
  RULE_STUDIO_MAX_ENABLED_SOURCES - enabledSourceCount.value - selectedIds.value.size,
));
const catalogItems = computed(() => catalogs.value.flatMap(catalog => (
  catalogResults.value[catalog.id]?.items || []
).map(item => ({ ...item, catalogId: catalog.id, catalogName: catalog.name }))));
const sourceCategories = computed(() => [...new Set(catalogItems.value.map(item => item.category).filter(Boolean))]);
const useSourceCategories = computed(() => sourceCategories.value.length <= 40
  || sourceCategories.value.length <= catalogItems.value.length * .25);
const initialGroup = (name: string) => {
  const initial = name.trim().charAt(0).toLocaleUpperCase();
  if (/\d/.test(initial)) return '0–9';
  if (/[A-Z]/.test(initial)) return initial;
  return '#';
};
const filterGroups = computed(() => {
  const groups = useSourceCategories.value
    ? sourceCategories.value
    : [...new Set(catalogItems.value.map(item => initialGroup(item.name)))];
  return groups.sort((left, right) => left.localeCompare(right));
});
const pickerColumns = computed(() => [
  { value: '', text: t('ruleStudio.catalog.allCategories') },
  ...filterGroups.value.map(item => ({ value: item, text: item })),
]);
const filteredItems = computed(() => {
  const keyword = query.value.toLocaleLowerCase();
  return catalogItems.value.filter((item) => {
    if (filterGroup.value) {
      const group = useSourceCategories.value ? item.category : initialGroup(item.name);
      if (group !== filterGroup.value) return false;
    }
    if (!keyword) return true;
    return `${item.name} ${item.category} ${item.path} ${item.catalogName}`.toLocaleLowerCase().includes(keyword);
  });
});
const visibleItems = computed(() => filteredItems.value.slice(0, visibleLimit.value));
const itemKey = (item: RuleStudioCatalogItem) => `${item.catalogId || ''}:${item.id}`;

const loadCatalogs = async (refresh = false) => {
  for (const catalog of catalogs.value) {
    if (!refresh && catalogResults.value[catalog.id]) continue;
    await ruleStore.fetchSourceCatalogItems(catalog.id, refresh);
  }
};
const refreshCatalogs = () => { void loadCatalogs(true); };
const openFilterPicker = () => {
  pickerModel.value = filterGroup.value;
  pickerVisible.value = true;
};
const confirmPicker = (selectedValue: string) => {
  filterGroup.value = String(selectedValue ?? pickerModel.value ?? '');
};
const open = async () => {
  selectedIds.value = new Set();
  query.value = '';
  filterGroup.value = '';
  visibleLimit.value = PAGE_SIZE;
  await loadCatalogs();
};
const close = () => {
  pickerVisible.value = false;
  emit('close');
};
const handleVisibleChange = (visible: boolean) => {
  if (!visible) close();
};
const toggle = (item: RuleStudioCatalogItem) => {
  if (addedUrls.value.has(item.url)) return;
  const key = itemKey(item);
  const next = new Set(selectedIds.value);
  if (next.has(key)) next.delete(key);
  else {
    if (remaining.value <= 0) {
      Toast.fail(t('ruleStudio.catalog.limitReached'));
      return;
    }
    next.add(key);
  }
  selectedIds.value = next;
};
const confirm = () => {
  const selected = catalogItems.value.filter(item => selectedIds.value.has(itemKey(item)));
  if (!selected.length) return;
  emit('add', selected);
  close();
};
const formatBytes = (bytes: number) => bytes < 1024
  ? `${bytes} B`
  : `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;

watch(() => props.visible, (visible) => {
  if (visible) {
    void open();
  } else {
    pickerVisible.value = false;
  }
}, { immediate: true });
watch([query, filterGroup], () => { visibleLimit.value = PAGE_SIZE; });
</script>

<style scoped>
.catalog-dialog-shell { display: grid; box-sizing: border-box; width: 100%; height: min(82vh, 780px); max-height: calc(100vh - 48px); grid-template-rows: auto minmax(0, 1fr) auto; padding: 18px 14px 0; background: var(--background-color); color: var(--primary-text-color); }
.catalog-header { display: flex; min-width: 0; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 3px 0 14px 2px; border-bottom: 1px solid var(--divider-color); }
.header-title { display: grid; min-width: 0; gap: 4px; }
.header-title small { overflow: hidden; color: var(--primary-color); font-size: 10px; font-weight: 600; letter-spacing: .04em; text-overflow: ellipsis; white-space: nowrap; }
.header-title strong { overflow: hidden; font-size: 19px; text-overflow: ellipsis; white-space: nowrap; }
.header-title p { margin: 0; color: var(--comment-text-color); font-size: 11px; line-height: 1.5; }
.header-actions { display: flex; flex: 0 0 auto; gap: 6px; }
.header-icon { display: grid; width: 42px; height: 42px; place-items: center; border: 0; border-radius: 50%; background: var(--card-color); color: var(--primary-text-color); cursor: pointer; }
.header-icon:disabled { opacity: .55; cursor: default; }
.catalog-content { min-height: 0; padding: 14px 2px 20px; overflow-y: auto; overscroll-behavior: contain; }
.catalog-source-card { display: flex; min-width: 0; align-items: center; gap: 11px; padding: 14px; border: 1px solid var(--divider-color); border-radius: var(--item-card-radios); background: var(--card-color); }
.catalog-avatar { display: grid; width: 42px; height: 42px; flex: 0 0 42px; place-items: center; border-radius: 13px; background: color-mix(in srgb, var(--primary-color) 12%, var(--background-color)); color: var(--primary-color); font-size: 20px; }
.catalog-source-copy { display: grid; min-width: 0; flex: 1; gap: 3px; }
.catalog-source-copy strong, .catalog-source-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.catalog-source-copy strong { font-size: 15px; }
.catalog-source-copy small { color: var(--comment-text-color); font-size: 11px; }
.freshness { flex: 0 0 auto; padding: 4px 8px; border-radius: 999px; font-size: 10px; font-weight: 600; }
.freshness.fresh { background: rgba(31,174,94,.12); color: #1b8a4c; }
.freshness.stale { background: rgba(248,160,38,.14); color: #b76d00; }
.catalog-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) minmax(150px, 220px); gap: 10px; margin-top: 14px; }
.catalog-search { display: flex; min-width: 0; min-height: 44px; align-items: center; gap: 9px; border: 1px solid var(--divider-color); border-radius: 13px; padding: 0 12px; background: var(--card-color); color: var(--comment-text-color); }
.catalog-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--primary-text-color); font: inherit; }
.catalog-search button { display: grid; width: 32px; height: 32px; place-items: center; border: 0; background: transparent; color: var(--comment-text-color); cursor: pointer; }
.catalog-picker-field { display: flex; box-sizing: border-box; width: 100%; min-width: 0; min-height: 44px; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid var(--divider-color); border-radius: 13px; padding: 0 12px; background: var(--card-color); color: var(--primary-text-color); cursor: pointer; font: inherit; text-align: left; }
.catalog-warning { display: flex; align-items: center; gap: 8px; padding: 10px 12px; margin: 12px 0 0; border-radius: 12px; background: rgba(248,160,38,.12); color: #b76d00; font-size: 12px; }
.result-summary { display: flex; min-height: 38px; align-items: center; justify-content: space-between; gap: 12px; padding: 0 3px; color: var(--comment-text-color); font-size: 11px; }
.limit-reached { color: #d97706; }
.catalog-list { display: grid; gap: 8px; }
.catalog-item { display: flex; width: 100%; min-height: 58px; align-items: center; gap: 11px; border: 1px solid var(--divider-color); border-radius: var(--item-card-radios); padding: 11px 12px; background: var(--card-color); color: var(--primary-text-color); text-align: left; cursor: pointer; }
.catalog-item.selected { border-color: color-mix(in srgb, var(--primary-color) 55%, var(--divider-color)); background: color-mix(in srgb, var(--primary-color) 7%, var(--card-color)); }
.catalog-item.added { opacity: .68; cursor: default; }
.selection-marker { display: grid; width: 22px; height: 22px; flex: 0 0 22px; place-items: center; border: 1px solid var(--divider-color); border-radius: 7px; color: #fff; font-size: 11px; }
.catalog-item.selected .selection-marker, .catalog-item.added .selection-marker { border-color: var(--primary-color); background: var(--primary-color); }
.catalog-item-copy { display: grid; min-width: 0; flex: 1; gap: 4px; }
.catalog-item-copy strong, .catalog-item-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.catalog-item-copy strong { font-size: 14px; }
.catalog-item-copy small { color: var(--comment-text-color); font-size: 10px; }
.catalog-item-meta { display: grid; flex: 0 0 auto; justify-items: end; gap: 4px; }
.catalog-item-meta small { color: var(--comment-text-color); font-size: 10px; }
.catalog-item-meta em { color: var(--primary-color); font-size: 10px; font-style: normal; font-weight: 600; }
.catalog-state { display: flex; min-height: 320px; flex-direction: column; align-items: center; justify-content: center; gap: 9px; color: var(--comment-text-color); text-align: center; }
.catalog-state.compact { min-height: 240px; }
.catalog-state > svg { font-size: 30px; }
.catalog-state p { max-width: 360px; margin: 0; font-size: 12px; line-height: 1.55; }
.catalog-state button, .load-more { min-height: 42px; border: 0; border-radius: 12px; padding: 0 16px; background: color-mix(in srgb, var(--primary-color) 12%, transparent); color: var(--primary-color); cursor: pointer; }
.load-more { display: block; margin: 14px auto 0; }
.catalog-footer { display: flex; gap: 8px; padding: 10px 0 max(8px, env(safe-area-inset-bottom)); border-top: 1px solid var(--divider-color); background: var(--background-color); }
.cancel-button, .confirm-button { min-height: 44px; border-radius: 11px; cursor: pointer; }
.cancel-button { flex: 0 0 36%; border: 1px solid var(--divider-color); background: transparent; color: var(--primary-text-color); }
.confirm-button { flex: 1; border: 0; background: var(--primary-color); color: #fff; }
.confirm-button:disabled { opacity: .5; cursor: default; }
.state-spinner { width: 28px; height: 28px; border: 3px solid var(--divider-color); border-top-color: var(--primary-color); border-radius: 50%; animation: spin .8s linear infinite; }
.spinning { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (min-width: 700px) { :global(.rule-studio-catalog-picker-popup) { right: 0 !important; left: 0 !important; width: min(900px, calc(100vw - 48px)) !important; margin-right: auto; margin-left: auto; } }
@media (max-width: 560px) { .catalog-dialog-shell { height: min(90vh, 760px); max-height: calc(100vh - 12px); padding: 16px 10px 0; } .catalog-toolbar { grid-template-columns: 1fr; } .catalog-source-card { padding: 12px; } .catalog-item { padding-right: 10px; padding-left: 10px; } }
</style>
