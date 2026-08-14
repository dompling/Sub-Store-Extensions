<template>
  <main class="editor-page" :style="{ paddingBottom: `${bottomSafeArea + 96}px` }">
    <div class="editor-sections">
      <div class="form-block-wrapper">
        <nut-form class="form" :model-value="form">
          <nut-form-item required :label="t('ruleStudio.fields.name')">
            <nut-input
              v-model.trim="form.name"
              class="nut-input-text"
              :border="false"
              input-align="right"
              :placeholder="t('ruleStudio.placeholders.name')"
            />
          </nut-form-item>
          <nut-form-item :label="t('ruleStudio.fields.description')">
            <nut-textarea
              v-model="form.description"
              class="nut-input-text"
              :border="false"
              input-align="right"
              rows="1"
              :autosize="{ maxHeight: 140 }"
              :placeholder="t('ruleStudio.placeholders.description')"
            />
          </nut-form-item>
          <nut-form-item :label="t('ruleStudio.fields.iconUrl')" class="icon-url-form-item">
            <div class="icon-url-field">
              <nut-input
                v-model.trim="form.iconUrl"
                class="nut-input-text"
                :border="false"
                input-align="right"
                :placeholder="t('ruleStudio.placeholders.iconUrl')"
              />
              <button
                type="button"
                class="icon-repository-button"
                :aria-label="t('ruleStudio.chooseFromIconRepository')"
                @click="iconPopupVisible = true"
              >
                <img v-if="form.iconUrl" :src="form.iconUrl" alt="">
                <font-awesome-icon v-else icon="fa-solid fa-icons" />
              </button>
            </div>
          </nut-form-item>
          <nut-form-item :label="t('ruleStudio.fields.deduplicate')" class="switch-form-item">
            <nut-switch v-model="form.options.deduplicate" />
          </nut-form-item>
          <nut-form-item :label="t('ruleStudio.fields.preserveComments')" class="switch-form-item">
            <nut-switch v-model="form.options.preserveComments" />
          </nut-form-item>
        </nut-form>
      </div>

      <div class="source-theme-panel">
        <div v-if="!form.sources.length" class="source-empty-card">
          <span class="source-empty-icon"><font-awesome-icon icon="fa-solid fa-link" /></span>
          <span>
            <strong>{{ t('ruleStudio.noSources') }}</strong>
            <p>{{ t('ruleStudio.noSourcesDescription') }}</p>
          </span>
        </div>

        <draggable v-model="form.sources" tag="ul" item-key="id" handle=".drag-handle" class="source-card-list" animation="200">
          <template #item="{ element: source, index }">
            <li class="source-summary-card" :class="{ 'is-disabled': source.enabled === false }" @click="openSourceEditor(index)">
              <span class="source-summary-icon" :class="source.kind">
                <font-awesome-icon :icon="source.kind === 'url' ? 'fa-solid fa-link' : 'fa-solid fa-file-lines'" />
              </span>
              <span class="source-summary-content">
                <span class="source-summary-heading">
                  <strong>{{ source.name || t('ruleStudio.unnamedSource', { index: index + 1 }) }}</strong>
                  <span class="source-kind-badge">{{ sourceKindLabel(source.kind) }}</span>
                  <span class="source-status-badge" :class="{ disabled: source.enabled === false }">
                    {{ t(source.enabled === false ? 'ruleStudio.sourceDisabled' : 'ruleStudio.sourceEnabled') }}
                  </span>
                </span>
                <span class="source-summary-value">{{ sourceSummary(source) }}</span>
              </span>
              <span class="source-summary-actions">
                <button type="button" class="source-action edit" :title="t('ruleStudio.edit')" :aria-label="t('ruleStudio.edit')" @click.stop="openSourceEditor(index)">
                  <font-awesome-icon icon="fa-solid fa-pen" />
                </button>
                <button type="button" class="source-action delete" :title="t('ruleStudio.removeSource')" :aria-label="t('ruleStudio.removeSource')" @click.stop="removeSource(index)">
                  <font-awesome-icon icon="fa-solid fa-trash-can" />
                </button>
                <span class="source-action drag-handle" :title="t('ruleStudio.drag')" @click.stop>
                  <font-awesome-icon icon="fa-solid fa-grip" />
                </span>
              </span>
            </li>
          </template>
        </draggable>

        <div class="source-actions">
          <button type="button" class="add-source-button" @click="addSource">
            <span class="action-icon"><font-awesome-icon icon="fa-solid fa-plus" /></span>
            <span><strong>{{ t('ruleStudio.addSource') }}</strong><small>{{ t('ruleStudio.addSourceDescription') }}</small></span>
            <font-awesome-icon icon="fa-solid fa-chevron-right" />
          </button>
          <button v-if="!catalogEmpty" type="button" class="add-source-button" @click="catalogVisible = true">
            <span class="action-icon"><font-awesome-icon icon="fa-solid fa-layer-group" /></span>
            <span><strong>{{ t('ruleStudio.catalog.open') }}</strong><small>{{ t('ruleStudio.catalog.openDescription') }}</small></span>
            <font-awesome-icon icon="fa-solid fa-chevron-right" />
          </button>
          <button v-else type="button" class="catalog-empty-action" @click="goCatalogSettings">
            <span class="action-icon"><font-awesome-icon icon="fa-solid fa-layer-group" /></span>
            <span><strong>{{ t('ruleStudio.catalog.configureFirst') }}</strong><small>{{ t('ruleStudio.catalog.configureFirstDescription') }}</small></span>
            <font-awesome-icon icon="fa-solid fa-chevron-right" />
          </button>
        </div>
      </div>
    </div>
  </main>

  <footer class="bottom-actions" :style="{ paddingBottom: `${bottomSafeArea + 8}px` }">
    <div class="bottom-actions-inner">
      <nut-button class="preview-action" plain shape="square" :loading="previewing" @click="preview">
        <font-awesome-icon v-if="!previewing" icon="fa-solid fa-eye" />
        {{ t('ruleStudio.preview') }}
      </nut-button>
      <nut-button class="save-action" type="primary" shape="square" :loading="saving" @click="save">
        <font-awesome-icon v-if="!saving" icon="fa-solid fa-floppy-disk" />
        {{ t('ruleStudio.save') }}
      </nut-button>
    </div>
  </footer>

  <nut-popup
    v-model:visible="sourceEditorVisible"
    position="bottom"
    round
    pop-class="rule-studio-source-editor-popup"
    :style="sourceEditorPopupStyle"
    :lock-scroll="true"
    :safe-area-inset-bottom="true"
    close-icon="close-little"
    closeable
    @closed="resetSourceEditor"
  >
    <section class="source-editor">
      <header class="source-editor-header">
        <span class="source-editor-title">
          <small>{{ t('ruleStudio.sources') }}</small>
          <strong>{{ sourceEditorIndex < 0 ? t('ruleStudio.addSource') : t('ruleStudio.editSource') }}</strong>
          <p>{{ t('ruleStudio.addSourceDescription') }}</p>
        </span>
      </header>

      <div class="source-kind-grid">
        <button type="button" class="source-kind-option" :class="{ selected: sourceDraft.kind === 'url' }" @click="setSourceKind('url')">
          <span class="source-kind-option-icon"><font-awesome-icon icon="fa-solid fa-link" /></span>
          <span>{{ t('ruleStudio.sourceKinds.url') }}</span>
          <font-awesome-icon :icon="sourceDraft.kind === 'url' ? 'fa-solid fa-circle-check' : 'fa-solid fa-chevron-right'" />
        </button>
        <button type="button" class="source-kind-option" :class="{ selected: sourceDraft.kind === 'inline' }" @click="setSourceKind('inline')">
          <span class="source-kind-option-icon inline"><font-awesome-icon icon="fa-solid fa-file-lines" /></span>
          <span>{{ t('ruleStudio.sourceKinds.inline') }}</span>
          <font-awesome-icon :icon="sourceDraft.kind === 'inline' ? 'fa-solid fa-circle-check' : 'fa-solid fa-chevron-right'" />
        </button>
      </div>

      <nut-form class="source-editor-form" :model-value="sourceDraft">
        <nut-form-item :label="t('ruleStudio.fields.sourceName')">
          <nut-input
            v-model.trim="sourceDraft.name"
            class="nut-input-text"
            :border="false"
            input-align="right"
            :placeholder="t('ruleStudio.placeholders.sourceName')"
          />
        </nut-form-item>
        <nut-form-item :label="t('ruleStudio.enabled')" class="switch-form-item">
          <nut-switch v-model="sourceDraft.enabled" />
        </nut-form-item>
        <nut-form-item :label="t('ruleStudio.fields.format')">
          <button type="button" class="picker-field" :aria-label="t('ruleStudio.fields.format')" @click="openSourceFormatPicker">
            <span>{{ sourceFormatLabel(sourceDraft.format) }}</span><font-awesome-icon icon="fa-solid fa-chevron-right" />
          </button>
        </nut-form-item>
        <nut-form-item v-if="sourceDraft.kind === 'url'" :label="t('ruleStudio.fields.url')">
          <nut-textarea
            v-model="sourceDraft.url"
            class="nut-input-text"
            :border="false"
            input-align="right"
            rows="2"
            :autosize="{ maxHeight: 120 }"
            :placeholder="t('ruleStudio.placeholders.url')"
          />
        </nut-form-item>
        <nut-form-item v-else :label="t('ruleStudio.fields.content')" class="content-form-item">
          <nut-textarea
            v-model="sourceDraft.content"
            class="nut-input-text"
            :border="false"
            rows="8"
            :autosize="{ minHeight: 180, maxHeight: 300 }"
            :placeholder="t('ruleStudio.placeholders.content')"
          />
        </nut-form-item>
        <div v-if="sourceDraft.kind === 'inline'" class="file-import-row">
          <input id="rule-studio-source-file" type="file" hidden @change="importFile">
          <label for="rule-studio-source-file"><font-awesome-icon icon="fa-solid fa-file-arrow-up" /> {{ t('ruleStudio.fileImport') }}</label>
        </div>
      </nut-form>
      <footer class="source-editor-footer">
        <button type="button" class="source-editor-cancel" @click="sourceEditorVisible = false">{{ t('ruleStudio.cancel') }}</button>
        <nut-button type="primary" class="source-editor-confirm" @click="confirmSourceEditor">{{ t('ruleStudio.confirm') }}</nut-button>
      </footer>
    </section>
  </nut-popup>

  <SourceCatalogPicker
    :visible="catalogVisible"
    :sources="form.sources"
    :catalogs="enabledSourceCatalogs"
    :catalog-results="sourceCatalogResults"
    @close="catalogVisible = false"
    @add="addCatalogSources"
  />

  <RuleStudioOptionPicker
    v-model="sourcePickerModel"
    v-model:visible="sourcePickerVisible"
    :options="sourcePickerColumns"
    :title="t('ruleStudio.fields.format')"
    :cancel-text="t('ruleStudio.cancel')"
    :confirm-text="t('ruleStudio.confirm')"
    @confirm="confirmSourcePicker"
  />

  <IconPopup
    v-if="iconPopupVisible"
    v-model:visible="iconPopupVisible"
    @setIcon="setIconFromRepository"
  />
</template>

<script setup lang="ts">
import {
  computed,
  draggable,
  IconPopup,
  onMounted,
  reactive,
  ref,
  storeToRefs,
  Toast,
  useGlobalStore,
  useRoute,
  useRouter,
} from '@/extensions/frontend-sdk-v1';
import { RULE_STUDIO_FORMATS } from '../constants';
import RuleStudioOptionPicker from '../components/RuleStudioOptionPicker.vue';
import SourceCatalogPicker from '../components/SourceCatalogPicker.vue';
import { useRuleStudioI18n } from '../i18n';
import { useRuleStudioStore } from '../store';

const { t } = useRuleStudioI18n();
const route = useRoute();
const router = useRouter();
const globalStore = useGlobalStore();
const ruleStore = useRuleStudioStore();
const { bottomSafeArea } = storeToRefs(globalStore);
const { sourceCatalogs, sourceCatalogResults } = storeToRefs(ruleStore);
const routeId = String(route.params.id || 'NEW');
const editing = routeId !== 'NEW';
const persisted = ref(editing);
const saving = ref(false);
const previewing = ref(false);
const catalogVisible = ref(false);
const iconPopupVisible = ref(false);
const sourceEditorVisible = ref(false);
const sourceEditorIndex = ref(-1);
const sourcePickerVisible = ref(false);
const sourcePickerModel = ref('auto');
const makeId = () => globalThis.crypto?.randomUUID?.() || `source-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const defaultSource = (): RuleStudioSource => ({ id: makeId(), kind: 'inline', name: '', content: '', enabled: true, format: 'auto' });
const sourceDraft = reactive<RuleStudioSource>(defaultSource());
const sourceEditorPopupStyle = computed(() => ({
  height: sourceDraft.kind === 'inline' ? 'min(78vh, 660px)' : 'auto',
  maxHeight: 'min(86vh, 720px)',
  padding: '18px 14px 0',
  backgroundColor: 'var(--background-color)',
}));
const form = reactive<RuleStudioProject>({
  id: '', name: '', description: '', iconUrl: '', lifecycle: { state: 'active' },
  sources: [], options: { deduplicate: true, preserveComments: true },
  revision: 0, createdAt: 0, updatedAt: 0,
});

const enabledSourceCatalogs = computed(() => sourceCatalogs.value.filter((catalog: RuleStudioSourceCatalog) => catalog.enabled));
const catalogEmpty = computed(() => enabledSourceCatalogs.value.length === 0);
const assignProject = (project: RuleStudioProject) => Object.assign(form, JSON.parse(JSON.stringify(project)));
const setIconFromRepository = (icon: { url?: string | null }) => {
  form.iconUrl = icon?.url || '';
  iconPopupVisible.value = false;
};
const assignSourceDraft = (source: RuleStudioSource) => {
  for (const key of Object.keys(sourceDraft)) delete (sourceDraft as Record<string, unknown>)[key];
  Object.assign(sourceDraft, JSON.parse(JSON.stringify(source)));
};
const addSource = () => {
  sourceEditorIndex.value = -1;
  assignSourceDraft(defaultSource());
  sourceEditorVisible.value = true;
};
const openSourceEditor = (index: number) => {
  sourceEditorIndex.value = index;
  assignSourceDraft(form.sources[index]);
  sourceEditorVisible.value = true;
};
const resetSourceEditor = () => {
  sourceEditorIndex.value = -1;
  sourcePickerVisible.value = false;
  sourcePickerModel.value = 'auto';
  assignSourceDraft(defaultSource());
};
const goCatalogSettings = () => router.push('/extensions/rule-studio/catalogs');
const confirmSourceEditor = () => {
  const source = JSON.parse(JSON.stringify(sourceDraft)) as RuleStudioSource;
  if (source.kind === 'url' && !source.url?.trim()) {
    Toast.fail(t('ruleStudio.validation.sourceUrl'));
    return;
  }
  if (source.kind === 'inline' && !source.content?.trim()) {
    Toast.fail(t('ruleStudio.validation.sourceContent'));
    return;
  }
  if (sourceEditorIndex.value < 0) form.sources.push(source);
  else form.sources.splice(sourceEditorIndex.value, 1, source);
  sourceEditorVisible.value = false;
};
const isPristineSource = (source: RuleStudioSource) => source.kind === 'inline'
  && !source.name?.trim()
  && !source.content?.trim()
  && source.format === 'auto';
const addCatalogSources = (items: RuleStudioCatalogItem[]) => {
  const existing = new Set(form.sources
    .filter(source => source.kind === 'url' && source.url?.trim())
    .map(source => source.url!.trim()));
  const additions = items.filter(item => !existing.has(item.url));
  if (!additions.length) return;
  form.sources = form.sources.filter(source => !isPristineSource(source));
  form.sources.push(...additions.map(item => ({
    id: makeId(),
    kind: 'url' as const,
    name: item.name,
    url: item.url,
    enabled: true,
    format: item.format,
  })));
  Toast.success(t('ruleStudio.catalog.addedToast', { count: additions.length }));
};
const removeSource = (index: number) => form.sources.splice(index, 1);
const changeKind = (source: RuleStudioSource) => {
  if (source.kind === 'url') { source.url ||= ''; delete source.content; }
  else { source.content ||= ''; delete source.url; }
};
const sourceKindOptions = () => [
  { value: 'url', text: t('ruleStudio.sourceKinds.url') },
  { value: 'inline', text: t('ruleStudio.sourceKinds.inline') },
];
const sourceFormatOptions = () => RULE_STUDIO_FORMATS.map(option => ({
  value: option.value,
  text: t(`ruleStudio.formats.${option.key}`),
}));
const sourceKindLabel = (kind: RuleStudioSource['kind']) => sourceKindOptions().find(option => option.value === kind)?.text || kind;
const sourceFormatLabel = (format: RuleStudioFormat) => sourceFormatOptions().find(option => option.value === format)?.text || format;
const sourceSummary = (source: RuleStudioSource) => source.kind === 'url'
  ? source.url || t('ruleStudio.emptyValue')
  : t('ruleStudio.inlineLines', { count: (source.content || '').split(/\r?\n/).filter(Boolean).length });
const sourcePickerColumns = computed(() => sourceFormatOptions());
const setSourceKind = (kind: RuleStudioSource['kind']) => {
  sourceDraft.kind = kind;
  changeKind(sourceDraft);
};
const openSourceFormatPicker = () => {
  sourcePickerModel.value = sourceDraft.format;
  sourcePickerVisible.value = true;
};
const confirmSourcePicker = (selectedValue: string) => {
  const value = String(selectedValue || sourcePickerModel.value || '');
  if (!value) return;
  sourceDraft.format = value as RuleStudioFormat;
};
const importFile = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    sourceDraft.content = await file.text();
    sourceDraft.name ||= file.name;
    sourceDraft.kind = 'inline';
  }
  input.value = '';
};
const validate = () => {
  if (!form.name.trim()) { Toast.fail(t('ruleStudio.validation.name')); return false; }
  if (!form.sources.some(source => source.enabled && (source.kind === 'url' ? source.url?.trim() : source.content?.trim()))) {
    Toast.fail(t('ruleStudio.validation.source'));
    return false;
  }
  return true;
};
const save = async () => {
  if (!validate()) return;
  saving.value = true;
  const saved = await ruleStore.saveProject(form, persisted.value);
  saving.value = false;
  if (!saved) { Toast.fail(ruleStore.error); return; }
  Toast.success(t('ruleStudio.saved'));
  router.back();
};
const preview = async () => {
  if (!validate()) return;
  previewing.value = true;
  const output = await ruleStore.preview(form, 'surge-rule-list');
  previewing.value = false;
  if (!output) { Toast.fail(ruleStore.error); return; }
  ruleStore.setPreviewDraft(JSON.parse(JSON.stringify(form)), output);
  router.push(`/extensions/rule-studio/preview/${encodeURIComponent(form.id || 'DRAFT')}`);
};

onMounted(async () => {
  await ruleStore.fetchSourceCatalogs();
  if (!editing) return;
  const project = await ruleStore.getProject(routeId);
  if (project) assignProject(project);
  else Toast.fail(ruleStore.error);
});
</script>

<style scoped>
.editor-page { width: calc(100% - 24px); max-width: 900px; margin: 0 auto; padding-top: 6px; color: var(--primary-text-color); }
.editor-sections { display: grid; gap: 12px; }
.form-block-wrapper { overflow: hidden; border: 1px solid var(--divider-color); border-radius: var(--item-card-radios); background: var(--card-color); }
.form-block-wrapper :deep(.nut-form-item__label) { width: auto; min-width: 88px; flex: 0 0 auto; }
.form-block-wrapper :deep(.nut-form-item__body) { min-width: 0; justify-content: flex-end; }
.form-block-wrapper :deep(.nut-form-item__body__slots), .form-block-wrapper :deep(.nut-input), .form-block-wrapper :deep(.nut-textarea) { min-width: 0; }
.icon-url-field { display: flex; width: 100%; min-width: 0; align-items: center; justify-content: flex-end; gap: 8px; margin-left: auto; }
.icon-url-field :deep(.nut-input-text) { min-width: 0; flex: 1 1 auto; }
.icon-url-form-item :deep(.nut-form-item__label), .icon-url-form-item :deep(.nut-form-item__body), .icon-url-form-item :deep(.nut-form-item__body__slots) { align-items: center; }
.icon-url-form-item :deep(.nut-form-item__body__slots) { width: 100%; }
.icon-repository-button { display: inline-flex; width: 36px; height: 36px; flex: 0 0 36px; align-items: center; justify-content: center; overflow: hidden; border: 1px solid var(--divider-color); border-radius: 10px; background: var(--background-color); color: var(--primary-color); cursor: pointer; }
.icon-repository-button img { width: 100%; height: 100%; object-fit: contain; }
.source-theme-panel { position: relative; overflow: hidden; padding: 12px; border: 1px solid var(--divider-color); border-radius: var(--item-card-radios); background: var(--card-color); }
.source-empty-card { display: flex; min-height: 58px; align-items: center; gap: 12px; padding: 16px; border: 1px solid var(--divider-color); border-radius: var(--item-card-radios); background: var(--card-background-color); }
.source-empty-icon { display: grid; width: 42px; height: 42px; flex: 0 0 42px; place-items: center; border-radius: 13px; background: color-mix(in srgb, var(--primary-color) 10%, transparent); color: var(--primary-color); }
.source-empty-card strong { font-size: 14px; }
.source-empty-card p { margin: 4px 0 0; color: var(--comment-text-color); font-size: 11px; line-height: 1.5; }
.source-card-list { display: grid; gap: 8px; padding: 0; margin: 0; list-style: none; }
.source-summary-card { display: flex; min-width: 0; min-height: 58px; align-items: center; gap: 11px; padding: 12px; border: 1px solid var(--divider-color); border-radius: var(--item-card-radios); background: var(--card-background-color); cursor: pointer; }
.source-summary-card.is-disabled { opacity: .64; }
.source-summary-icon { display: grid; width: 38px; height: 38px; flex: 0 0 38px; place-items: center; border-radius: 12px; background: color-mix(in srgb, var(--primary-color) 10%, transparent); color: var(--primary-color); }
.source-summary-icon.inline { color: #7c5ce7; background: color-mix(in srgb, #7c5ce7 10%, transparent); }
.source-summary-content { display: grid; min-width: 0; flex: 1; gap: 3px; }
.source-summary-heading { display: flex; min-width: 0; align-items: center; gap: 6px; }
.source-summary-heading strong { min-width: 0; overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.source-kind-badge, .source-status-badge { flex: 0 0 auto; padding: 2px 6px; border-radius: 999px; background: color-mix(in srgb, var(--primary-color) 9%, transparent); color: var(--primary-color); font-size: 9px; }
.source-status-badge { background: color-mix(in srgb, var(--succeed-color, #2fb344) 10%, transparent); color: var(--succeed-color, #2fb344); }
.source-status-badge.disabled { background: var(--divider-color); color: var(--comment-text-color); }
.source-summary-value { overflow: hidden; color: var(--comment-text-color); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.source-summary-actions { display: flex; flex: 0 0 auto; align-items: center; }
.source-action { display: grid; width: 34px; height: 34px; place-items: center; border: 0; background: transparent; color: var(--comment-text-color); cursor: pointer; }
.source-action.delete { color: var(--danger-color, #e5484d); }
.source-action.drag-handle { cursor: grab; }
.source-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.add-source-button, .catalog-empty-action { display: flex; min-width: 0; min-height: 62px; align-items: center; gap: 11px; border: 1px solid var(--divider-color); border-radius: var(--item-card-radios); padding: 12px; background: var(--card-background-color); color: var(--primary-text-color); cursor: pointer; text-align: left; }
.add-source-button:hover, .catalog-empty-action:hover { background: color-mix(in srgb, var(--primary-color) 5%, var(--card-background-color)); }
.add-source-button > span:nth-child(2), .catalog-empty-action > span:nth-child(2) { display: grid; min-width: 0; flex: 1; gap: 2px; }
.add-source-button strong, .add-source-button small, .catalog-empty-action strong, .catalog-empty-action small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.add-source-button strong, .catalog-empty-action strong { font-size: 13px; }
.add-source-button small, .catalog-empty-action small { color: var(--comment-text-color); font-size: 11px; }
.add-source-button > svg, .catalog-empty-action > svg { flex: 0 0 auto; color: var(--comment-text-color); font-size: 10px; }
.action-icon { display: grid; width: 34px; height: 34px; flex: 0 0 34px; place-items: center; border-radius: 10px; background: color-mix(in srgb, var(--primary-color) 10%, transparent); color: var(--primary-color); }
.switch-form-item :deep(.nut-form-item__body) { flex: 0 0 auto; margin-left: auto; }
.bottom-actions { position: fixed; z-index: 20; right: 0; bottom: 0; left: 0; padding: 8px var(--safe-area-side); border-top: 1px solid var(--divider-color); background: var(--background-color); }
.bottom-actions-inner { display: flex; width: 100%; max-width: 900px; gap: 6px; margin: 0 auto; }
.preview-action { flex: 0 0 40%; margin: 0 !important; border-radius: 8px; }
.save-action { flex: 0 0 calc(60% - 6px); margin: 0 !important; border-radius: 8px; }
.bottom-actions svg { margin-right: 4px; }
.source-editor { display: flex; box-sizing: border-box; height: 100%; flex-direction: column; overflow: hidden; background: var(--background-color); color: var(--primary-text-color); }
.source-editor-header { display: flex; min-height: 76px; align-items: flex-start; gap: 12px; padding: 3px 42px 14px 2px; }
.source-editor-title { display: grid; min-width: 0; gap: 4px; }
.source-editor-title small { color: var(--primary-color); font-size: 10px; font-weight: 600; letter-spacing: .08em; }
.source-editor-title strong { font-size: 19px; }
.source-editor-title p { margin: 2px 0 0; color: var(--comment-text-color); font-size: 11px; line-height: 1.5; }
.source-kind-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
.source-kind-option { display: grid; min-width: 0; min-height: 58px; grid-template-columns: 34px minmax(0, 1fr) 14px; align-items: center; gap: 9px; border: 1px solid var(--divider-color); border-radius: 12px; padding: 10px 11px; background: var(--card-background-color); color: var(--primary-text-color); cursor: pointer; text-align: left; }
.source-kind-option.selected { border-color: color-mix(in srgb, var(--primary-color) 45%, var(--divider-color)); background: color-mix(in srgb, var(--primary-color) 7%, var(--card-color)); }
.source-kind-option > span:nth-child(2) { overflow: hidden; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.source-kind-option > svg { color: var(--comment-text-color); font-size: 10px; }
.source-kind-option.selected > svg { color: var(--primary-color); }
.source-kind-option-icon { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 10px; background: color-mix(in srgb, var(--primary-color) 10%, transparent); color: var(--primary-color); }
.source-kind-option-icon.inline { color: #7c5ce7; background: color-mix(in srgb, #7c5ce7 10%, transparent); }
.source-editor-form { min-height: 0; flex: 1; overflow-y: auto; border: 1px solid var(--divider-color); border-radius: var(--item-card-radios); }
.source-editor-form :deep(.nut-form-item__label) { width: auto; min-width: 92px; flex: 0 0 auto; }
.source-editor-form :deep(.nut-form-item__body) { min-width: 0; justify-content: flex-end; }
.source-editor-form :deep(.nut-form-item__body__slots), .source-editor-form :deep(.nut-input), .source-editor-form :deep(.nut-textarea) { min-width: 0; }
.picker-field { display: flex; width: 100%; min-height: 42px; align-items: center; justify-content: flex-end; gap: 10px; border: 0; padding: 0; background: transparent; color: var(--primary-text-color); cursor: pointer; font: inherit; }
.picker-field svg { color: var(--comment-text-color); font-size: 10px; }
.content-form-item :deep(.nut-form-item__body) { display: block; }
.file-import-row { display: flex; justify-content: flex-end; padding: 10px 14px; background: var(--card-color); }
.file-import-row label { display: inline-flex; min-height: 36px; align-items: center; gap: 7px; border-radius: 10px; padding: 0 12px; background: color-mix(in srgb, var(--primary-color) 10%, transparent); color: var(--primary-color); cursor: pointer; font-size: 11px; }
.source-editor-footer { display: flex; gap: 8px; padding: 10px 0 max(8px, env(safe-area-inset-bottom)); margin-top: auto; border-top: 1px solid var(--divider-color); }
.source-editor-cancel, .source-editor-confirm { min-height: 42px; border-radius: 10px; }
.source-editor-cancel { min-width: 96px; border: 1px solid var(--divider-color); background: transparent; color: var(--primary-text-color); cursor: pointer; }
.source-editor-confirm { flex: 1; }
@media (min-width: 700px) { :global(.rule-studio-source-editor-popup) { right: 0 !important; left: 0 !important; width: min(620px, calc(100vw - 48px)) !important; margin-right: auto; margin-left: auto; } }
@media (max-width: 560px) { .editor-page { width: calc(100% - 20px); } .source-actions, .source-kind-grid { grid-template-columns: 1fr; } .source-summary-actions .edit { display: none; } .source-kind-badge { display: none; } }
</style>
