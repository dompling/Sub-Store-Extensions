<template>
  <main class="doctor-page" :style="{ paddingBottom: `${bottomSafeArea + 72}px` }">
    <section v-if="resources.length" class="source-panel">
      <nut-form class="source-form">
        <nut-form-item :label="t('subscriptionDoctor.source')">
          <button
            class="source-picker"
            type="button"
            :disabled="!availableResources.length"
            :aria-label="t('subscriptionDoctor.source')"
            @click="openSourcePicker"
          >
            <span>
              <strong>{{ selectedResourceLabel }}</strong>
            </span>
            <font-awesome-icon icon="fa-solid fa-chevron-right" />
          </button>
        </nut-form-item>
      </nut-form>

      <div class="check-actions">
        <span class="check-scope">
          <font-awesome-icon icon="fa-solid fa-shield-halved" />
          <span>{{ t('subscriptionDoctor.checkScope') }}</span>
        </span>
        <div class="check-buttons">
          <button
            class="refresh-button"
            type="button"
            :aria-label="t('subscriptionDoctor.refresh')"
            :title="t('subscriptionDoctor.refresh')"
            :disabled="loading"
            @click="refresh"
          >
            <font-awesome-icon icon="fa-solid fa-arrows-rotate" />
          </button>
          <nut-button
            type="primary"
            class="start-button"
            :loading="checking"
            :disabled="!selectedResource || checking"
            @click="runCheck"
          >
            {{ checking ? t('subscriptionDoctor.checking') : t('subscriptionDoctor.start') }}
          </nut-button>
        </div>
      </div>
      <p class="privacy-note">{{ t('subscriptionDoctor.privacy') }}</p>
    </section>

    <section v-else-if="!loading" class="empty-state-wrapper">
      <nut-empty image="empty">
        <template #description>
          <h3>{{ t('subscriptionDoctor.emptyResources') }}</h3>
          <p>{{ t('subscriptionDoctor.emptyResourcesHelp') }}</p>
        </template>
      </nut-empty>
      <nut-button type="primary" @click="refresh">{{ t('subscriptionDoctor.refresh') }}</nut-button>
    </section>

    <p v-if="error" class="error-banner" role="alert">{{ error }}</p>

    <section class="recent-section">
      <div class="list-title">
        <span>{{ t('subscriptionDoctor.recent') }}</span>
        <small v-if="reports.length">{{ reports.length }}/20</small>
      </div>

      <div v-if="reports.length" class="report-list" :class="{ 'dual-column': isDualColumnMode }">
        <nut-swipe
          v-for="report in reports"
          :key="report.id"
          class="report-swipe"
        >
          <article
            class="report-item"
            :class="{ compact: appearanceSetting.isSimpleMode }"
            :style="{ padding: itemPadding }"
            @click="openReport(report.id)"
          >
            <span class="report-avatar" :class="report.status">
              <font-awesome-icon :icon="statusIcon(report.status)" />
            </span>
            <span class="report-copy">
              <span class="report-heading">
                <strong>{{ report.lastKnownName || report.sourceRef.id }}</strong>
                <small class="status-chip" :class="report.status">
                  {{ t(`subscriptionDoctor.${report.status}`) }}
                </small>
              </span>
              <span class="report-meta">
                {{ formatDate(report.checkedAt) }} · {{ t('subscriptionDoctor.nodeCount', { count: report.counts.total }) }}
              </span>
            </span>
            <button
              type="button"
              class="delete-button"
              :aria-label="t('subscriptionDoctor.delete')"
              :title="t('subscriptionDoctor.delete')"
              @click.stop="removeReport(report)"
            >
              <font-awesome-icon icon="fa-solid fa-trash-can" />
            </button>
          </article>

          <template v-if="appearanceSetting.isLeftRight" #left>
            <nut-button shape="square" type="danger" class="swipe-delete" @click="removeReport(report)">
              <font-awesome-icon icon="fa-solid fa-trash-can" />
            </nut-button>
          </template>
          <template v-else #right>
            <nut-button shape="square" type="danger" class="swipe-delete" @click="removeReport(report)">
              <font-awesome-icon icon="fa-solid fa-trash-can" />
            </nut-button>
          </template>
        </nut-swipe>
      </div>

      <div v-else-if="!loading" class="empty-reports">
        <font-awesome-icon icon="fa-solid fa-file-lines" />
        <strong>{{ t('subscriptionDoctor.noReports') }}</strong>
        <span>{{ t('subscriptionDoctor.noReportsHelp') }}</span>
      </div>
    </section>

    <nut-picker
      v-model="sourcePickerModel"
      v-model:visible="sourcePickerVisible"
      :columns="sourcePickerColumns"
      :title="t('subscriptionDoctor.source')"
      :cancel-text="t('subscriptionDoctor.cancel')"
      :ok-text="t('subscriptionDoctor.confirm')"
      pop-class="subscription-doctor-picker-popup"
      @confirm="confirmSourcePicker"
    />
  </main>
</template>

<script setup lang="ts">
import {
  computed,
  Dialog,
  onMounted,
  ref,
  storeToRefs,
  useGlobalStore,
  useListViewMode,
  useRouter,
  useSettingsStore,
} from '@/extensions/frontend-sdk-v1';
import { useSubscriptionDoctorI18n } from '../i18n';
import { useSubscriptionDoctorStore } from '../store';

const { t } = useSubscriptionDoctorI18n();
const router = useRouter();
const store = useSubscriptionDoctorStore();
const settingsStore = useSettingsStore();
const globalStore = useGlobalStore();
const { resources, reports, loading, checking, error } = storeToRefs(store);
const { appearanceSetting } = storeToRefs(settingsStore);
const { bottomSafeArea } = storeToRefs(globalStore);
const { effectiveListViewMode } = useListViewMode();
const selectedKey = ref('');
const sourcePickerVisible = ref(false);
const sourcePickerModel = ref<string[]>([]);

const isDualColumnMode = computed(() => effectiveListViewMode.value === 'dual-column');
const itemPadding = computed(() => appearanceSetting.value.isSimpleMode ? '10px 12px' : '14px 16px');
const keyOf = (refValue: ResourceRefV1) => [
  refValue.providerId,
  refValue.providerContributionId,
  refValue.type,
  refValue.id,
  refValue.contract,
].join('\u0000');
const selectedResource = computed(() => resources.value.find(
  (resource: SubscriptionDoctorResource) => keyOf(resource.ref) === selectedKey.value,
));
const availableResources = computed(() => resources.value.filter(
  (resource: SubscriptionDoctorResource) => resource.availability?.status === 'available',
));
const resourceTypeLabel = (resource: SubscriptionDoctorResource) => t(`subscriptionDoctor.${resource.ref.type}`);
const selectedResourceLabel = computed(() => selectedResource.value?.name || t('subscriptionDoctor.sourcePlaceholder'));
const sourcePickerColumns = computed(() => availableResources.value.map(resource => ({
  value: keyOf(resource.ref),
  text: `${resource.name} · ${resourceTypeLabel(resource)}`,
})));
const statusIcon = (status: SubscriptionDoctorReport['status']) => status === 'healthy'
  ? 'fa-solid fa-circle-check'
  : status === 'warning'
    ? 'fa-solid fa-triangle-exclamation'
    : 'fa-solid fa-circle-xmark';

const openSourcePicker = () => {
  sourcePickerModel.value = selectedKey.value
    ? [selectedKey.value]
    : availableResources.value[0]
      ? [keyOf(availableResources.value[0].ref)]
      : [];
  sourcePickerVisible.value = true;
};
const confirmSourcePicker = ({ selectedValue }: { selectedValue?: string[] }) => {
  const value = selectedValue?.[0] || sourcePickerModel.value[0] || '';
  if (value) selectedKey.value = value;
};
const refresh = async () => {
  await store.refresh();
  if (!selectedResource.value) {
    const available = availableResources.value[0];
    selectedKey.value = available ? keyOf(available.ref) : '';
  }
};
const runCheck = async () => {
  if (!selectedResource.value) return;
  const report = await store.run(selectedResource.value.ref);
  if (report) router.push(`/extensions/subscription-doctor/report/${encodeURIComponent(report.id)}`);
};
const openReport = (id: string) => router.push(`/extensions/subscription-doctor/report/${encodeURIComponent(id)}`);
const removeReport = (report: SubscriptionDoctorReport) => {
  Dialog({
    title: t('subscriptionDoctor.delete'),
    content: t('subscriptionDoctor.deleteConfirm'),
    popClass: 'auto-dialog',
    okText: t('subscriptionDoctor.confirm'),
    cancelText: t('subscriptionDoctor.cancel'),
    onOk: () => store.remove(report.id),
  });
};
const formatDate = (value: number) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'short',
  timeStyle: 'short',
}).format(new Date(value));

onMounted(refresh);
</script>

<style scoped>
.doctor-page {
  width: calc(100% - 1.5rem);
  max-width: 900px;
  margin: 0 auto;
  color: var(--primary-text-color);
  overflow-x: hidden;
  overflow-x: clip;
}

.source-panel {
  overflow: hidden;
  border-radius: var(--item-card-radios);
  background: var(--card-color);
}

.source-form :deep(.nut-cell-group__warp) {
  margin: 0;
  border-radius: 0;
  background: transparent;
}

.source-form :deep(.nut-form-item__label) {
  width: auto;
  flex: 0 0 auto;
}

.source-form :deep(.nut-form-item__body) {
  min-width: 0;
  flex: 1;
  justify-content: flex-end;
}

.source-form :deep(.nut-form-item__body__slots) {
  display: flex;
  width: 100%;
  min-width: 0;
  justify-content: flex-end;
}

.source-picker {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 48px;
  flex: 1;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  border: 0;
  padding: 0;
  margin-left: auto;
  background: transparent;
  color: var(--primary-text-color);
  cursor: pointer;
  text-align: right;
}

.source-picker > span {
  display: grid;
  min-width: 0;
  flex: 1;
  justify-items: end;
  gap: 2px;
}

.source-picker strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-picker > svg {
  color: var(--comment-text-color);
  font-size: 10px;
}

.check-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-top: 1px solid var(--divider-color);
  padding: 12px 16px;
}

.check-scope {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  color: var(--comment-text-color);
  font-size: 11px;
  line-height: 1.45;
}

.check-scope > svg {
  flex: 0 0 auto;
  color: var(--primary-color);
}

.check-buttons {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.refresh-button {
  display: grid;
  width: 42px;
  min-height: 42px;
  place-items: center;
  border: 0;
  border-radius: 11px;
  background: var(--background-color);
  color: var(--primary-color);
  cursor: pointer;
}

.start-button {
  min-width: 118px;
  min-height: 42px;
}

.privacy-note {
  margin: 0;
  border-top: 1px solid var(--divider-color);
  padding: 9px 16px 11px;
  color: var(--comment-text-color);
  font-size: 10px;
  line-height: 1.5;
}

.error-banner {
  margin: 12px 0 0;
  border-radius: 10px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--danger-color, #e5484d) 8%, var(--card-color));
  color: var(--danger-color, #e5484d);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.recent-section {
  margin-top: 18px;
}

.list-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px 10px;
  color: var(--comment-text-color);
  font-size: 13px;
}

.list-title small {
  font-size: 10px;
}

.report-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.report-list.dual-column {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.report-swipe {
  min-width: 0;
  overflow: hidden;
  border-radius: var(--item-card-radios);
}

.report-item {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
  background: var(--card-color);
  cursor: pointer;
}

.report-avatar {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  place-items: center;
  border-radius: 12px;
  background: color-mix(in srgb, var(--succeed-color, #2fb344) 10%, var(--background-color));
  color: var(--succeed-color, #2fb344);
}

.report-avatar.warning {
  background: color-mix(in srgb, #f59f00 11%, var(--background-color));
  color: #c77900;
}

.report-avatar.error {
  background: color-mix(in srgb, var(--danger-color, #e5484d) 9%, var(--background-color));
  color: var(--danger-color, #e5484d);
}

.report-item.compact .report-avatar {
  width: 36px;
  height: 36px;
  flex-basis: 36px;
}

.report-copy {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 5px;
}

.report-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.report-heading strong {
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-chip {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 2px 6px;
  background: color-mix(in srgb, var(--succeed-color, #2fb344) 9%, transparent);
  color: var(--succeed-color, #2fb344);
  font-size: 9px;
}

.status-chip.warning {
  background: color-mix(in srgb, #f59f00 11%, transparent);
  color: #b76d00;
}

.status-chip.error {
  background: color-mix(in srgb, var(--danger-color, #e5484d) 9%, transparent);
  color: var(--danger-color, #e5484d);
}

.report-meta {
  overflow: hidden;
  color: var(--comment-text-color);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delete-button {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--comment-text-color);
  cursor: pointer;
}

.swipe-delete {
  height: 100%;
  min-height: 100%;
}

.empty-state-wrapper,
.empty-reports {
  display: grid;
  place-items: center;
  text-align: center;
}

.empty-state-wrapper {
  padding: 20px 0;
}

.empty-state-wrapper h3,
.empty-state-wrapper p {
  margin: 0;
}

.empty-state-wrapper p,
.empty-reports span {
  color: var(--comment-text-color);
  font-size: 11px;
}

.empty-reports {
  gap: 7px;
  min-height: 150px;
  border-radius: var(--item-card-radios);
  background: var(--card-color);
  color: var(--comment-text-color);
}

.empty-reports > svg {
  color: var(--primary-color);
  font-size: 24px;
}

button:disabled {
  cursor: default;
  opacity: .5;
}

:global(.subscription-doctor-picker-popup) {
  border-radius: var(--item-card-radios) var(--item-card-radios) 0 0;
}

@media (max-width: 700px) {
  .report-list.dual-column {
    display: flex;
  }

  .check-actions {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .check-buttons,
  .start-button {
    flex: 1;
  }
}

@media (max-width: 480px) {
  .doctor-page {
    width: calc(100% - 20px);
  }

  .delete-button {
    width: 30px;
    flex-basis: 30px;
  }
}
</style>
