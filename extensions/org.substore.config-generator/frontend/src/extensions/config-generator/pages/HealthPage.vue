<template>
  <main class="health-page" :style="{ paddingBottom: `${bottomSafeArea + 72}px` }">
    <section class="health-workspace" :aria-busy="loading">
      <div v-if="loading && !report" class="state-panel">
        <span class="spinner" aria-hidden="true" />
        <h2>{{ t('configGenerator.health.running') }}</h2>
        <p>{{ t('configGenerator.health.runningDescription') }}</p>
      </div>

      <div v-else-if="!report" class="state-panel error" role="alert">
        <span class="state-icon"><font-awesome-icon icon="fa-solid fa-circle-xmark" /></span>
        <h2>{{ errorTitle }}</h2>
        <p>{{ errorDescription }}</p>
        <nut-button type="primary" @click="load">
          <font-awesome-icon icon="fa-solid fa-arrow-rotate-right" />
          {{ t('configGenerator.health.retry') }}
        </nut-button>
      </div>

      <template v-else>
        <section class="report-header-card">
          <div class="report-identity">
            <span class="report-avatar" :class="report.status">
              <font-awesome-icon :icon="statusIcon(report.status)" />
            </span>
            <span class="report-copy">
              <span class="report-title-row">
                <strong>{{ report.project.displayName || report.project.name }}</strong>
                <small class="status-chip" :class="report.status">
                  {{ t(`configGenerator.health.status.${report.status}`) }}
                </small>
              </span>
              <span>{{ t('configGenerator.health.description') }}</span>
              <small>
                {{ t('configGenerator.health.checkedAt', { time: formatDate(report.checkedAt) }) }}
              </small>
            </span>
          </div>
          <div class="header-actions">
            <button
              type="button"
              :title="t('configGenerator.health.editProject')"
              :aria-label="t('configGenerator.health.editProject')"
              @click="editProject()"
            >
              <font-awesome-icon icon="fa-solid fa-pen-nib" />
            </button>
            <button
              type="button"
              :title="t('configGenerator.health.rerun')"
              :aria-label="t('configGenerator.health.rerun')"
              :disabled="loading"
              @click="load"
            >
              <font-awesome-icon icon="fa-solid fa-arrow-rotate-right" />
            </button>
          </div>
        </section>

        <section class="summary-grid" :aria-label="t('configGenerator.health.summary.title')">
          <article v-for="item in summaryItems" :key="item.key" class="summary-card" :class="item.key">
            <span class="summary-icon"><font-awesome-icon :icon="item.icon" /></span>
            <span>
              <small>{{ item.label }}</small>
              <strong>{{ item.value }}</strong>
            </span>
          </article>
        </section>

        <section class="target-section">
          <header class="section-heading">
            <span>
              <small>{{ t('configGenerator.health.targetsEyebrow') }}</small>
              <strong>{{ t('configGenerator.health.targetsTitle') }}</strong>
            </span>
          </header>
          <div class="target-switch" role="tablist" :aria-label="t('configGenerator.health.targetFilter')">
            <button
              type="button"
              class="target-option all-targets"
              :class="{ active: selectedTarget === 'all' }"
              role="tab"
              :aria-selected="selectedTarget === 'all'"
              @click="selectTarget('all')"
            >
              <span class="target-icon"><font-awesome-icon icon="fa-solid fa-layer-group" /></span>
              <span>
                <strong>{{ t('configGenerator.health.allTargets') }}</strong>
                <small>{{ report.counts.error + report.counts.warning }}</small>
              </span>
            </button>
            <button
              v-for="option in targetOptions"
              :key="option.target"
              type="button"
              class="target-option"
              :class="[option.report.status, { active: selectedTarget === option.target }]"
              role="tab"
              :aria-selected="selectedTarget === option.target"
              @click="selectTarget(option.target)"
            >
              <img class="target-icon image" :src="option.icon" alt="" aria-hidden="true">
              <span>
                <strong>{{ option.shortName }}</strong>
                <small>{{ targetCountLabel(option.report) }}</small>
              </span>
            </button>
          </div>
        </section>

        <section class="findings-section">
          <header class="section-heading">
            <span>
              <small>{{ t('configGenerator.health.findingsEyebrow') }}</small>
              <strong>{{ t('configGenerator.health.findingCount', { count: filteredDiagnostics.length }) }}</strong>
            </span>
            <small class="filter-label">{{ selectedTargetLabel }}</small>
          </header>

          <div v-if="filteredDiagnostics.length" class="finding-list">
            <article v-for="item in filteredDiagnostics" :key="item.id" class="finding-card" :class="item.severity">
              <div class="finding-heading">
                <span class="finding-icon" :class="item.severity">
                  <font-awesome-icon :icon="severityIcon(item.severity)" />
                </span>
                <span class="finding-title">
                  <strong>{{ issueTitle(item) }}</strong>
                  <small>{{ findingMeta(item) }}</small>
                </span>
                <span class="severity-chip" :class="item.severity">
                  {{ t(`configGenerator.health.severity.${item.severity}`) }}
                </span>
              </div>

              <p class="finding-message">{{ issueMessage(item) }}</p>

              <dl v-if="item.location || item.path" class="finding-location">
                <dt>{{ t('configGenerator.health.location') }}</dt>
                <dd :title="item.path">{{ diagnosticLocationLabel(item) }}</dd>
              </dl>

              <div class="suggestion-box">
                <span><font-awesome-icon icon="fa-solid fa-screwdriver-wrench" /></span>
                <div>
                  <strong>{{ t('configGenerator.health.suggestion') }}</strong>
                  <p>{{ issueSuggestion(item) }}</p>
                </div>
              </div>

              <details v-if="item.path || item.message" class="technical-details">
                <summary>{{ t('configGenerator.health.technicalDetails') }}</summary>
                <dl>
                  <template v-if="item.path">
                    <dt>{{ t('configGenerator.health.technicalPath') }}</dt>
                    <dd>{{ item.path }}</dd>
                  </template>
                  <template v-if="item.message">
                    <dt>{{ t('configGenerator.health.technicalMessage') }}</dt>
                    <dd>{{ item.message }}</dd>
                  </template>
                </dl>
              </details>

              <div class="finding-actions">
                <button type="button" @click="editProject(item)">
                  <font-awesome-icon icon="fa-solid fa-pen-nib" />
                  {{ t('configGenerator.health.edit') }}
                </button>
                <button v-if="item.target" type="button" @click="previewTarget(item.target)">
                  <font-awesome-icon icon="fa-solid fa-eye" />
                  {{ t('configGenerator.health.preview') }}
                </button>
              </div>
            </article>
          </div>

          <div v-else class="all-clear-panel">
            <span><font-awesome-icon icon="fa-solid fa-circle-check" /></span>
            <div>
              <strong>{{ t('configGenerator.health.allClearTitle') }}</strong>
              <p>{{ t('configGenerator.health.allClearDescription') }}</p>
            </div>
          </div>
        </section>

        <section class="coverage-section">
          <header class="section-heading">
            <span>
              <small>{{ t('configGenerator.health.coverage.eyebrow') }}</small>
              <strong>{{ t('configGenerator.health.coverage.title') }}</strong>
            </span>
          </header>
          <p>{{ t('configGenerator.health.coverage.description') }}</p>
          <div class="coverage-tags">
            <span v-for="item in report.coverage.notChecked" :key="item">
              {{ coverageLabel(item) }}
            </span>
          </div>
        </section>
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import {
  computed,
  onMounted,
  ref,
  storeToRefs,
  useGlobalStore,
  useRoute,
  useRouter,
} from '@/extensions/frontend-sdk-v1';
import { useConfigGeneratorI18n } from '@/extensions/config-generator/i18n';
import { useConfigGeneratorStore } from '@/extensions/config-generator/store';
import {
  CONFIG_GENERATOR_TARGET_DEFINITIONS,
  CONFIG_GENERATOR_TARGET_REGISTRY,
  isConfigGeneratorTarget,
} from '@/extensions/config-generator/domain/targets';

type HealthTargetFilter = 'all' | ConfigGeneratorTarget;

const knownIssueCodes = new Set([
  'PROJECT_INVALID',
  'POLICY_REFERENCE_INVALID',
  'POLICY_GROUP_UNSUPPORTED',
  'POLICY_GROUP_FALLBACK',
  'POLICY_GROUP_EMPTY',
  'POLICY_GROUP_CYCLE',
  'POLICY_REGEX_INVALID',
  'REMOTE_SOURCE_INVALID',
  'REMOTE_SOURCE_FALLBACK',
  'RULE_SET_INVALID',
  'RULE_SET_FALLBACK',
  'RULES_INCOMPLETE',
  'DUPLICATE_ENTRY',
  'UNUSED_ENTRY',
  'INDEPENDENT_CONFIG_INVALID',
  'TARGET_OPTION_OMITTED',
  'TARGET_DIAGNOSTIC',
]);
const coverageKeys: Record<string, string> = {
  'embedded-source-output': 'embeddedSourceOutput',
  'remote-url-reachability': 'remoteUrlReachability',
  'remote-rule-content': 'remoteRuleContent',
  'resource-output-content': 'resourceOutputContent',
  'response-transformers': 'responseTransformers',
  'node-connectivity': 'nodeConnectivity',
};
const healthFieldKeys: Record<string, string> = {
  name: 'name',
  displayName: 'displayName',
  remark: 'remark',
  kind: 'kind',
  type: 'type',
  value: 'value',
  text: 'comment',
  policy: 'policy',
  ruleSet: 'ruleSet',
  members: 'members',
  includeOtherGroups: 'includeOtherGroups',
  nodeNameRegex: 'nodeNameRegex',
  remoteProxySource: 'remoteProxySource',
  testUrl: 'testUrl',
  interval: 'interval',
  tolerance: 'tolerance',
  timeout: 'timeout',
  policyUpdateInterval: 'policyUpdateInterval',
  iconUrl: 'iconUrl',
  hidden: 'hidden',
  noAlert: 'noAlert',
  evaluateBeforeUse: 'evaluateBeforeUse',
  persistent: 'persistent',
  aliveChecking: 'aliveChecking',
  resourceTagRegex: 'resourceTagRegex',
  noResolve: 'noResolve',
  dnsFailed: 'dnsFailed',
  independentConfig: 'independentConfig',
  publicBaseUrl: 'publicBaseUrl',
  'delivery.publicBaseUrl': 'publicBaseUrl',
  source: 'source',
  'source.kind': 'sourceType',
  'source.url': 'sourceUrl',
  'source.target': 'sourceTarget',
  'source.ref': 'resourceReference',
  enabled: 'enabled',
  updateInterval: 'updateInterval',
  targetOptions: 'targetOptions',
  outputs: 'outputs',
  args: 'transformerArgs',
  id: 'transformerId',
};
const severityRank = { error: 0, warning: 1, info: 2 } as const;

const { t } = useConfigGeneratorI18n();
const route = useRoute();
const router = useRouter();
const configStore = useConfigGeneratorStore();
const globalStore = useGlobalStore();
const { bottomSafeArea } = storeToRefs(globalStore);
const projectName = String(route.params.name || '');
const routeTarget = Array.isArray(route.query.target) ? route.query.target[0] : route.query.target;
const selectedTarget = ref<HealthTargetFilter>(isConfigGeneratorTarget(routeTarget) ? routeTarget : 'all');
const report = ref<ConfigGeneratorHealthReport | null>(null);
const loading = ref(true);
const error = ref('');

const targetOptions = computed(() => {
  const currentReport = report.value;
  if (!currentReport) return [];
  return CONFIG_GENERATOR_TARGET_DEFINITIONS.map((definition) => ({
    ...definition,
    report: currentReport.targets[definition.target],
  }));
});
const filteredDiagnostics = computed(() => (report.value?.diagnostics || [])
  .filter(item => selectedTarget.value === 'all' || !item.target || item.target === selectedTarget.value)
  .sort((left, right) => severityRank[left.severity] - severityRank[right.severity]
    || String(left.target || '').localeCompare(String(right.target || ''))
    || left.code.localeCompare(right.code)
    || String(left.path || '').localeCompare(String(right.path || ''))));
const healthyTargetCount = computed(() => report.value
  ? Object.values(report.value.targets).filter(item => item.status === 'healthy').length
  : 0);
const summaryItems = computed(() => report.value ? [
  {
    key: 'error',
    label: t('configGenerator.health.summary.errors'),
    value: report.value.counts.error,
    icon: 'fa-solid fa-circle-xmark',
  },
  {
    key: 'warning',
    label: t('configGenerator.health.summary.warnings'),
    value: report.value.counts.warning,
    icon: 'fa-solid fa-triangle-exclamation',
  },
  {
    key: 'info',
    label: t('configGenerator.health.summary.infos'),
    value: report.value.counts.info,
    icon: 'fa-solid fa-circle-info',
  },
  {
    key: 'healthy',
    label: t('configGenerator.health.summary.healthyTargets'),
    value: `${healthyTargetCount.value}/4`,
    icon: 'fa-solid fa-circle-check',
  },
] : []);
const selectedTargetLabel = computed(() => selectedTarget.value === 'all'
  ? t('configGenerator.health.allTargets')
  : t(CONFIG_GENERATOR_TARGET_REGISTRY[selectedTarget.value].outputLabelKey));
const isNotFound = computed(() => configStore.healthErrorCode === 'CONFIG_GENERATOR_PROJECT_NOT_FOUND');
const errorTitle = computed(() => isNotFound.value
  ? t('configGenerator.health.notFound')
  : t('configGenerator.health.failed'));
const errorDescription = computed(() => isNotFound.value
  ? t('configGenerator.health.notFoundDescription')
  : t('configGenerator.health.failedDescription'));

const statusIcon = (status: ConfigGeneratorHealthStatus) => status === 'healthy'
  ? 'fa-solid fa-circle-check'
  : status === 'warning'
    ? 'fa-solid fa-triangle-exclamation'
    : 'fa-solid fa-circle-xmark';
const severityIcon = (severity: ConfigGeneratorHealthDiagnostic['severity']) => severity === 'error'
  ? 'fa-solid fa-circle-xmark'
  : severity === 'warning'
    ? 'fa-solid fa-triangle-exclamation'
    : 'fa-solid fa-circle-info';
const formatDate = (value: number) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));
const targetCountLabel = (targetReport: ConfigGeneratorHealthTargetReport) => {
  const actionable = targetReport.counts.error + targetReport.counts.warning;
  return actionable
    ? t('configGenerator.health.targetIssueCount', { count: actionable })
    : t('configGenerator.health.targetHealthy');
};
const targetLabel = (target?: ConfigGeneratorTarget) => target
  ? t(CONFIG_GENERATOR_TARGET_REGISTRY[target].outputLabelKey)
  : t('configGenerator.health.commonIssue');
const simpleFieldLabel = (field: string): string => {
  if (!field) return '';
  const targetOption = /^targetOptions\.(surge|qx|clash|loon)(?:\.(.*))?$/.exec(field);
  if (targetOption) {
    const target = targetOption[1] as ConfigGeneratorTarget;
    const nested = targetOption[2]
      ? simpleFieldLabel(targetOption[2])
      : t('configGenerator.health.fields.targetOptions');
    return t('configGenerator.health.locations.withField', {
      location: targetLabel(target),
      field: nested,
    });
  }
  const member = /^members\[(\d+)](?:\.(.*))?$/.exec(field);
  if (member) {
    const location = t('configGenerator.health.fields.member', {
      number: Number(member[1]) + 1,
    });
    return member[2]
      ? t('configGenerator.health.locations.withField', {
        location,
        field: simpleFieldLabel(member[2]),
      })
      : location;
  }
  const includedGroup = /^includeOtherGroups\[(\d+)](?:\.(.*))?$/.exec(field);
  if (includedGroup) {
    const location = t('configGenerator.health.fields.includedGroup', {
      number: Number(includedGroup[1]) + 1,
    });
    return includedGroup[2]
      ? t('configGenerator.health.locations.withField', {
        location,
        field: simpleFieldLabel(includedGroup[2]),
      })
      : location;
  }
  const subnetRule = /^subnetRules\[(\d+)](?:\.(.*))?$/.exec(field);
  if (subnetRule) {
    const location = t('configGenerator.health.fields.subnetRule', {
      number: Number(subnetRule[1]) + 1,
    });
    return subnetRule[2]
      ? t('configGenerator.health.locations.withField', {
        location,
        field: simpleFieldLabel(subnetRule[2]),
      })
      : location;
  }
  const directKey = healthFieldKeys[field];
  if (directKey) return t(`configGenerator.health.fields.${directKey}`);
  const finalSegment = field.split('.').pop() || '';
  const fallbackKey = healthFieldKeys[finalSegment];
  return fallbackKey
    ? t(`configGenerator.health.fields.${fallbackKey}`)
    : t('configGenerator.health.fields.configuration');
};
const diagnosticEntityLabel = (item: ConfigGeneratorHealthDiagnostic) => {
  const location = item.location;
  if (!location) return t('configGenerator.health.locations.configuration');
  const number = (location.index ?? 0) + 1;
  switch (location.kind) {
    case 'rule':
      return location.explicitName && location.name
        ? t('configGenerator.health.locations.ruleNamed', { name: location.name })
        : t('configGenerator.health.locations.ruleIndexed', {
          number,
          name: location.name || t('configGenerator.health.fields.configuration'),
        });
    case 'group':
      return location.name
        ? t('configGenerator.health.locations.groupNamed', { name: location.name })
        : t('configGenerator.health.locations.groupIndexed', { number });
    case 'ruleSet':
      return location.name
        ? t('configGenerator.health.locations.ruleSetNamed', { name: location.name })
        : t('configGenerator.health.locations.ruleSetIndexed', { number });
    case 'source':
      return location.name
        ? t('configGenerator.health.locations.sourceNamed', { name: location.name })
        : t('configGenerator.health.locations.sourceIndexed', { number });
    case 'output':
      return t('configGenerator.health.locations.output', {
        target: targetLabel(location.target),
      });
    case 'process':
      return location.name
        ? t('configGenerator.health.locations.processNamed', { name: location.name })
        : t('configGenerator.health.locations.processIndexed', { number });
    case 'rules':
      return t('configGenerator.health.locations.rules');
    case 'groups':
      return t('configGenerator.health.locations.groups');
    case 'ruleSets':
      return t('configGenerator.health.locations.ruleSets');
    case 'sources':
      return t('configGenerator.health.locations.sources');
    case 'outputs':
      return t('configGenerator.health.locations.outputs');
    default:
      return location.name
        ? t('configGenerator.health.locations.projectNamed', { name: location.name })
        : t('configGenerator.health.locations.project');
  }
};
const diagnosticFieldLabel = (item: ConfigGeneratorHealthDiagnostic) => {
  const location = item.location;
  if (location?.field === 'ruleSet' && location.referenceName) {
    return t('configGenerator.health.fields.ruleSetNamed', {
      name: location.referenceName,
    });
  }
  return simpleFieldLabel(location?.field || '');
};
const diagnosticLocationLabel = (item: ConfigGeneratorHealthDiagnostic) => {
  const location = diagnosticEntityLabel(item);
  const field = diagnosticFieldLabel(item);
  return field
    ? t('configGenerator.health.locations.withField', { location, field })
    : location;
};
const issueTitle = (item: ConfigGeneratorHealthDiagnostic) => knownIssueCodes.has(item.code)
  ? t(`configGenerator.health.issues.${item.code}.title`)
  : t('configGenerator.health.genericIssueTitle');
const issueMessage = (item: ConfigGeneratorHealthDiagnostic) => knownIssueCodes.has(item.code)
  ? t(`configGenerator.health.issues.${item.code}.message`, {
    target: targetLabel(item.target),
    location: diagnosticLocationLabel(item),
  })
  : t('configGenerator.health.genericDiagnosticMessage');
const issueSuggestion = (item: ConfigGeneratorHealthDiagnostic) => knownIssueCodes.has(item.code)
  ? t(`configGenerator.health.issues.${item.code}.suggestion`)
  : t('configGenerator.health.genericSuggestion');
const findingMeta = (item: ConfigGeneratorHealthDiagnostic) => [
  item.target
    ? t(CONFIG_GENERATOR_TARGET_REGISTRY[item.target].outputLabelKey)
    : t('configGenerator.health.commonIssue'),
  t(`configGenerator.health.categories.${item.category}`),
].join(' · ');
const coverageLabel = (value: string) => coverageKeys[value]
  ? t(`configGenerator.health.coverage.items.${coverageKeys[value]}`)
  : value;

const selectTarget = (value: HealthTargetFilter) => {
  selectedTarget.value = value;
  const query = { ...route.query } as Record<string, any>;
  if (value === 'all') delete query.target;
  else query.target = value;
  void router.replace({ query });
};
const editorSection = (item?: ConfigGeneratorHealthDiagnostic) => item?.fix?.section || 'subscriptions';
const editProject = (item?: ConfigGeneratorHealthDiagnostic) => {
  const target = item?.fix?.target;
  void router.push({
    path: `/extensions/config-generator/edit/${encodeURIComponent(projectName)}`,
    query: {
      section: editorSection(item),
      ...(target ? { target } : {}),
    },
  });
};
const previewTarget = (target: ConfigGeneratorTarget) => {
  void router.push({
    path: `/extensions/config-generator/preview/${encodeURIComponent(projectName)}`,
    query: { target },
  });
};
const load = async () => {
  loading.value = true;
  error.value = '';
  report.value = await configStore.getProjectHealth(projectName);
  if (!report.value) error.value = configStore.error || 'CONFIG_GENERATOR_HEALTH_FAILED';
  loading.value = false;
};

onMounted(load);
</script>

<style lang="scss" scoped>
.health-page {
  width: calc(100% - 24px);
  max-width: 900px;
  margin: 0 auto;
  padding-top: 6px;
  color: var(--primary-text-color);
}

.health-workspace {
  display: grid;
  gap: 14px;
}

.report-header-card,
.target-section,
.findings-section,
.coverage-section {
  min-width: 0;
  border-radius: var(--item-card-radios);
  background: var(--card-color);
}

.report-header-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
}

.report-identity {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 12px;
}

.report-avatar,
.finding-icon,
.summary-icon,
.state-icon,
.all-clear-panel > span {
  display: grid;
  place-items: center;
}

.report-avatar {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  border-radius: 13px;
  background: color-mix(in srgb, var(--succeed-color, #2fb344) 11%, var(--background-color));
  color: var(--succeed-color, #2fb344);
}

.report-avatar.warning {
  background: color-mix(in srgb, #f59f00 12%, var(--background-color));
  color: #b76d00;
}

.report-avatar.error {
  background: color-mix(in srgb, var(--danger-color, #e5484d) 10%, var(--background-color));
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

.status-chip,
.severity-chip {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 3px 8px;
  background: color-mix(in srgb, var(--succeed-color, #2fb344) 11%, transparent);
  color: var(--succeed-color, #2fb344);
  font-size: 9px;
}

.status-chip.warning,
.severity-chip.warning {
  background: color-mix(in srgb, #f59f00 12%, transparent);
  color: #b76d00;
}

.status-chip.error,
.severity-chip.error {
  background: color-mix(in srgb, var(--danger-color, #e5484d) 10%, transparent);
  color: var(--danger-color, #e5484d);
}

.severity-chip.info {
  background: color-mix(in srgb, var(--primary-color) 10%, transparent);
  color: var(--primary-color);
}

.header-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

.header-actions button,
.finding-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 11px;
  background: var(--background-color);
  color: var(--comment-text-color);
  cursor: pointer;
}

.header-actions button {
  width: 40px;
  height: 40px;
}

.header-actions button:disabled {
  cursor: wait;
  opacity: 0.55;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.summary-card {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  border-radius: 14px;
  padding: 11px 12px;
  background: var(--card-color);
}

.summary-icon {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  border-radius: 11px;
  background: color-mix(in srgb, var(--primary-color) 9%, var(--background-color));
  color: var(--primary-color);
}

.summary-card.error .summary-icon {
  color: var(--danger-color, #e5484d);
}

.summary-card.warning .summary-icon {
  color: #b76d00;
}

.summary-card.healthy .summary-icon {
  color: var(--succeed-color, #2fb344);
}

.summary-card > span:last-child {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.summary-card small {
  overflow: hidden;
  color: var(--comment-text-color);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-card strong {
  font-size: 17px;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 15px;
  border-bottom: 1px solid var(--divider-color);
}

.section-heading > span {
  display: grid;
  gap: 2px;
}

.section-heading small,
.filter-label {
  color: var(--comment-text-color);
  font-size: 9px;
}

.section-heading strong {
  font-size: 12px;
}

.target-switch {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  padding: 12px 14px 14px;
}

.target-option {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 9px 10px;
  background: var(--background-color);
  color: var(--primary-text-color);
  cursor: pointer;
  text-align: left;
}

.target-option.active {
  border-color: color-mix(in srgb, var(--primary-color) 45%, transparent);
  background: color-mix(in srgb, var(--primary-color) 8%, var(--background-color));
}

.target-icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border-radius: 9px;
  background: var(--card-color);
  color: var(--primary-color);
  object-fit: contain;
}

.target-icon.image {
  padding: 3px;
}

.target-option > span:last-child {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.target-option strong,
.target-option small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-option strong {
  font-size: 10px;
}

.target-option small {
  color: var(--comment-text-color);
  font-size: 8px;
}

.finding-list {
  display: grid;
  gap: 10px;
  padding: 12px 14px 14px;
}

.finding-card {
  min-width: 0;
  border: 1px solid var(--divider-color);
  border-radius: 13px;
  padding: 12px;
  background: var(--background-color);
}

.finding-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.finding-icon {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--primary-color) 9%, var(--card-color));
  color: var(--primary-color);
}

.finding-icon.warning {
  background: color-mix(in srgb, #f59f00 11%, var(--card-color));
  color: #b76d00;
}

.finding-icon.error {
  background: color-mix(in srgb, var(--danger-color, #e5484d) 9%, var(--card-color));
  color: var(--danger-color, #e5484d);
}

.finding-title {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 2px;
}

.finding-title strong {
  font-size: 12px;
}

.finding-title small {
  color: var(--comment-text-color);
  font-size: 9px;
}

.finding-message {
  margin: 10px 0 0;
  color: var(--comment-text-color);
  font-size: 10px;
  line-height: 1.55;
  word-break: break-word;
}

.finding-location {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  margin: 9px 0 0;
  font-size: 9px;
}

.finding-location dt {
  color: var(--comment-text-color);
}

.finding-location dd {
  overflow: hidden;
  margin: 0;
  color: var(--primary-text-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.technical-details {
  margin-top: 9px;
  color: var(--comment-text-color);
  font-size: 9px;
}

.technical-details summary {
  width: fit-content;
  cursor: pointer;
  user-select: none;
}

.technical-details dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 5px 8px;
  margin: 8px 0 0;
  border-radius: 10px;
  padding: 8px 9px;
  background: color-mix(in srgb, var(--comment-text-color) 5%, transparent);
}

.technical-details dt {
  color: var(--comment-text-color);
}

.technical-details dd {
  min-width: 0;
  margin: 0;
  color: var(--primary-text-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.suggestion-box {
  display: flex;
  gap: 9px;
  margin-top: 10px;
  border-radius: 11px;
  padding: 9px 10px;
  background: color-mix(in srgb, var(--primary-color) 6%, var(--card-color));
}

.suggestion-box > span {
  flex: 0 0 auto;
  color: var(--primary-color);
}

.suggestion-box strong {
  font-size: 9px;
}

.suggestion-box p {
  margin: 3px 0 0;
  color: var(--comment-text-color);
  font-size: 9px;
  line-height: 1.5;
}

.finding-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.finding-actions button {
  gap: 5px;
  padding: 7px 10px;
  font-size: 9px;
}

.all-clear-panel {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 16px;
}

.all-clear-panel > span {
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--succeed-color, #2fb344) 11%, var(--background-color));
  color: var(--succeed-color, #2fb344);
}

.all-clear-panel strong {
  font-size: 12px;
}

.all-clear-panel p,
.coverage-section > p {
  margin: 4px 0 0;
  color: var(--comment-text-color);
  font-size: 10px;
  line-height: 1.55;
}

.coverage-section > p {
  padding: 0 15px;
}

.coverage-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  padding: 11px 15px 15px;
}

.coverage-tags span {
  border-radius: 999px;
  padding: 4px 8px;
  background: var(--background-color);
  color: var(--comment-text-color);
  font-size: 8px;
}

.state-panel {
  display: grid;
  min-height: 55vh;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: var(--comment-text-color);
  text-align: center;
}

.state-panel h2,
.state-panel p {
  margin: 0;
}

.state-panel h2 {
  color: var(--primary-text-color);
  font-size: 15px;
}

.state-panel p {
  max-width: 430px;
  font-size: 11px;
  line-height: 1.6;
}

.state-panel.error .state-icon {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--danger-color, #e5484d) 10%, var(--card-color));
  color: var(--danger-color, #e5484d);
  font-size: 20px;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--divider-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: health-spin 0.8s linear infinite;
}

@keyframes health-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 720px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .target-switch {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .all-targets {
    grid-column: 1 / -1;
  }
}

@media (max-width: 480px) {
  .health-page {
    width: calc(100% - 20px);
  }

  .report-header-card {
    align-items: flex-start;
  }

  .report-copy > span:not(.report-title-row) {
    display: none;
  }

  .summary-card {
    padding: 9px 10px;
  }

  .severity-chip {
    display: none;
  }
}
</style>
