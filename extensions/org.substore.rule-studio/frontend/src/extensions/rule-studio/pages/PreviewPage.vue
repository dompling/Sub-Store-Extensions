<template>
  <main class="preview-page">
    <section v-if="project || output" class="preview-header-card">
      <div class="project-identity">
        <span class="project-avatar"><font-awesome-icon icon="fa-solid fa-list-check" /></span>
        <span class="project-copy">
          <span class="project-title-row">
            <strong>{{ project?.name || t('ruleStudio.overview.newTitle') }}</strong>
            <span v-if="output" class="freshness" :class="output.freshness.state">
              {{ t(`ruleStudio.${output.freshness.state}`) }}
            </span>
          </span>
          <span class="project-description">{{ project?.description || t('ruleStudio.overview.descriptionFallback') }}</span>
          <span class="project-meta">{{ projectMeta }}</span>
        </span>
      </div>

      <div class="preview-header-actions">
        <button type="button" class="representation-field" :aria-label="t('ruleStudio.outputFormat')" @click="openRepresentationPicker">
          <span><small>{{ t('ruleStudio.outputFormat') }}</small><strong>{{ representationLabel }}</strong></span>
          <font-awesome-icon icon="fa-solid fa-chevron-right" />
        </button>
        <button type="button" class="refresh-button" :title="t('ruleStudio.refresh')" :aria-label="t('ruleStudio.refresh')" :disabled="loading" @click="load(true)">
          <font-awesome-icon icon="fa-solid fa-arrows-rotate" />
        </button>
      </div>
    </section>

    <section v-if="loading && !output" class="state-panel"><span class="spinner" /><p>{{ t('ruleStudio.refresh') }}…</p></section>
    <section v-else-if="error && !output" class="state-panel error"><font-awesome-icon icon="fa-solid fa-circle-xmark" /><p>{{ error }}</p></section>

    <template v-if="output">
      <section class="summary-grid" :aria-label="t('ruleStudio.diagnostics')">
        <article v-for="item in summaryItems" :key="item.key" class="summary-item" :class="item.key">
          <span class="summary-indicator" />
          <span><small>{{ item.label }}</small><strong>{{ item.value }}</strong></span>
        </article>
      </section>

      <section class="output-card">
        <header class="card-heading">
          <span><small>{{ t('ruleStudio.previewTitle') }}</small><strong>{{ representationLabel }}</strong></span>
          <button type="button" class="text-action" :title="t('ruleStudio.copyOutput')" :aria-label="t('ruleStudio.copyOutput')" @click="copyOutput">
            <font-awesome-icon icon="fa-solid fa-copy" />
            <span>{{ t('ruleStudio.copyOutput') }}</span>
          </button>
        </header>
        <div class="output-scroll"><pre>{{ output.body }}</pre></div>
      </section>

      <section class="diagnostic-card">
        <header class="card-heading">
          <span><small>{{ t('ruleStudio.diagnostics') }}</small><strong>{{ t('ruleStudio.diagnosticCount', { count: output.diagnostics.length }) }}</strong></span>
        </header>

        <div v-if="!output.diagnostics.length" class="diagnostic-empty-panel">
          <span><font-awesome-icon icon="fa-solid fa-circle-check" /></span>
          <div><strong>{{ t('ruleStudio.diagnosticEmpty') }}</strong><p>{{ t('ruleStudio.diagnosticEmptyDescription') }}</p></div>
        </div>

        <div v-else class="diagnostic-groups">
          <section v-for="group in diagnosticGroups" :key="group.key" class="diagnostic-group">
            <header>
              <span class="severity" :class="group.key">{{ group.label }}</span>
              <small>{{ group.items.length }}</small>
            </header>
            <ul>
              <li v-for="(item, index) in group.items" :key="`${item.code}-${item.sourceLine || index}`">
                <span>
                  <strong>{{ item.code }}</strong>
                  <small v-if="item.sourceLine">L{{ item.sourceLine }}</small>
                </span>
                <p>{{ item.message }}</p>
              </li>
            </ul>
          </section>
        </div>
      </section>
    </template>
  </main>

  <RuleStudioOptionPicker
    v-model="representationPickerModel"
    v-model:visible="representationPickerVisible"
    :options="representationOptions"
    :title="t('ruleStudio.outputFormat')"
    :cancel-text="t('ruleStudio.cancel')"
    :confirm-text="t('ruleStudio.confirm')"
    @confirm="confirmRepresentation"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, ref, Toast, useRoute } from '@/extensions/frontend-sdk-v1';
import { RULE_STUDIO_REPRESENTATIONS } from '../constants';
import RuleStudioOptionPicker from '../components/RuleStudioOptionPicker.vue';
import { useRuleStudioI18n } from '../i18n';
import { useRuleStudioStore } from '../store';

const { t } = useRuleStudioI18n();
const route = useRoute();
const ruleStore = useRuleStudioStore();
const id = String(route.params.id || '');
const draft = ref(ruleStore.takePreviewDraft());
const representation = ref<RuleStudioRepresentation>(draft.value?.output.representation || 'surge-rule-list');
const output = ref<RuleStudioOutput | null>(draft.value?.output || null);
const project = ref<RuleStudioProject | null>(draft.value?.project || null);
const loading = ref(false);
const error = ref('');
const representationPickerVisible = ref(false);
const representationPickerModel = ref<string>(representation.value);
const dispositionKeys = ['exact', 'fallback', 'filtered', 'invalid'] as const;

const representationOptions = computed(() => RULE_STUDIO_REPRESENTATIONS.map(option => ({
  value: option.value,
  text: t(`ruleStudio.representations.${option.key}`),
})));
const representationLabel = computed(() => representationOptions.value.find(option => option.value === representation.value)?.text || representation.value);
const projectMeta = computed(() => {
  if (!project.value) return t('ruleStudio.overview.notSaved');
  const parts = [
    t('ruleStudio.sourceCount', { count: project.value.sources.length }),
    t('ruleStudio.overview.revision', { revision: project.value.revision || 1 }),
  ];
  if (project.value.updatedAt) parts.push(t('ruleStudio.updatedAt', { time: new Date(project.value.updatedAt).toLocaleString() }));
  return parts.join(' · ');
});
const summaryItems = computed(() => dispositionKeys.map(key => ({
  key,
  label: t(`ruleStudio.disposition.${key}`),
  value: output.value?.stats?.[key] || 0,
})));
const diagnosticDisposition = (item: RuleStudioDiagnostic) => item.details?.disposition
  || (item.severity === 'error' ? 'invalid' : item.severity === 'warning' ? 'fallback' : 'exact');
const diagnosticGroups = computed(() => dispositionKeys
  .map(key => ({
    key,
    label: t(`ruleStudio.disposition.${key}`),
    items: (output.value?.diagnostics || []).filter(item => diagnosticDisposition(item) === key),
  }))
  .filter(group => group.items.length));

const load = async (forceRefresh = false) => {
  loading.value = true;
  error.value = '';
  if (!project.value && id !== 'DRAFT') project.value = await ruleStore.getProject(id);
  if (!project.value) {
    loading.value = false;
    error.value = ruleStore.error || 'RESOURCE_NOT_FOUND';
    return;
  }
  output.value = await ruleStore.preview(project.value, representation.value, forceRefresh);
  loading.value = false;
  if (!output.value) error.value = ruleStore.error;
};
const switchRepresentation = async (value: RuleStudioRepresentation) => {
  if (representation.value === value && output.value) return;
  representation.value = value;
  representationPickerModel.value = value;
  await load(false);
};
const openRepresentationPicker = () => {
  representationPickerModel.value = representation.value;
  representationPickerVisible.value = true;
};
const confirmRepresentation = (selectedValue: string) => {
  const value = String(selectedValue || representationPickerModel.value || representation.value) as RuleStudioRepresentation;
  void switchRepresentation(value);
};
const copyOutput = async () => {
  if (!output.value?.body) return;
  try {
    await navigator.clipboard.writeText(output.value.body);
    Toast.success(t('ruleStudio.copied'));
  } catch {
    Toast.fail(t('ruleStudio.copyFailed'));
  }
};

onMounted(() => { if (!output.value) void load(false); });
</script>

<style scoped>
.preview-page { width: calc(100% - 24px); max-width: 900px; margin: 0 auto; padding: 6px 0 72px; color: var(--primary-text-color); }
.preview-header-card { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 18px; padding: 14px 16px; border-radius: var(--item-card-radios); background: var(--card-color); }
.project-identity { display: flex; min-width: 0; flex: 1; align-items: center; gap: 12px; }
.project-avatar { display: grid; width: 42px; height: 42px; flex: 0 0 42px; place-items: center; border-radius: 13px; background: color-mix(in srgb, var(--primary-color) 11%, var(--background-color)); color: var(--primary-color); font-size: 18px; }
.project-copy { display: grid; min-width: 0; gap: 3px; }
.project-title-row { display: flex; min-width: 0; align-items: center; gap: 7px; }
.project-title-row strong { min-width: 0; overflow: hidden; font-size: 16px; text-overflow: ellipsis; white-space: nowrap; }
.project-description, .project-meta { overflow: hidden; color: var(--comment-text-color); text-overflow: ellipsis; white-space: nowrap; }
.project-description { font-size: 11px; }
.project-meta { font-size: 9px; }
.freshness { flex: 0 0 auto; padding: 2px 7px; border-radius: 999px; background: color-mix(in srgb, var(--succeed-color, #2fb344) 11%, transparent); color: var(--succeed-color, #2fb344); font-size: 9px; }
.freshness.stale { background: color-mix(in srgb, #f59f00 12%, transparent); color: #b76d00; }
.preview-header-actions { display: flex; flex: 0 0 auto; align-items: stretch; gap: 8px; }
.representation-field { display: flex; min-width: 190px; min-height: 46px; align-items: center; justify-content: space-between; gap: 14px; border: 0; border-radius: 12px; padding: 7px 12px; background: var(--background-color); color: var(--primary-text-color); cursor: pointer; text-align: left; }
.representation-field > span { display: grid; gap: 2px; }
.representation-field small { color: var(--comment-text-color); font-size: 9px; }
.representation-field strong { max-width: 210px; overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.representation-field > svg { color: var(--comment-text-color); font-size: 10px; }
.refresh-button { display: grid; width: 46px; min-height: 46px; place-items: center; border: 0; border-radius: 12px; background: color-mix(in srgb, var(--primary-color) 9%, var(--background-color)); color: var(--primary-color); cursor: pointer; }
.refresh-button:disabled { opacity: .5; cursor: default; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
.summary-item { display: flex; min-width: 0; align-items: center; gap: 9px; padding: 10px 12px; border-radius: 12px; background: var(--card-color); }
.summary-indicator { width: 7px; height: 28px; flex: 0 0 7px; border-radius: 999px; background: var(--succeed-color, #2fb344); }
.summary-item.fallback .summary-indicator { background: #f59f00; }
.summary-item.filtered .summary-indicator, .summary-item.invalid .summary-indicator { background: #e5484d; }
.summary-item > span:last-child { display: flex; min-width: 0; flex: 1; align-items: baseline; justify-content: space-between; gap: 8px; }
.summary-item small { color: var(--comment-text-color); font-size: 10px; }
.summary-item strong { font-size: 17px; }
.output-card, .diagnostic-card { overflow: hidden; margin-top: 12px; border-radius: var(--item-card-radios); background: var(--card-color); }
.card-heading { display: flex; min-height: 56px; align-items: center; justify-content: space-between; gap: 12px; padding: 0 15px; border-bottom: 1px solid var(--divider-color); }
.card-heading > span { display: grid; gap: 2px; }
.card-heading small { color: var(--comment-text-color); font-size: 9px; }
.card-heading strong { font-size: 13px; }
.text-action { display: inline-flex; min-height: 34px; align-items: center; gap: 6px; border: 0; border-radius: 10px; padding: 0 10px; background: color-mix(in srgb, var(--primary-color) 9%, transparent); color: var(--primary-color); cursor: pointer; font-size: 11px; }
.output-scroll { max-height: 55vh; overflow: auto; padding: 14px 16px; }
.output-scroll pre { margin: 0; color: var(--primary-text-color); font: 12px/1.65 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
.diagnostic-empty-panel { display: flex; align-items: center; gap: 11px; padding: 14px 15px; }
.diagnostic-empty-panel > span { display: grid; width: 36px; height: 36px; flex: 0 0 36px; place-items: center; border-radius: 11px; background: color-mix(in srgb, var(--succeed-color, #2fb344) 11%, transparent); color: var(--succeed-color, #2fb344); }
.diagnostic-empty-panel strong { font-size: 12px; }
.diagnostic-empty-panel p { margin: 3px 0 0; color: var(--comment-text-color); font-size: 10px; }
.diagnostic-groups { display: grid; gap: 0; }
.diagnostic-group { padding: 13px 15px; }
.diagnostic-group + .diagnostic-group { border-top: 1px solid var(--divider-color); }
.diagnostic-group > header { display: flex; align-items: center; justify-content: space-between; }
.diagnostic-group > header small { color: var(--comment-text-color); font-size: 10px; }
.severity { padding: 3px 7px; border-radius: 999px; background: color-mix(in srgb, var(--succeed-color, #2fb344) 11%, transparent); color: var(--succeed-color, #2fb344); font-size: 9px; }
.severity.fallback { background: color-mix(in srgb, #f59f00 12%, transparent); color: #b76d00; }
.severity.filtered, .severity.invalid { background: color-mix(in srgb, #e5484d 10%, transparent); color: #d94949; }
.diagnostic-group ul { display: grid; gap: 8px; padding: 0; margin: 10px 0 0; list-style: none; }
.diagnostic-group li { padding: 10px 11px; border-radius: 10px; background: var(--background-color); }
.diagnostic-group li > span { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.diagnostic-group li strong { font-size: 11px; }
.diagnostic-group li small { color: var(--comment-text-color); font-size: 9px; }
.diagnostic-group li p { margin: 4px 0 0; color: var(--comment-text-color); font-size: 10px; line-height: 1.5; }
.state-panel { display: grid; min-height: 45vh; place-items: center; align-content: center; gap: 12px; color: var(--comment-text-color); }
.state-panel.error { color: #d94949; font-size: 28px; }
.state-panel p { margin: 0; font-size: 13px; }
.spinner { width: 26px; height: 26px; border: 3px solid var(--divider-color); border-top-color: var(--primary-color); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 700px) { .preview-header-card { align-items: stretch; flex-direction: column; gap: 12px; } .preview-header-actions, .representation-field { min-width: 0; flex: 1; } .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 480px) { .preview-page { width: calc(100% - 20px); } .text-action span { display: none; } .summary-item { padding: 9px 10px; } }
</style>
