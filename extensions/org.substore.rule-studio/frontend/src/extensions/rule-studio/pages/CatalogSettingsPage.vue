<template>
  <main class="catalog-settings-page">
    <header class="catalog-page-heading">
      <span>
        <strong>{{ t('ruleStudio.catalog.availableLibraries', { count: sourceCatalogs.length }) }}</strong>
        <small>{{ t('ruleStudio.catalog.customLibraryHint') }}</small>
      </span>
    </header>

    <section v-if="sourceCatalogs.length" class="catalog-list">
      <article v-for="catalog in sourceCatalogs" :key="catalog.id" class="catalog-card">
        <span class="catalog-avatar" :class="{ custom: catalog.custom }">
          <font-awesome-icon :icon="catalog.custom ? 'fa-solid fa-folder-tree' : 'fa-solid fa-code-branch'" />
        </span>
        <span class="catalog-main">
          <span class="catalog-heading">
            <strong>{{ catalog.name }}</strong>
            <span v-if="catalog.custom" class="custom-state">{{ t('ruleStudio.catalog.custom') }}</span>
            <span class="cache-state" :class="catalog.cache?.state || 'empty'">
              {{ cacheLabel(catalog.cache?.state || 'empty') }}
            </span>
          </span>
          <span class="catalog-meta">
            {{ catalog.repository.owner }} / {{ catalog.repository.name }} · {{ catalog.repository.ref }}
            <template v-if="catalog.rootPath"> · {{ catalog.rootPath }}</template>
          </span>
          <span class="catalog-description">{{ catalog.description }}</span>
          <span class="catalog-author">{{ t('ruleStudio.catalog.author', { name: catalog.author?.name || catalog.repository.owner }) }}</span>
        </span>
        <span class="catalog-actions">
          <span v-if="catalog.custom" class="custom-actions">
            <button
              type="button"
              class="icon-button"
              :title="t('ruleStudio.catalog.edit')"
              :aria-label="t('ruleStudio.catalog.edit')"
              @click="openCatalogEditor(catalog)"
            >
              <font-awesome-icon icon="fa-solid fa-pen" />
            </button>
            <button
              type="button"
              class="icon-button danger"
              :title="t('ruleStudio.catalog.delete')"
              :aria-label="t('ruleStudio.catalog.delete')"
              @click="confirmDeleteCatalog(catalog)"
            >
              <font-awesome-icon icon="fa-solid fa-trash-can" />
            </button>
          </span>
          <button
            type="button"
            class="icon-button refresh-button"
            :title="t('ruleStudio.catalog.refreshLibrary')"
            :aria-label="t('ruleStudio.catalog.refreshLibrary')"
            :disabled="catalogLoading"
            @click="refreshCatalog(catalog.id)"
          >
            <font-awesome-icon icon="fa-solid fa-arrows-rotate" />
          </button>
          <nut-switch
            :model-value="catalog.enabled"
            :aria-label="t('ruleStudio.catalog.toggleLibrary', { name: catalog.name })"
            @change="toggleCatalog(catalog, $event)"
          />
        </span>
      </article>
    </section>

    <section v-else-if="!catalogLoading" class="empty-catalogs">
      <nut-empty image="empty" :description="t('ruleStudio.catalog.noLibraries')" />
      <nut-button type="primary" @click="openCatalogEditor()">{{ t('ruleStudio.catalog.add') }}</nut-button>
    </section>
  </main>

  <nut-popup
    v-model:visible="catalogEditorVisible"
    position="bottom"
    round
    pop-class="rule-studio-catalog-editor-popup"
    :style="catalogEditorPopupStyle"
    :lock-scroll="true"
    :safe-area-inset-bottom="true"
    close-icon="close-little"
    closeable
    @closed="resetDraft"
  >
    <section class="catalog-editor">
      <header class="catalog-editor-header">
        <span class="catalog-editor-title">
          <small>{{ t('ruleStudio.catalog.manage') }}</small>
          <strong>{{ editingCatalogId ? t('ruleStudio.catalog.edit') : t('ruleStudio.catalog.add') }}</strong>
          <p>{{ t('ruleStudio.catalog.customLibraryHint') }}</p>
        </span>
      </header>

      <nut-form class="catalog-editor-form" :model-value="catalogDraft">
        <nut-form-item required :label="t('ruleStudio.catalog.directoryUrl')">
          <nut-textarea
            v-model.trim="catalogDraft.url"
            class="nut-input-text"
            :border="false"
            input-align="right"
            rows="2"
            :autosize="{ maxHeight: 120 }"
            :placeholder="t('ruleStudio.catalog.directoryUrlPlaceholder')"
          />
        </nut-form-item>
        <nut-form-item :label="t('ruleStudio.catalog.libraryName')">
          <nut-input
            v-model.trim="catalogDraft.name"
            class="nut-input-text"
            :border="false"
            input-align="right"
            :placeholder="t('ruleStudio.catalog.libraryNamePlaceholder')"
          />
        </nut-form-item>
        <nut-form-item :label="t('ruleStudio.catalog.libraryDescription')">
          <nut-textarea
            v-model.trim="catalogDraft.description"
            class="nut-input-text"
            :border="false"
            input-align="right"
            rows="1"
            :autosize="{ maxHeight: 100 }"
            :placeholder="t('ruleStudio.catalog.libraryDescriptionPlaceholder')"
          />
        </nut-form-item>
        <nut-form-item :label="t('ruleStudio.catalog.libraryFormat')">
          <button type="button" class="picker-field" :aria-label="t('ruleStudio.catalog.libraryFormat')" @click="formatPickerVisible = true">
            <span>{{ formatLabel(catalogDraft.format) }}</span>
            <font-awesome-icon icon="fa-solid fa-chevron-right" />
          </button>
        </nut-form-item>
      </nut-form>

      <footer class="catalog-editor-footer">
        <button type="button" class="cancel-button" @click="catalogEditorVisible = false">{{ t('ruleStudio.cancel') }}</button>
        <nut-button type="primary" class="confirm-button" :loading="catalogLoading" @click="submitCatalog">
          {{ t(editingCatalogId ? 'ruleStudio.catalog.saveLibrary' : 'ruleStudio.catalog.addAndEnable') }}
        </nut-button>
      </footer>
    </section>
  </nut-popup>

  <RuleStudioOptionPicker
    v-model="formatPickerModel"
    v-model:visible="formatPickerVisible"
    :options="formatOptions"
    :title="t('ruleStudio.catalog.libraryFormat')"
    :cancel-text="t('ruleStudio.cancel')"
    :confirm-text="t('ruleStudio.confirm')"
    @confirm="confirmFormat"
  />
</template>

<script setup lang="ts">
import {
  computed,
  Dialog,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  storeToRefs,
  Toast,
  useMethodStore,
} from '@/extensions/frontend-sdk-v1';
import { RULE_STUDIO_COMMANDS, RULE_STUDIO_FORMATS } from '../constants';
import RuleStudioOptionPicker from '../components/RuleStudioOptionPicker.vue';
import { useRuleStudioI18n } from '../i18n';
import { useRuleStudioStore } from '../store';

const { t } = useRuleStudioI18n();
const methodStore = useMethodStore();
const ruleStore = useRuleStudioStore();
const { sourceCatalogs, catalogLoading } = storeToRefs(ruleStore);
const catalogEditorVisible = ref(false);
const editingCatalogId = ref('');
const formatPickerVisible = ref(false);
const defaultCatalogFormat: RuleStudioFormat = 'surge';
const formatPickerModel = ref<RuleStudioFormat>(defaultCatalogFormat);
const catalogDraft = reactive<RuleStudioCustomCatalogInput>({
  url: '',
  name: '',
  description: '',
  format: defaultCatalogFormat,
});
const catalogEditorPopupStyle = {
  maxHeight: 'min(82vh, 640px)',
  padding: '18px 14px 0',
  backgroundColor: 'var(--background-color)',
};

const formatOptions = computed(() => RULE_STUDIO_FORMATS
  .filter(option => option.value !== 'auto')
  .map(option => ({
    value: option.value,
    text: t(`ruleStudio.formats.${option.key}`),
  })));
const formatLabel = (format: RuleStudioFormat) => formatOptions.value.find(option => option.value === format)?.text || format;

const catalogUrl = (catalog: RuleStudioSourceCatalog) => catalog.directoryUrl || [
  `${catalog.repository.url || `https://github.com/${catalog.repository.owner}/${catalog.repository.name}`}/tree/${catalog.repository.ref}`,
  catalog.rootPath,
].filter(Boolean).join('/');

const resetDraft = () => {
  editingCatalogId.value = '';
  Object.assign(catalogDraft, {
    url: '',
    name: '',
    description: '',
    format: defaultCatalogFormat,
  });
  formatPickerModel.value = defaultCatalogFormat;
};

const openCatalogEditor = (catalog?: RuleStudioSourceCatalog) => {
  resetDraft();
  if (catalog) {
    const explicitFormat = catalog.format === 'auto' ? defaultCatalogFormat : catalog.format;
    editingCatalogId.value = catalog.id;
    Object.assign(catalogDraft, {
      url: catalogUrl(catalog),
      name: catalog.name,
      description: catalog.description || '',
      format: explicitFormat,
    });
    formatPickerModel.value = explicitFormat;
  }
  catalogEditorVisible.value = true;
};

const enabledIds = (override?: { id: string; enabled: boolean }) => sourceCatalogs.value
  .filter((catalog: RuleStudioSourceCatalog) => override?.id === catalog.id ? override.enabled : catalog.enabled)
  .map((catalog: RuleStudioSourceCatalog) => catalog.id);

const toggleCatalog = async (catalog: RuleStudioSourceCatalog, enabled: boolean) => {
  const ok = await ruleStore.saveCatalogSettings(enabledIds({ id: catalog.id, enabled }));
  if (ok) Toast.success(t(enabled ? 'ruleStudio.catalog.enabledToast' : 'ruleStudio.catalog.disabledToast'));
  else Toast.fail(ruleStore.error);
};

const refreshCatalog = async (id: string) => {
  const result = await ruleStore.fetchSourceCatalogItems(id, true);
  if (!result) {
    Toast.fail(ruleStore.error);
    return;
  }
  await ruleStore.fetchSourceCatalogs();
  Toast.success(t('ruleStudio.catalog.refreshedToast'));
};

const submitCatalog = async () => {
  if (!catalogDraft.url.trim()) {
    Toast.fail(t('ruleStudio.catalog.directoryUrlRequired'));
    return;
  }
  const payload = JSON.parse(JSON.stringify(catalogDraft)) as RuleStudioCustomCatalogInput;
  const catalog = editingCatalogId.value
    ? await ruleStore.updateCustomCatalog(editingCatalogId.value, payload)
    : await ruleStore.createCustomCatalog(payload);
  if (!catalog) {
    Toast.fail(ruleStore.error);
    return;
  }
  if (!editingCatalogId.value) {
    const enabled = await ruleStore.saveCatalogSettings([...new Set([...enabledIds(), catalog.id])]);
    if (!enabled) {
      Toast.fail(ruleStore.error);
      return;
    }
  }
  catalogEditorVisible.value = false;
  Toast.success(t(editingCatalogId.value ? 'ruleStudio.catalog.updatedToast' : 'ruleStudio.catalog.createdToast'));
};

const confirmDeleteCatalog = (catalog: RuleStudioSourceCatalog) => {
  Dialog({
    title: t('ruleStudio.catalog.deleteTitle'),
    content: t('ruleStudio.catalog.deleteDescription'),
    okText: t('ruleStudio.catalog.delete'),
    cancelText: t('ruleStudio.cancel'),
    popClass: 'auto-dialog',
    onOk: async () => {
      if (await ruleStore.deleteCustomCatalog(catalog.id)) Toast.success(t('ruleStudio.catalog.deletedToast'));
      else Toast.fail(ruleStore.error);
    },
  });
};

const confirmFormat = (selectedValue: string) => {
  const value = String(selectedValue || formatPickerModel.value || defaultCatalogFormat);
  catalogDraft.format = value as RuleStudioFormat;
};
const cacheLabel = (state: string) => t(`ruleStudio.catalog.cache.${state}`);

onMounted(() => {
  methodStore.registerMethod(RULE_STUDIO_COMMANDS.addCatalog, () => openCatalogEditor());
  void ruleStore.fetchSourceCatalogs();
});
onUnmounted(() => methodStore.removeMethod(RULE_STUDIO_COMMANDS.addCatalog));
</script>

<style scoped>
.catalog-settings-page { width: calc(100% - 1.5rem); max-width: 900px; margin: 0 auto; padding: 4px 0 calc(36px + env(safe-area-inset-bottom)); color: var(--primary-text-color); }
.catalog-page-heading { display: flex; min-height: 46px; align-items: center; gap: 12px; padding: 0 2px 10px; }
.catalog-page-heading > span { display: grid; min-width: 0; gap: 2px; }
.catalog-page-heading strong { font-size: 13px; font-weight: 500; }
.catalog-page-heading small { color: var(--comment-text-color); font-size: 10px; }
.catalog-list { display: grid; gap: 10px; }
.catalog-card { display: flex; min-width: 0; align-items: center; gap: 12px; padding: 12px 13px; border: 1px solid var(--divider-color); border-radius: var(--item-card-radios); background: var(--card-color); }
.catalog-avatar { display: grid; width: 40px; height: 40px; flex: 0 0 40px; place-items: center; border-radius: 12px; background: color-mix(in srgb, var(--primary-color) 11%, var(--background-color)); color: var(--primary-color); font-size: 17px; }
.catalog-avatar.custom { color: #8a5cf5; background: color-mix(in srgb, #8a5cf5 12%, var(--background-color)); }
.catalog-main { display: grid; min-width: 0; flex: 1; gap: 4px; }
.catalog-heading { display: flex; min-width: 0; align-items: center; gap: 7px; }
.catalog-heading strong { min-width: 0; overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.cache-state, .custom-state { flex: 0 0 auto; padding: 2px 6px; border-radius: 999px; background: var(--divider-color); color: var(--comment-text-color); font-size: 9px; }
.custom-state { background: color-mix(in srgb, #8a5cf5 12%, transparent); color: #7650d6; }
.cache-state.fresh { background: color-mix(in srgb, var(--succeed-color, #2fb344) 13%, transparent); color: var(--succeed-color, #2fb344); }
.cache-state.stale, .cache-state.expired { background: color-mix(in srgb, #f59f00 14%, transparent); color: #b76d00; }
.catalog-meta, .catalog-description, .catalog-author { overflow: hidden; color: var(--comment-text-color); font-size: 10px; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.catalog-actions, .custom-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; }
.custom-actions { padding-right: 5px; border-right: 1px solid var(--divider-color); }
.icon-button { display: grid; width: 36px; height: 36px; place-items: center; border: 0; border-radius: 10px; background: transparent; color: var(--comment-text-color); cursor: pointer; }
.icon-button:hover { background: var(--divider-color); color: var(--primary-color); }
.icon-button.danger:hover { color: var(--danger-color, #e5484d); }
.icon-button:disabled { opacity: .45; cursor: default; }
.empty-catalogs { display: flex; flex-direction: column; align-items: center; }
.catalog-editor { display: flex; box-sizing: border-box; max-height: min(82vh, 640px); flex-direction: column; overflow: hidden; background: var(--background-color); color: var(--primary-text-color); }
.catalog-editor-header { display: flex; min-height: 76px; align-items: flex-start; gap: 12px; padding: 3px 42px 14px 2px; }
.catalog-editor-title { display: grid; min-width: 0; gap: 4px; }
.catalog-editor-title small { color: var(--primary-color); font-size: 10px; font-weight: 600; letter-spacing: .08em; }
.catalog-editor-title strong { font-size: 19px; }
.catalog-editor-title p { margin: 2px 0 0; color: var(--comment-text-color); font-size: 11px; line-height: 1.5; }
.catalog-editor-form { min-height: 0; overflow-y: auto; border: 1px solid var(--divider-color); border-radius: var(--item-card-radios); }
.catalog-editor-form :deep(.nut-form-item__label) { width: auto; min-width: 116px; flex: 0 0 116px; white-space: nowrap; }
.catalog-editor-form :deep(.nut-form-item__body) { min-width: 0; justify-content: flex-end; }
.catalog-editor-form :deep(.nut-form-item__body__slots), .catalog-editor-form :deep(.nut-input), .catalog-editor-form :deep(.nut-textarea) { min-width: 0; }
.picker-field { display: flex; width: 100%; min-height: 42px; align-items: center; justify-content: flex-end; gap: 10px; border: 0; padding: 0; background: transparent; color: var(--primary-text-color); cursor: pointer; font: inherit; }
.picker-field svg { color: var(--comment-text-color); font-size: 10px; }
.catalog-editor-footer { display: flex; gap: 8px; padding: 10px 0 max(8px, env(safe-area-inset-bottom)); margin-top: auto; border-top: 1px solid var(--divider-color); }
.cancel-button, .confirm-button { min-height: 42px; border-radius: 10px; }
.cancel-button { min-width: 96px; border: 1px solid var(--divider-color); background: transparent; color: var(--primary-text-color); cursor: pointer; }
.confirm-button { flex: 1; }
@media (min-width: 700px) { :global(.rule-studio-catalog-editor-popup) { right: 0 !important; left: 0 !important; width: min(620px, calc(100vw - 48px)) !important; margin-right: auto; margin-left: auto; } }
@media (max-width: 560px) { .catalog-settings-page { width: calc(100% - 20px); } .catalog-page-heading small { display: none; } .catalog-card { align-items: flex-start; padding: 11px; } .catalog-actions { flex-direction: column-reverse; gap: 2px; } .custom-actions { padding: 0 0 4px; border-right: 0; border-bottom: 1px solid var(--divider-color); } .catalog-description { white-space: normal; } .catalog-editor-form :deep(.nut-form-item__label) { min-width: 104px; flex-basis: 104px; } }
</style>
