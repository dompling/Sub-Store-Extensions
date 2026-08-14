<template>
  <main class="result-page">
    <div v-if="loading" class="state-panel">
      <span class="spinner" />
      <p>{{ t('subscriptionDoctor.checking') }}</p>
    </div>
    <div v-else-if="!report" class="state-panel error" role="alert">
      <font-awesome-icon icon="fa-solid fa-circle-xmark" />
      <p>{{ t('subscriptionDoctor.reportNotFound') }}</p>
    </div>

    <template v-else>
      <section class="report-header-card">
        <div class="report-identity">
          <span class="report-avatar" :class="report.status">
            <font-awesome-icon :icon="statusIcon" />
          </span>
          <span class="report-copy">
            <span class="report-title-row">
              <strong>{{ report.lastKnownName || report.sourceRef.id }}</strong>
              <small class="status-chip" :class="report.status">
                {{ t(`subscriptionDoctor.${report.status}`) }}
              </small>
            </span>
            <span>{{ formatDate(report.checkedAt) }}</span>
            <small>{{ t('subscriptionDoctor.duration', { value: report.durationMs }) }}</small>
          </span>
        </div>
        <div class="header-actions">
          <button type="button" :title="t('subscriptionDoctor.copyJson')" :aria-label="t('subscriptionDoctor.copyJson')" @click="copy('json')">
            <font-awesome-icon icon="fa-solid fa-clone" />
          </button>
          <button type="button" :title="t('subscriptionDoctor.exportJson')" :aria-label="t('subscriptionDoctor.exportJson')" @click="download('json')">
            <font-awesome-icon icon="fa-solid fa-file-export" />
          </button>
        </div>
      </section>

      <section class="overview-strip" :aria-label="t('subscriptionDoctor.overview')">
        <span v-for="item in overviewItems" :key="item.key" class="overview-cell">
          <small>{{ item.label }}</small>
          <strong>{{ item.value }}</strong>
        </span>
      </section>

      <section class="result-section findings-section">
        <header class="section-heading">
          <span>
            <small>{{ t('subscriptionDoctor.diagnostics') }}</small>
            <strong>{{ t('subscriptionDoctor.findingCount', { count: findings.length }) }}</strong>
          </span>
        </header>

        <div v-if="findings.length" class="finding-list">
          <article v-for="item in findings" :key="`${item.code}:${item.path || ''}`" class="finding-row">
            <span class="finding-icon" :class="item.severity">
              <font-awesome-icon :icon="severityIcon(item.severity)" />
            </span>
            <span class="finding-copy">
              <strong>{{ issueTitle(item) }}</strong>
              <small>{{ findingMeta(item) }}</small>
            </span>
            <b>{{ item.count }}</b>
          </article>
        </div>
        <div v-else class="clear-row">
          <font-awesome-icon icon="fa-solid fa-circle-check" />
          <span>
            <strong>{{ t('subscriptionDoctor.allClearTitle') }}</strong>
            <small>{{ t('subscriptionDoctor.allClearDescription', { count: report.counts.total }) }}</small>
          </span>
        </div>
      </section>

      <section class="result-section">
        <header class="section-heading">
          <span>
            <small>{{ t('subscriptionDoctor.compatibility') }}</small>
            <strong>{{ t('subscriptionDoctor.fourClientOverview') }}</strong>
          </span>
        </header>
        <div class="compatibility-list">
          <div v-for="row in compatibilityRows" :key="row.key" class="compatibility-row">
            <span class="client-name">{{ row.label }}</span>
            <span class="compatibility-counts">
              <small class="exact">{{ t('subscriptionDoctor.exact') }} {{ row.counts.exact }}</small>
              <small v-if="row.counts.fallback" class="fallback">{{ t('subscriptionDoctor.fallback') }} {{ row.counts.fallback }}</small>
              <small v-if="row.counts.filtered" class="filtered">{{ t('subscriptionDoctor.filtered') }} {{ row.counts.filtered }}</small>
              <small v-if="row.counts.unknown" class="unknown">{{ t('subscriptionDoctor.unknown') }} {{ row.counts.unknown }}</small>
            </span>
          </div>
        </div>
      </section>

      <section class="result-section">
        <header class="section-heading">
          <span>
            <small>{{ t('subscriptionDoctor.nodeProfile') }}</small>
            <strong>{{ t('subscriptionDoctor.qualitySignals') }}</strong>
          </span>
        </header>
        <div class="quality-list">
          <div v-for="item in profileRows" :key="item.key" class="detail-row">
            <span>{{ item.label }}</span>
            <strong :class="item.tone">{{ item.value }}</strong>
          </div>
        </div>
        <div v-if="mediaRows.length" class="tag-block">
          <small>{{ t('subscriptionDoctor.mediaLabels') }}</small>
          <div class="tag-list">
            <span v-for="item in mediaRows" :key="item.key">{{ item.label }} {{ item.value }}</span>
          </div>
          <p>{{ t('subscriptionDoctor.mediaLabelsHelp') }}</p>
        </div>
        <div v-if="regionRows.length" class="tag-block">
          <small>{{ t('subscriptionDoctor.regionLabels') }}</small>
          <div class="tag-list">
            <span v-for="item in regionRows" :key="item.key">{{ item.label }} {{ item.value }}</span>
          </div>
        </div>
      </section>

      <section class="result-section">
        <header class="section-heading">
          <span>
            <small>{{ t('subscriptionDoctor.activeChecks') }}</small>
            <strong>{{ t('subscriptionDoctor.networkCapability') }}</strong>
          </span>
        </header>
        <div class="network-check-list">
          <div v-for="item in networkRows" :key="item.key" class="network-check-row">
            <span class="network-check-icon"><font-awesome-icon :icon="item.icon" /></span>
            <span>
              <strong>{{ item.label }}</strong>
              <small>{{ networkStateLabel(item.state) }}</small>
            </span>
            <b :class="item.state">{{ t(`subscriptionDoctor.networkStates.${item.state}`) }}</b>
          </div>
        </div>
        <p v-if="report.networkChecks.state === 'unsupported'" class="capability-note">
          <font-awesome-icon icon="fa-solid fa-circle-info" />
          {{ t('subscriptionDoctor.networkUnsupportedHelp') }}
        </p>
      </section>

      <section class="result-section source-details">
        <header class="section-heading">
          <span>
            <small>{{ t('subscriptionDoctor.sourceDetails') }}</small>
            <strong>{{ t('subscriptionDoctor.protocolsAndChanges') }}</strong>
          </span>
        </header>
        <div class="detail-columns">
          <div>
            <div v-for="[protocol, count] in protocolRows" :key="protocol" class="detail-row">
              <span>{{ protocol }}</span><strong>{{ count }}</strong>
            </div>
          </div>
          <div>
            <template v-if="report.diff">
              <div v-for="key in countKeys" :key="key" class="detail-row">
                <span>{{ t(`subscriptionDoctor.${countLabel[key]}`) }}</span>
                <strong :class="deltaTone(key, report.diff.counts[key])">{{ delta(report.diff.counts[key]) }}</strong>
              </div>
            </template>
            <p v-else class="first-report">{{ t('subscriptionDoctor.noChanges') }}</p>
          </div>
        </div>
      </section>

      <div class="export-actions">
        <nut-button plain @click="download('markdown')">{{ t('subscriptionDoctor.exportMarkdown') }}</nut-button>
        <nut-button plain @click="copy('markdown')">{{ t('subscriptionDoctor.copyMarkdown') }}</nut-button>
      </div>
    </template>
  </main>
</template>

<script setup lang="ts">
import {
  computed,
  onMounted,
  ref,
  Toast,
  useRoute,
} from '@/extensions/frontend-sdk-v1';
import { useSubscriptionDoctorI18n } from '../i18n';
import { useSubscriptionDoctorStore } from '../store';

const { t } = useSubscriptionDoctorI18n();
const route = useRoute();
const store = useSubscriptionDoctorStore();
const report = ref<SubscriptionDoctorReport | null>(null);
const loading = ref(true);
const countKeys = ['total', 'invalid', 'duplicate', 'duplicateName'] as const;
const countLabel = {
  total: 'nodes',
  invalid: 'invalid',
  duplicate: 'duplicates',
  duplicateName: 'duplicateNames',
} as const;
const translatedIssueCodes = new Set([
  'SUBSCRIPTION_EMPTY',
  'NODE_PROTOCOL_MISSING',
  'NODE_SERVER_MISSING',
  'NODE_SERVER_INVALID',
  'NODE_PORT_MISSING',
  'NODE_PORT_INVALID',
  'NODE_REQUIRED_FIELD_MISSING',
  'NODE_NAME_MISSING',
  'NODE_EXACT_DUPLICATE',
  'NODE_NAME_DUPLICATE',
  'NODE_COUNT_DROPPED',
  'NODE_TLS_VERIFY_DISABLED',
  'NODE_TLS_SERVER_NAME_MISSING',
  'NODE_PRIVATE_ENDPOINT',
  'NODE_PLAINTEXT_PROXY',
  'NODE_LEGACY_CIPHER',
  'NODE_ENDPOINT_SHARED',
]);
const targetLabels = {
  surge: 'Surge',
  qx: 'Quantumult X',
  clash: 'Clash',
  loon: 'Loon',
} as const;
const qualityDefinitions = [
  ['uniqueServers', 'uniqueServers', 'neutral'],
  ['uniqueEndpoints', 'uniqueEndpoints', 'neutral'],
  ['sharedEndpoint', 'sharedEndpoint', 'neutral'],
  ['privateEndpoint', 'privateEndpoint', 'neutral'],
  ['tlsVerificationDisabled', 'tlsVerificationDisabled', 'warning'],
  ['tlsServerNameMissing', 'tlsServerNameMissing', 'warning'],
  ['plaintextProxy', 'plaintextProxy', 'warning'],
  ['legacyCipher', 'legacyCipher', 'warning'],
  ['unknownProtocol', 'unknownProtocol', 'warning'],
] as const;
const mediaNames: Record<string, string> = {
  disney: 'Disney+',
  netflix: 'Netflix',
  openai: 'OpenAI',
  primeVideo: 'Prime Video',
  spotify: 'Spotify',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

const reportId = computed(() => decodeURIComponent(`${route.params.id || ''}`));
const statusIcon = computed(() => report.value?.status === 'healthy'
  ? 'fa-solid fa-circle-check'
  : report.value?.status === 'warning'
    ? 'fa-solid fa-triangle-exclamation'
    : 'fa-solid fa-circle-xmark');
const overviewItems = computed(() => report.value ? [
  { key: 'total', label: t('subscriptionDoctor.nodes'), value: report.value.counts.total },
  { key: 'invalid', label: t('subscriptionDoctor.invalid'), value: report.value.counts.invalid },
  { key: 'duplicate', label: t('subscriptionDoctor.duplicates'), value: report.value.counts.duplicate },
  { key: 'duplicateName', label: t('subscriptionDoctor.duplicateNames'), value: report.value.counts.duplicateName },
] : []);
const findings = computed<SubscriptionDoctorDiagnostic[]>(() => {
  if (!report.value) return [];
  const items = [...report.value.diagnostics];
  const totalDelta = report.value.diff?.counts.total || 0;
  if (totalDelta < 0) {
    items.push({
      code: 'NODE_COUNT_DROPPED',
      severity: 'warning',
      count: Math.abs(totalDelta),
      message: 'Node count decreased since the previous report',
    });
  }
  return items.sort((left, right) => {
    const rank = { error: 0, warning: 1, info: 2 };
    return rank[left.severity] - rank[right.severity] || left.code.localeCompare(right.code);
  });
});
const compatibilityRows = computed(() => report.value
  ? (Object.keys(targetLabels) as Array<keyof typeof targetLabels>).map(key => ({
      key,
      label: targetLabels[key],
      counts: report.value!.targets[key],
    }))
  : []);
const profileRows = computed(() => {
  if (!report.value) return [];
  return qualityDefinitions.map(([key, labelKey, tone]) => ({
    key,
    label: t(`subscriptionDoctor.quality.${labelKey}`),
    value: key === 'uniqueServers' || key === 'uniqueEndpoints'
      ? report.value!.profile[key]
      : report.value!.quality[key],
    tone: tone === 'warning' && report.value!.quality[key as keyof SubscriptionDoctorReport['quality']] > 0
      ? 'warning'
      : 'neutral',
  }));
});
const mediaRows = computed(() => Object.entries(report.value?.profile.media || {}).map(([key, value]) => ({
  key,
  label: mediaNames[key] || key,
  value,
})));
const regionRows = computed(() => Object.entries(report.value?.profile.regions || {}).map(([key, value]) => ({
  key,
  label: key.toUpperCase(),
  value,
})));
const networkRows = computed(() => report.value ? [
  {
    key: 'connectivity',
    label: t('subscriptionDoctor.connectivityCheck'),
    state: report.value.networkChecks.features.connectivity,
    icon: 'fa-solid fa-server',
  },
  {
    key: 'streaming',
    label: t('subscriptionDoctor.streamingCheck'),
    state: report.value.networkChecks.features.streaming,
    icon: 'fa-solid fa-eye',
  },
  {
    key: 'egress',
    label: t('subscriptionDoctor.egressCheck'),
    state: report.value.networkChecks.features.egress,
    icon: 'fa-solid fa-location-arrow',
  },
] : []);
const protocolRows = computed(() => Object.entries(report.value?.protocols || {})
  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));

const issueTitle = (item: SubscriptionDoctorDiagnostic) => translatedIssueCodes.has(item.code)
  ? t(`subscriptionDoctor.issues.${item.code}.title`)
  : item.message || item.code;
const findingMeta = (item: SubscriptionDoctorDiagnostic) => [
  t(`subscriptionDoctor.${item.severity}`),
  item.path,
].filter(Boolean).join(' · ');
const severityIcon = (severity: SubscriptionDoctorDiagnostic['severity']) => severity === 'error'
  ? 'fa-solid fa-circle-xmark'
  : severity === 'warning'
    ? 'fa-solid fa-triangle-exclamation'
    : 'fa-solid fa-circle-info';
const networkStateLabel = (state: string) => state === 'unsupported'
  ? t('subscriptionDoctor.networkUnsupportedShort')
  : state === 'not-run'
    ? t('subscriptionDoctor.networkNotRunShort')
    : t('subscriptionDoctor.networkResultAvailable');
const formatDate = (value: number) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));
const delta = (value: number) => value > 0 ? `+${value}` : `${value}`;
const deltaTone = (key: typeof countKeys[number], value: number) => key === 'total'
  ? 'neutral'
  : value > 0
    ? 'bad'
    : value < 0
      ? 'good'
      : 'neutral';

const load = async () => {
  loading.value = true;
  report.value = await store.getReport(reportId.value);
  loading.value = false;
};
const download = async (format: 'json' | 'markdown') => {
  if (!report.value) return;
  const text = await store.exportText(report.value.id, format);
  if (!text) {
    Toast.fail(t('subscriptionDoctor.exportFailed'));
    return;
  }
  const url = URL.createObjectURL(new Blob([text], {
    type: format === 'json' ? 'application/json' : 'text/markdown',
  }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `subscription-health-${report.value.id}.${format === 'json' ? 'json' : 'md'}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
const copy = async (format: 'json' | 'markdown') => {
  if (!report.value) return;
  const text = await store.exportText(report.value.id, format);
  if (!text) {
    Toast.fail(t('subscriptionDoctor.copyFailed'));
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    Toast.success(t('subscriptionDoctor.copied'));
  } catch {
    Toast.fail(t('subscriptionDoctor.copyFailed'));
  }
};

onMounted(load);
</script>

<style scoped>
.result-page {
  width: calc(100% - 24px);
  max-width: 900px;
  margin: 0 auto;
  padding: 6px 0 72px;
  color: var(--primary-text-color);
  overflow-x: hidden;
  overflow-x: clip;
}

.report-header-card {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-radius: var(--item-card-radios);
  padding: 14px 16px;
  background: var(--card-color);
}

.report-identity {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 12px;
}

.report-avatar {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  place-items: center;
  border-radius: 13px;
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

.report-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.report-title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.report-title-row strong {
  min-width: 0;
  overflow: hidden;
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.report-copy > span:not(.report-title-row),
.report-copy > small {
  color: var(--comment-text-color);
  font-size: 10px;
}

.status-chip {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 2px 7px;
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

.header-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

.header-actions button {
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

.overview-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 12px;
  overflow: hidden;
  border-radius: var(--item-card-radios);
  background: var(--card-color);
}

.overview-cell {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 13px 14px;
}

.overview-cell + .overview-cell {
  border-left: 1px solid var(--divider-color);
}

.overview-cell small {
  color: var(--comment-text-color);
  font-size: 10px;
}

.overview-cell strong {
  font-size: 16px;
}

.result-section {
  overflow: hidden;
  margin-top: 12px;
  border-radius: var(--item-card-radios);
  background: var(--card-color);
}

.section-heading {
  display: flex;
  min-height: 54px;
  align-items: center;
  padding: 0 15px;
  border-bottom: 1px solid var(--divider-color);
}

.section-heading > span {
  display: grid;
  gap: 2px;
}

.section-heading small {
  color: var(--comment-text-color);
  font-size: 9px;
}

.section-heading strong {
  font-size: 13px;
}

.finding-list,
.compatibility-list,
.quality-list,
.network-check-list {
  display: grid;
}

.finding-row,
.compatibility-row,
.detail-row,
.network-check-row {
  min-height: 44px;
  border-bottom: 1px solid var(--divider-color);
}

.finding-row:last-child,
.compatibility-row:last-child,
.detail-row:last-child,
.network-check-row:last-child {
  border-bottom: 0;
}

.finding-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
}

.finding-icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  place-items: center;
  border-radius: 9px;
  background: color-mix(in srgb, var(--comment-text-color) 8%, transparent);
  color: var(--comment-text-color);
  font-size: 12px;
}

.finding-icon.warning {
  background: color-mix(in srgb, #f59f00 10%, transparent);
  color: #b76d00;
}

.finding-icon.error {
  background: color-mix(in srgb, var(--danger-color, #e5484d) 9%, transparent);
  color: var(--danger-color, #e5484d);
}

.finding-copy {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 3px;
}

.finding-copy strong {
  font-size: 11px;
}

.finding-copy small,
.finding-row > b {
  color: var(--comment-text-color);
  font-size: 9px;
  font-weight: 500;
}

.clear-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 15px;
  color: var(--succeed-color, #2fb344);
}

.clear-row span {
  display: grid;
  gap: 3px;
  color: var(--primary-text-color);
}

.clear-row strong {
  font-size: 11px;
}

.clear-row small {
  color: var(--comment-text-color);
  font-size: 9px;
}

.compatibility-row,
.detail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 15px;
}

.client-name,
.detail-row span {
  font-size: 11px;
}

.compatibility-counts {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 5px;
}

.compatibility-counts small,
.tag-list span {
  border-radius: 999px;
  padding: 3px 7px;
  background: var(--background-color);
  color: var(--comment-text-color);
  font-size: 9px;
}

.compatibility-counts .exact {
  color: var(--succeed-color, #2fb344);
}

.compatibility-counts .fallback {
  color: #b76d00;
}

.compatibility-counts .filtered,
.compatibility-counts .unknown {
  color: var(--danger-color, #e5484d);
}

.detail-row strong {
  color: var(--comment-text-color);
  font-size: 11px;
}

.detail-row strong.warning,
.detail-row strong.bad {
  color: var(--danger-color, #e5484d);
}

.detail-row strong.good {
  color: var(--succeed-color, #2fb344);
}

.tag-block {
  border-top: 1px solid var(--divider-color);
  padding: 11px 15px;
}

.tag-block > small {
  color: var(--comment-text-color);
  font-size: 9px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.tag-block p {
  margin: 8px 0 0;
  color: var(--comment-text-color);
  font-size: 9px;
  line-height: 1.5;
}

.network-check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
}

.network-check-icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  place-items: center;
  border-radius: 9px;
  background: var(--background-color);
  color: var(--primary-color);
  font-size: 12px;
}

.network-check-row > span:nth-child(2) {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 2px;
}

.network-check-row strong {
  font-size: 11px;
}

.network-check-row small,
.network-check-row b {
  color: var(--comment-text-color);
  font-size: 9px;
  font-weight: 500;
}

.network-check-row b.complete {
  color: var(--succeed-color, #2fb344);
}

.network-check-row b.partial {
  color: #b76d00;
}

.capability-note {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 0;
  border-top: 1px solid var(--divider-color);
  padding: 10px 15px;
  color: var(--comment-text-color);
  font-size: 9px;
  line-height: 1.55;
}

.capability-note svg {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--primary-color);
}

.detail-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.detail-columns > div + div {
  border-left: 1px solid var(--divider-color);
}

.first-report {
  margin: 0;
  padding: 14px 15px;
  color: var(--comment-text-color);
  font-size: 10px;
}

.export-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.state-panel {
  display: grid;
  min-height: 45vh;
  place-items: center;
  align-content: center;
  gap: 12px;
  color: var(--comment-text-color);
}

.state-panel.error {
  color: var(--danger-color, #e5484d);
  font-size: 26px;
}

.state-panel p {
  margin: 0;
  font-size: 12px;
}

.spinner {
  width: 26px;
  height: 26px;
  border: 3px solid var(--divider-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin .8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 700px) {
  .overview-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .overview-cell:nth-child(3) {
    border-top: 1px solid var(--divider-color);
    border-left: 0;
  }

  .overview-cell:nth-child(4) {
    border-top: 1px solid var(--divider-color);
  }

  .detail-columns {
    grid-template-columns: 1fr;
  }

  .detail-columns > div + div {
    border-top: 1px solid var(--divider-color);
    border-left: 0;
  }
}

@media (max-width: 480px) {
  .result-page {
    width: calc(100% - 20px);
  }

  .report-header-card {
    align-items: flex-start;
  }

  .header-actions {
    flex-direction: column;
  }

  .compatibility-row {
    align-items: flex-start;
    flex-direction: column;
    padding-top: 10px;
    padding-bottom: 10px;
  }

  .compatibility-counts {
    justify-content: flex-start;
  }
}
</style>
