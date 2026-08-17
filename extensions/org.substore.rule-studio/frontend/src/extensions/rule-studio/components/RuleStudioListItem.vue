<template>
  <nut-swipe
    ref="swipe"
    class="rule-item-swipe"
    :class="{ 'is-dual-column': isDualColumn }"
    @open="setActionsOpen"
    @close="setActionsClosed"
  >
    <article
      class="rule-item-wrapper"
      :class="{ archived: project.lifecycle.state === 'archived' }"
      :style="{ padding: itemPadding }"
      @click="handlePrimaryClick"
    >
      <div class="rule-item-avatar-wrapper">
        <span
          class="rule-item-avatar"
          :style="{ width: `${avatarSize}px`, height: `${avatarSize}px` }"
          aria-hidden="true"
        >
          <img
            v-if="project.metadata.iconUrl"
            :src="project.metadata.iconUrl"
            alt=""
            class="rule-item-avatar-image"
          >
          <font-awesome-icon v-else icon="fa-solid fa-list-check" />
        </span>
      </div>

      <div class="rule-item-content">
        <div class="rule-item-title-row">
          <h3 class="rule-item-title" :title="displayName">
            <span class="rule-item-name">{{ displayName }}</span>
          </h3>
          <div class="rule-item-menu" :class="{ 'simple-mode': appearanceSetting.isSimpleMode }">
            <button
              v-if="project.lifecycle.state === 'active'"
              type="button"
              class="card-action"
              :title="t('ruleStudio.copyLink')"
              :aria-label="t('ruleStudio.copyLink')"
              @click.stop="$emit('copy')"
            >
              <font-awesome-icon icon="fa-solid fa-clone" />
            </button>
            <button
              v-if="project.lifecycle.state === 'active'"
              type="button"
              class="card-action"
              :title="t('ruleStudio.edit')"
              :aria-label="t('ruleStudio.edit')"
              @click.stop="$emit('edit')"
            >
              <font-awesome-icon icon="fa-solid fa-pen-nib" />
            </button>
            <button
              type="button"
              class="card-action actions-toggle"
              :class="{ 'is-open': actionsOpen }"
              :title="t(actionsOpen ? 'ruleStudio.collapseActions' : 'ruleStudio.expandActions')"
              :aria-label="t(actionsOpen ? 'ruleStudio.collapseActions' : 'ruleStudio.expandActions')"
              :aria-expanded="actionsOpen"
              @click.stop="toggleActions"
            >
              <font-awesome-icon icon="fa-solid fa-angles-right" />
            </button>
          </div>
        </div>
        <p :class="appearanceSetting.isSimpleMode ? 'rule-item-detail-simple' : 'rule-item-detail'">
          {{ detail }}
        </p>
        <p v-if="project.description" class="rule-item-description">{{ project.description }}</p>
        <span v-if="project.lifecycle.state === 'archived'" class="state-label">
          {{ t('ruleStudio.archived') }}
        </span>
      </div>
    </article>

    <template v-if="appearanceSetting.isLeftRight" #left>
      <template v-if="project.lifecycle.state === 'active'">
        <div class="swipe-action-wrapper">
          <nut-button shape="square" type="primary" class="swipe-action" :title="t('ruleStudio.refresh')" :aria-label="t('ruleStudio.refresh')" @click="$emit('refresh')">
            <font-awesome-icon icon="fa-solid fa-arrows-rotate" />
          </nut-button>
        </div>
        <div class="swipe-action-wrapper">
          <nut-button shape="square" type="success" class="swipe-action" :title="t('ruleStudio.preview')" :aria-label="t('ruleStudio.preview')" @click="$emit('preview')">
            <font-awesome-icon icon="fa-solid fa-eye" />
          </nut-button>
        </div>
        <div class="swipe-action-wrapper">
          <nut-button shape="square" type="danger" class="swipe-action" :title="t('ruleStudio.archive')" :aria-label="t('ruleStudio.archive')" @click="$emit('archive')">
            <font-awesome-icon icon="fa-solid fa-box-archive" />
          </nut-button>
        </div>
        <div class="swipe-action-wrapper">
          <nut-button shape="square" type="danger" class="swipe-action" :title="t('ruleStudio.delete')" :aria-label="t('ruleStudio.delete')" @click="$emit('delete')">
            <font-awesome-icon icon="fa-solid fa-trash-can" />
          </nut-button>
        </div>
      </template>
      <template v-else>
        <div class="swipe-action-wrapper">
          <nut-button shape="square" type="primary" class="swipe-action" :title="t('ruleStudio.restore')" :aria-label="t('ruleStudio.restore')" @click="$emit('restore')">
            <font-awesome-icon icon="fa-solid fa-arrow-rotate-left" />
          </nut-button>
        </div>
        <div class="swipe-action-wrapper">
          <nut-button shape="square" type="danger" class="swipe-action" :title="t('ruleStudio.delete')" :aria-label="t('ruleStudio.delete')" @click="$emit('delete')">
            <font-awesome-icon icon="fa-solid fa-trash-can" />
          </nut-button>
        </div>
      </template>
    </template>

    <template v-else #right>
      <template v-if="project.lifecycle.state === 'active'">
        <div class="swipe-action-wrapper">
          <nut-button shape="square" type="primary" class="swipe-action" :title="t('ruleStudio.refresh')" :aria-label="t('ruleStudio.refresh')" @click="$emit('refresh')">
            <font-awesome-icon icon="fa-solid fa-arrows-rotate" />
          </nut-button>
        </div>
        <div class="swipe-action-wrapper">
          <nut-button shape="square" type="success" class="swipe-action" :title="t('ruleStudio.preview')" :aria-label="t('ruleStudio.preview')" @click="$emit('preview')">
            <font-awesome-icon icon="fa-solid fa-eye" />
          </nut-button>
        </div>
        <div class="swipe-action-wrapper">
          <nut-button shape="square" type="danger" class="swipe-action" :title="t('ruleStudio.archive')" :aria-label="t('ruleStudio.archive')" @click="$emit('archive')">
            <font-awesome-icon icon="fa-solid fa-box-archive" />
          </nut-button>
        </div>
        <div class="swipe-action-wrapper">
          <nut-button shape="square" type="danger" class="swipe-action" :title="t('ruleStudio.delete')" :aria-label="t('ruleStudio.delete')" @click="$emit('delete')">
            <font-awesome-icon icon="fa-solid fa-trash-can" />
          </nut-button>
        </div>
      </template>
      <template v-else>
        <div class="swipe-action-wrapper">
          <nut-button shape="square" type="primary" class="swipe-action" :title="t('ruleStudio.restore')" :aria-label="t('ruleStudio.restore')" @click="$emit('restore')">
            <font-awesome-icon icon="fa-solid fa-arrow-rotate-left" />
          </nut-button>
        </div>
        <div class="swipe-action-wrapper">
          <nut-button shape="square" type="danger" class="swipe-action" :title="t('ruleStudio.delete')" :aria-label="t('ruleStudio.delete')" @click="$emit('delete')">
            <font-awesome-icon icon="fa-solid fa-trash-can" />
          </nut-button>
        </div>
      </template>
    </template>
  </nut-swipe>
</template>

<script setup lang="ts">
import {
  computed,
  ref,
  storeToRefs,
  useSettingsStore,
} from '@/extensions/frontend-sdk-v1';
import { useRuleStudioI18n } from '../i18n';

const props = defineProps<{
  project: RuleStudioDescriptor;
  detail: string;
  isDualColumn?: boolean;
}>();

const emit = defineEmits<{
  publish: [];
  copy: [];
  edit: [];
  refresh: [];
  preview: [];
  archive: [];
  restore: [];
  delete: [];
}>();

const { t } = useRuleStudioI18n();
const settingsStore = useSettingsStore();
const { appearanceSetting } = storeToRefs(settingsStore);
const swipe = ref<{ open: (position: 'left' | 'right') => void; close: () => void } | null>(null);
const actionsOpen = ref(false);
const displayName = computed(() => props.project.displayName || props.project.name);
const avatarSize = computed(() => appearanceSetting.value.isSimpleMode ? 36 : (props.isDualColumn ? 40 : 48));
const itemPadding = computed(() => appearanceSetting.value.isSimpleMode ? '9px' : (props.isDualColumn ? '12px' : '16px'));

const setActionsOpen = () => {
  actionsOpen.value = true;
};

const setActionsClosed = () => {
  actionsOpen.value = false;
};

const handlePrimaryClick = () => {
  if (actionsOpen.value) {
    swipe.value?.close();
    return;
  }
  if (props.project.lifecycle.state === 'active') emit('publish');
};

const toggleActions = () => {
  if (actionsOpen.value) {
    swipe.value?.close();
    return;
  }
  const position = appearanceSetting.value.isLeftRight ? 'right' : 'left';
  swipe.value?.open(position);
};
</script>

<style scoped>
.rule-item-swipe {
  position: relative;
  display: block;
  min-width: 0;
  user-select: none;
}

.rule-item-wrapper {
  display: flex;
  position: relative;
  min-width: 0;
  overflow: hidden;
  border-radius: var(--item-card-radios);
  background: var(--card-color);
  color: var(--primary-text-color);
  cursor: pointer;
  line-height: 1.4;
}

.rule-item-wrapper.archived {
  opacity: .72;
  cursor: default;
}

.rule-item-avatar {
  display: grid;
  box-sizing: border-box;
  flex: 0 0 auto;
  place-items: center;
  margin-right: 15px;
  overflow: hidden;
  border-radius: 13px;
  background: transparent;
  color: var(--primary-color);
  font-size: 20px;
}

.rule-item-avatar-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.rule-item-avatar-wrapper {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  margin-right: 15px;
}

.archived .rule-item-avatar {
  color: var(--comment-text-color);
}

.rule-item-content {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  line-height: 1.6;
}

.rule-item-title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 2px;
}

.rule-item-title {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  margin: 0;
  color: var(--primary-text-color);
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-item-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-item-menu {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  padding: 4px 0;
}

.rule-item-menu.simple-mode {
  position: relative;
  top: 8px;
}

.card-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  padding: 0 6px;
  background: transparent;
  cursor: pointer;
}

.card-action svg {
  width: 16px;
  height: 16px;
  color: var(--comment-text-color);
}

.actions-toggle svg {
  transition: transform .2s ease;
}

.actions-toggle.is-open svg {
  transform: rotate(180deg);
}

.rule-item-detail,
.rule-item-description,
.rule-item-detail-simple {
  display: -webkit-box;
  overflow: hidden;
  margin: 4px 0 0;
  color: var(--comment-text-color);
  font-size: 12px;
  word-break: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  line-clamp: 1;
}

.rule-item-detail-simple {
  max-width: 80%;
  margin-top: 2px;
}

.state-label {
  width: fit-content;
  padding: 2px 7px;
  margin-top: 5px;
  border-radius: 999px;
  background: var(--divider-color);
  color: var(--comment-text-color);
  font-size: 10px;
}

.is-dual-column .rule-item-avatar-wrapper {
  margin-right: 12px;
}

.is-dual-column .rule-item-title-row {
  align-items: flex-start;
  gap: 6px;
}

.is-dual-column .rule-item-title {
  font-size: 15px;
}

:deep(.nut-swipe__left),
:deep(.nut-swipe__right) {
  display: flex;
  align-items: center;
  justify-content: space-around;
}

:deep(.nut-swipe__left) .swipe-action-wrapper,
:deep(.nut-swipe__right) .swipe-action-wrapper {
  padding-left: 14px;
}

:deep(.nut-swipe__left) .swipe-action-wrapper:last-child,
:deep(.nut-swipe__right) .swipe-action-wrapper:last-child {
  padding-right: 14px;
}

:deep(.nut-swipe__left) .swipe-action,
:deep(.nut-swipe__right) .swipe-action {
  width: 44px;
  height: 46px;
  border-radius: 50%;
}
</style>
