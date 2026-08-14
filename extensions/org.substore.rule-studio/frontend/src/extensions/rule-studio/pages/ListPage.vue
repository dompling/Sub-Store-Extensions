<template>
  <div class="rule-studio-list">
    <Teleport to="body">
      <div
        v-if="projects.length && (appearanceSetting.showFloatingRefreshButton || appearanceSetting.showFloatingAddButton)"
        class="drag-btn-wrapper"
      >
        <nut-drag
          :attract="true"
          :boundary="{ top: 64, left: 16, bottom: bottomSafeArea + 68, right: 16 }"
          :style="{ cursor: 'pointer', left: '15px', bottom: `${bottomSafeArea + 84}px` }"
        >
          <div v-if="appearanceSetting.showFloatingRefreshButton" class="drag-btn refresh" @click="refresh">
            <font-awesome-icon icon="fa-solid fa-arrow-rotate-right" />
          </div>
          <div v-if="appearanceSetting.showFloatingAddButton" class="drag-btn" @click="create">
            <font-awesome-icon icon="fa-solid fa-plus" />
          </div>
        </nut-drag>
      </div>
    </Teleport>

    <div v-if="projects.length || archivedProjects.length" class="list-content">
      <section v-if="projects.length" class="list-section">
        <p class="list-title">{{ t('ruleStudio.title') }} ({{ projects.length }})</p>
        <div class="project-list" :class="{ 'dual-column': isDualColumnMode }">
          <div v-for="project in projects" :key="project.ref.id" class="project-item">
            <RuleStudioListItem
              :project="project"
              :detail="projectDetail(project)"
              :is-dual-column="isDualColumnMode"
              @publish="openPublishDialog(project)"
              @copy="copyProjectLink(project)"
              @edit="edit(project.ref.id)"
              @refresh="refreshProject(project.ref.id)"
              @preview="preview(project.ref.id)"
              @archive="archive(project.ref.id)"
            />
          </div>
        </div>
      </section>

      <section v-if="archivedProjects.length" class="list-section archived-section">
        <p class="list-title">{{ t('ruleStudio.archivedProjects') }} ({{ archivedProjects.length }})</p>
        <div class="project-list" :class="{ 'dual-column': isDualColumnMode }">
          <div v-for="project in archivedProjects" :key="project.ref.id" class="project-item">
            <RuleStudioListItem
              :project="project"
              :detail="projectDetail(project)"
              :is-dual-column="isDualColumnMode"
              @restore="restore(project.ref.id)"
            />
          </div>
        </div>
      </section>
    </div>

    <div v-else-if="!loading" class="empty-state-wrapper">
      <nut-empty image="empty">
        <template #description>
          <h3>{{ t('ruleStudio.emptyTitle') }}</h3>
          <p>{{ t('ruleStudio.emptyDescription') }}</p>
        </template>
      </nut-empty>
      <nut-button type="primary" @click="create">{{ t('ruleStudio.create') }}</nut-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  createVNode,
  Dialog,
  onMounted,
  onUnmounted,
  PreviewPanel,
  storeToRefs,
  Toast,
  useGlobalStore,
  useHostAPI,
  useListViewMode,
  useMethodStore,
  useRouter,
  useSettingsStore,
} from '@/extensions/frontend-sdk-v1';
import RuleStudioListItem from '../components/RuleStudioListItem.vue';
import { RULE_STUDIO_COMMANDS } from '../constants';
import { RULE_STUDIO_TARGET_DEFINITIONS } from '../domain/targets';
import { useRuleStudioI18n } from '../i18n';
import { useRuleStudioStore } from '../store';

const { t } = useRuleStudioI18n();
const router = useRouter();
const methodStore = useMethodStore();
const globalStore = useGlobalStore();
const settingsStore = useSettingsStore();
const ruleStore = useRuleStudioStore();
const { projects, archivedProjects, loading } = storeToRefs(ruleStore);
const { bottomSafeArea } = storeToRefs(globalStore);
const { appearanceSetting } = storeToRefs(settingsStore);
const { effectiveListViewMode } = useListViewMode();
const isDualColumnMode = computed(() => effectiveListViewMode.value === 'dual-column');
const { currentUrl } = useHostAPI();
const create = () => router.push('/extensions/rule-studio/edit/NEW');
const edit = (id: string) => router.push(`/extensions/rule-studio/edit/${encodeURIComponent(id)}`);
const preview = (id: string) => router.push(`/extensions/rule-studio/preview/${encodeURIComponent(id)}`);
const openCatalogs = () => router.push('/extensions/rule-studio/catalogs');
const refresh = () => ruleStore.fetchProjects(true);
const projectDetail = (project: RuleStudioDescriptor) => [
  t('ruleStudio.sourceCount', { count: project.metadata.enabledSourceCount }),
  t('ruleStudio.ruleCount', { count: project.metadata.ruleCount }),
  t('ruleStudio.diagnosticCount', { count: project.metadata.warningCount + project.metadata.errorCount }),
].join(' · ');

const copyText = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard is unavailable');
};

const projectDownloadUrl = (project: RuleStudioDescriptor) =>
  `${currentUrl.value}/download/rule-set/${encodeURIComponent(project.ref.id)}`;

const publishTargets = computed(() => RULE_STUDIO_TARGET_DEFINITIONS);

const copyProjectLink = async (project: RuleStudioDescriptor) => {
  try {
    await copyText(projectDownloadUrl(project));
    Toast.success(t('ruleStudio.linkCopied'));
  } catch {
    Toast.fail(t('ruleStudio.copyFailed'));
  }
};

const openPublishDialog = (project: RuleStudioDescriptor) => {
  Dialog({
    title: t('ruleStudio.publishTitle'),
    content: createVNode(PreviewPanel, {
      name: project.ref.id,
      displayName: project.displayName || project.name,
      type: 'config-project',
      url: projectDownloadUrl(project),
      general: t('ruleStudio.publishTitle'),
      notify: t('ruleStudio.linkCopied'),
      desc: t('ruleStudio.publishDescription'),
      includeUnsupportedProxyLabel: t('subPage.panel.options.includeUnsupportedProxy'),
      prettyYamlLabel: t('subPage.panel.options.prettyYaml'),
      noFlowLabel: t('subPage.panel.options.noFlow'),
      displayPreviewInWebPageLabel: t('moreSettingPage.displayPreviewInWebPage'),
      platforms: publishTargets.value,
      showSubscriptionOptions: false,
    }),
    popClass: 'auto-dialog',
    noOkBtn: true,
    noCancelBtn: true,
    closeOnClickOverlay: true,
    closeOnPopstate: true,
    lockScroll: false,
  });
};

const refreshProject = async (id: string) => {
  if (await ruleStore.refresh(id)) Toast.success(t('ruleStudio.refreshedToast'));
  else Toast.fail(ruleStore.error);
};

const restore = async (id: string) => {
  if (await ruleStore.restoreProject(id)) Toast.success(t('ruleStudio.restoredToast'));
  else Toast.fail(ruleStore.error);
};

const archive = (id: string) => {
  Dialog({
    title: t('ruleStudio.archiveTitle'),
    content: t('ruleStudio.archiveDescription'),
    okText: t('ruleStudio.confirm'),
    cancelText: t('ruleStudio.cancel'),
    popClass: 'auto-dialog',
    onOk: async () => {
      if (await ruleStore.archiveProject(id)) Toast.success(t('ruleStudio.archivedToast'));
      else Toast.fail(ruleStore.error);
    },
  });
};

onMounted(() => {
  methodStore.registerMethod(RULE_STUDIO_COMMANDS.add, create);
  methodStore.registerMethod(RULE_STUDIO_COMMANDS.catalogs, openCatalogs);
  ruleStore.fetchProjects(true);
});

onUnmounted(() => {
  methodStore.removeMethod(RULE_STUDIO_COMMANDS.add);
  methodStore.removeMethod(RULE_STUDIO_COMMANDS.catalogs);
});
</script>

<style scoped>
.rule-studio-list { padding-bottom: calc(v-bind(bottomSafeArea) + 72px); }
.list-content { width: calc(100% - 1.5rem); max-width: 900px; margin: 0 auto; }
.list-section + .list-section { margin-top: 24px; }
.list-title { margin: 0; padding: 0; color: var(--comment-text-color); font-size: 13px; }
.project-list { display: flex; flex-direction: column; gap: 24px; padding-top: 12px; }
.project-list.dual-column { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
.project-item { min-width: 0; overflow: hidden; border-radius: var(--item-card-radios); }
.archived-section { padding-top: 4px; border-top: 1px solid var(--divider-color); }
.empty-state-wrapper { display: flex; min-height: 60vh; flex-direction: column; align-items: center; justify-content: center; }
.empty-state-wrapper h3 { margin: 0 0 6px; color: var(--primary-text-color); }
.empty-state-wrapper p { max-width: 340px; margin: 0; color: var(--comment-text-color); text-align: center; }
@media (max-width: 760px) { .project-list.dual-column { grid-template-columns: 1fr; } }
</style>
