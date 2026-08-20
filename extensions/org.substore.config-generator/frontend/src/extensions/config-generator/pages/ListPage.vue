<template>
  <div class="config-generator-list">
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
          <div v-if="appearanceSetting.showFloatingAddButton" class="drag-btn" @click="createProject">
            <font-awesome-icon icon="fa-solid fa-plus" />
          </div>
        </nut-drag>
      </div>
    </Teleport>

    <div v-if="projects.length" class="subs-list-wrapper" :class="{ 'dual-column-mode': isDualColumnMode }">
      <div class="subs-list-container">
        <div class="subs-list-content">
          <div class="title-wrappers">
            <p class="list-title">
              <span class="list-title-text">{{ $t('configGenerator.title') }} ({{ projects.length }})</span>
            </p>
          </div>

          <div class="list-draggable" :class="{ 'dual-column': isDualColumnMode }">
            <div v-for="project in projects" :key="project.name" class="draggable-item">
              <ConfigGeneratorListItem
                :project="project"
                :detail="projectDetail(project)"
                :is-dual-column="isDualColumnMode"
                @publish="openPublishDialog(project)"
                @copy="copyProjectLink(project)"
                @duplicate="duplicateProject(project)"
                @edit="editProject(project.name)"
                @health="openHealth(project.name)"
                @remove="removeProject(project)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="!loading" class="empty-state-wrapper">
      <nut-empty image="empty">
        <template #description>
          <h3>{{ $t('configGenerator.emptyTitle') }}</h3>
          <p>{{ $t('configGenerator.emptyDescription') }}</p>
        </template>
      </nut-empty>
      <div class="empty-actions">
        <nut-button type="primary" @click="createProject">{{ $t('configGenerator.create') }}</nut-button>
      </div>
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
import { useConfigGeneratorI18n } from '@/extensions/config-generator/i18n';
import { useConfigGeneratorStore } from '@/extensions/config-generator/store';
import ConfigGeneratorListItem from '@/extensions/config-generator/components/ConfigGeneratorListItem.vue';
import { createConfigProjectDuplicate } from '@/extensions/config-generator/domain/projectDuplicate';
import {
  CONFIG_GENERATOR_TARGET_DEFINITIONS,
  CONFIG_GENERATOR_TARGET_REGISTRY,
  DEFAULT_CONFIG_GENERATOR_TARGET,
} from '@/extensions/config-generator/domain/targets';
import { CONFIG_GENERATOR_COMMANDS } from '@/extensions/config-generator/constants';

const { t } = useConfigGeneratorI18n();
const router = useRouter();
const configStore = useConfigGeneratorStore();
const globalStore = useGlobalStore();
const methodStore = useMethodStore();
const settingsStore = useSettingsStore();
const { projects, loading } = storeToRefs(configStore);
const { bottomSafeArea } = storeToRefs(globalStore);
const { appearanceSetting } = storeToRefs(settingsStore);
const { effectiveListViewMode } = useListViewMode();
const isDualColumnMode = computed(() => effectiveListViewMode.value === 'dual-column');
const { currentUrl } = useHostAPI();
const duplicatingProjects = new Set<string>();

const createProject = () => router.push('/extensions/config-generator/edit/UNTITLED');
const importProject = () => router.push('/extensions/config-generator/import');
const editProject = (name: string) => router.push(`/extensions/config-generator/edit/${encodeURIComponent(name)}`);
const openHealth = (name: string) => router.push(`/extensions/config-generator/health/${encodeURIComponent(name)}`);
const refresh = () => configStore.fetchProjects();
const actualRuleCount = (project: ConfigProject) => (project.rules || []).filter(item => !['comment', 'blank'].includes(item.kind)).length;
const sourceModeLabel = (project: ConfigProject) => {
  if (project.embeddedSource && project.remoteProxySources?.length) return t('configGenerator.modeMixed');
  if (project.embeddedSource) return t('configGenerator.modeEmbedded');
  return t('configGenerator.modeRemote');
};
const projectDetail = (project: ConfigProject) => [
  t('configGenerator.groupsCount', { count: project.groups?.length || 0 }),
  t('configGenerator.rulesCount', { count: actualRuleCount(project) }),
  sourceModeLabel(project),
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

const copyProjectLink = async (project: ConfigProject) => {
  try {
    await copyText(`${currentUrl.value}/download/config-project/${encodeURIComponent(project.name)}`);
    Toast.success(t('configGenerator.linkCopied'));
  } catch {
    Toast.fail(t('configGenerator.copyFailed'));
  }
};

const duplicateProject = async (project: ConfigProject) => {
  if (duplicatingProjects.has(project.name)) return;
  duplicatingProjects.add(project.name);
  if (!(await configStore.fetchProjects())) {
    duplicatingProjects.delete(project.name);
    Toast.warn(configStore.error || t('configGenerator.operationFailed'));
    return;
  }
  const duplicate = createConfigProjectDuplicate(
    project,
    configStore.projects,
    t('configGenerator.copyNameSuffix'),
  );
  const draft = {
    name: duplicate.name,
    displayName: duplicate.displayName || duplicate.name,
  };
  let saving = false;
  const input = (
    field: keyof typeof draft,
    placeholder: string,
    className: string,
  ) => createVNode('input', {
    value: draft[field],
    class: `duplicate-project-dialog-input ${className}`,
    type: 'text',
    autocomplete: 'off',
    spellcheck: false,
    placeholder,
    onInput: (event: Event) => {
      draft[field] = (event.target as HTMLInputElement).value;
    },
  });

  try {
    Dialog({
      title: t('configGenerator.duplicateProject'),
      content: createVNode('div', { class: 'duplicate-project-dialog-form' }, [
        createVNode('p', { class: 'duplicate-project-dialog-description' },
          t('configGenerator.duplicateProjectDescription')),
        createVNode('label', { class: 'duplicate-project-dialog-field' }, [
          createVNode('span', {}, t('configGenerator.fields.name')),
          input('name', t('configGenerator.placeholders.name'), 'duplicate-project-name-input'),
          createVNode('small', {}, t('configGenerator.duplicateProjectNameHelp')),
        ]),
        createVNode('label', { class: 'duplicate-project-dialog-field' }, [
          createVNode('span', {}, t('configGenerator.fields.displayName')),
          input('displayName', t('configGenerator.placeholders.displayName'), 'duplicate-project-display-name-input'),
        ]),
      ]),
      popClass: 'auto-dialog duplicate-project-dialog-pop',
      okText: t('specificWord.confirm'),
      cancelText: t('specificWord.cancel'),
      closeOnClickOverlay: false,
      beforeClose: async (action: string) => {
        if (action !== 'ok') return true;
        if (saving) return false;
        saving = true;
        try {
          const name = draft.name.trim();
          const displayName = draft.displayName.trim();
          if (!name || !/^[a-zA-Z\d._-]+$/.test(name)) {
            Toast.warn(t('configGenerator.invalidName'));
            return false;
          }
          if (!(await configStore.fetchProjects())) {
            Toast.warn(configStore.error || t('configGenerator.operationFailed'));
            return false;
          }
          if (configStore.projects.some(item => item.name === name)) {
            Toast.warn(t('configGenerator.duplicateProjectNameExists'));
            return false;
          }
          const visibleName = displayName || name;
          if (configStore.projects.some(item => (item.displayName?.trim() || item.name) === visibleName)) {
            Toast.warn(t('configGenerator.duplicateProjectDisplayNameExists'));
            return false;
          }
          duplicate.name = name;
          duplicate.displayName = displayName;
          if (!(await configStore.saveProject(duplicate))) {
            Toast.warn(configStore.error || t('configGenerator.operationFailed'));
            return false;
          }
          Toast.success(t('configGenerator.projectDuplicated', { name: visibleName }));
          return true;
        } finally {
          saving = false;
        }
      },
      onClosed: () => duplicatingProjects.delete(project.name),
    });
  } catch {
    duplicatingProjects.delete(project.name);
    Toast.warn(t('configGenerator.operationFailed'));
  }
};

const openPublishDialog = (project: ConfigProject) => {
  Dialog({
    title: t('configGenerator.publishTitle'),
    content: createVNode(PreviewPanel, {
      name: project.name,
      displayName: project.displayName,
      type: 'config-project',
      url: `${currentUrl.value}/download/config-project/${encodeURIComponent(project.name)}`,
      general: t(CONFIG_GENERATOR_TARGET_REGISTRY[DEFAULT_CONFIG_GENERATOR_TARGET].outputLabelKey),
      notify: t('configGenerator.linkCopied'),
      desc: t('subPage.panel.tips.desc'),
      includeUnsupportedProxyLabel: t('subPage.panel.options.includeUnsupportedProxy'),
      prettyYamlLabel: t('subPage.panel.options.prettyYaml'),
      noFlowLabel: t('subPage.panel.options.noFlow'),
      displayPreviewInWebPageLabel: t('moreSettingPage.displayPreviewInWebPage'),
      platforms: CONFIG_GENERATOR_TARGET_DEFINITIONS.map(target => ({
        name: t(target.outputLabelKey),
        path: target.target === DEFAULT_CONFIG_GENERATOR_TARGET ? null : target.downloadSuffix,
        icon: target.icon,
      })),
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

const removeProject = (project: ConfigProject) => {
  Dialog({
    title: t('configGenerator.deleteTitle'),
    content: project.displayName || project.name,
    popClass: 'auto-dialog',
    okText: t('specificWord.confirm'),
    cancelText: t('specificWord.cancel'),
    onOk: async () => {
      if (await configStore.removeProject(project.name)) Toast.success(t('configGenerator.deleted'));
    },
  });
};

onMounted(() => {
  methodStore.registerMethod(CONFIG_GENERATOR_COMMANDS.add, createProject);
  methodStore.registerMethod(CONFIG_GENERATOR_COMMANDS.import, importProject);
  configStore.fetchProjects();
});

onUnmounted(() => {
  methodStore.removeMethod(CONFIG_GENERATOR_COMMANDS.add);
  methodStore.removeMethod(CONFIG_GENERATOR_COMMANDS.import);
});
</script>

<style lang="scss" scoped>
.config-generator-list {
  padding-bottom: calc(v-bind(bottomSafeArea) + 72px);
}

.empty-actions {
  display: flex;
  gap: 8px;
}

:global(.duplicate-project-dialog-form) {
  display: grid;
  gap: 14px;
  text-align: left;
}

:global(.duplicate-project-dialog-description) {
  margin: 0;
  color: var(--comment-text-color);
  font-size: 13px;
  line-height: 1.55;
}

:global(.duplicate-project-dialog-field) {
  display: grid;
  gap: 6px;
  color: var(--primary-text-color);
  font-size: 13px;
}

:global(.duplicate-project-dialog-field > span) {
  font-weight: 600;
}

:global(.duplicate-project-dialog-field > small) {
  color: var(--comment-text-color);
  line-height: 1.45;
}

:global(.duplicate-project-dialog-input) {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  border: 1px solid var(--divider-color);
  border-radius: 9px;
  padding: 10px 12px;
  outline: none;
  background: var(--background-color);
  color: var(--primary-text-color);
  font: inherit;
}

:global(.duplicate-project-dialog-input:focus) {
  border-color: var(--primary-color);
}

.subs-list-wrapper {
  width: 100%;
}

.subs-list-container {
  width: 100%;
}

.subs-list-content {
  width: calc(100% - 1.5rem);
  max-width: 900px;
  margin: 0 auto;
}

.title-wrappers {
  margin-top: 0;
  padding-top: 0;
  color: var(--comment-text-color);
}

.list-title {
  display: flex;
  align-items: center;
  margin: 0;
  padding: 0;
  color: var(--comment-text-color);
  font-size: 13px;
}

.list-draggable {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding-top: 12px;
}

.draggable-item {
  min-width: 0;
  border-radius: var(--item-card-radios);
  overflow: hidden;
}

.list-draggable.dual-column {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}
</style>
