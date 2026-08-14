<template>
  <div v-if="ruleSet" class="config-generator-action-form-wrapper">
    <nut-form class="form config-generator-action-form" :model-value="context.form">
      <nut-form-item :label="$t('configGenerator.fields.ruleKind')">
        <nut-input model-value="RULE-SET" :border="false" input-align="right" class="nut-input-text" readonly />
      </nut-form-item>

      <nut-form-item>
        <template #label>
          <span class="rule-name-label">
            {{ $t('configGenerator.fields.ruleName') }}
            <button type="button" class="rule-name-tips-button" :aria-label="$t('configGenerator.ruleNameHelp')" :title="$t('configGenerator.ruleNameHelp')" @click.stop="openRuleNameTips">
              <font-awesome-icon icon="fa-solid fa-circle-question" />
            </button>
          </span>
        </template>
        <nut-input v-model.trim="ruleBindingName" :border="false" input-align="right" class="nut-input-text" :placeholder="$t('configGenerator.placeholders.ruleName')" />
      </nut-form-item>

      <nut-form-item :label="$t('configGenerator.ruleSource')">
        <nut-input
          :model-value="sourceLabel"
          :border="false"
          input-align="right"
          class="nut-input-text picker-input"
          readonly
          right-icon="rect-right"
          :placeholder="$t('configGenerator.selectRuleSource')"
          @click="sourcePickerVisible = true"
          @click-right-icon="sourcePickerVisible = true"
        />
      </nut-form-item>

      <nut-form-item v-if="ruleSet.source.kind === 'url'" :label="$t('configGenerator.fields.ruleSetUrl')">
        <nut-input v-model.trim="ruleSetUrl" :border="false" input-align="right" class="nut-input-text" :placeholder="$t('configGenerator.placeholders.ruleSetUrl')" />
      </nut-form-item>

      <nut-form-item v-if="ruleSet.source.kind === 'url'" :label="$t('configGenerator.fields.ruleSetTarget')">
        <div class="radio-wrapper">
          <nut-radiogroup v-model="ruleSetTarget" direction="horizontal">
            <nut-radio v-for="target in CONFIG_GENERATOR_TARGET_DEFINITIONS" :key="target.target" shape="button" :label="target.target">
              <span class="rule-target-content"><img :src="target.icon" alt="" aria-hidden="true"><span>{{ target.displayName }}</span></span>
            </nut-radio>
          </nut-radiogroup>
        </div>
      </nut-form-item>

      <nut-form-item v-else-if="ruleSet.source.kind === 'builtin'" :label="$t('configGenerator.fields.builtinRuleSet')">
        <nut-input :model-value="ruleSet.source.value" :border="false" input-align="right" class="nut-input-text" readonly />
      </nut-form-item>

      <nut-form-item v-else :label="$t('configGenerator.resourceStatus')">
        <span class="resource-status" :class="resourceAvailability">{{ resourceStatusLabel }}</span>
      </nut-form-item>

      <nut-form-item :label="$t('configGenerator.fields.policy')">
        <div class="radio-wrapper">
          <nut-radiogroup :model-value="remoteRule?.policy || 'DIRECT'" direction="horizontal" @update:model-value="updatePolicy">
            <nut-radio v-for="policy in policyOptions" :key="policy" shape="button" :label="policy">{{ policy }}</nut-radio>
          </nut-radiogroup>
        </div>
      </nut-form-item>
    </nut-form>

    <nut-picker
      v-model:visible="sourcePickerVisible"
      v-model="sourceModel"
      :columns="sourceOptions"
      @confirm="confirmSource"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, Dialog, inject, ref } from '@/extensions/frontend-sdk-v1';
import { useConfigGeneratorI18n } from '@/extensions/config-generator/i18n';
import { CONFIG_GENERATOR_TARGET_DEFINITIONS, DEFAULT_CONFIG_GENERATOR_TARGET } from '@/extensions/config-generator/domain/targets';
import { getRemoteRuleBindingName, setRemoteRuleBindingName } from '@/extensions/config-generator/domain/ruleBindingPresentation';

const { id } = defineProps<{ id: string }>();
const context = inject<any>('configGeneratorActionContext');
const { t } = useConfigGeneratorI18n();
const sourcePickerVisible = ref(false);
const sourceModel = ref<string[]>([]);

const ruleSet = computed<RemoteRuleSet | undefined>(() => context?.ruleSetByActionId?.(id));
const remoteRule = computed(() => {
  const rule = context?.ruleByActionId?.(id);
  return rule?.kind === 'remote' ? rule : undefined;
});
const descriptors = computed<ResourceDescriptorV1[]>(() => context?.resourceRuleSets?.value || context?.resourceRuleSets || []);
const currentDescriptor = computed(() => {
  if (ruleSet.value?.source.kind !== 'resource') return undefined;
  const ref = ruleSet.value.source.ref;
  return descriptors.value.find(item => item.ref.providerId === ref.providerId
    && item.ref.providerContributionId === ref.providerContributionId
    && item.ref.type === ref.type
    && item.ref.id === ref.id
    && item.ref.contract === ref.contract);
});
const resourceAvailability = computed(() => currentDescriptor.value?.availability?.status || 'missing');
const resourceStatusLabel = computed(() => t(`configGenerator.resourceStatuses.${resourceAvailability.value}`));
const sourceLabel = computed(() => {
  const source = ruleSet.value?.source;
  if (!source) return '';
  if (source.kind === 'url') return t('configGenerator.ruleSourceUrl');
  if (source.kind === 'builtin') return source.value;
  return currentDescriptor.value?.displayName || currentDescriptor.value?.name || source.lastKnownName || source.ref.id;
});
const sourceOptions = computed(() => {
  const pluginGroups = new Map<string, { value: string; text: string; children: Array<{ value: string; text: string }> }>();
  descriptors.value
    .filter(item => item.ref.contract === 'substore.rule-set@1'
      && item.lifecycle?.state === 'active'
      && item.availability?.status === 'available')
    .forEach((item) => {
      const groupKey = item.ref.providerContributionId;
      const group = pluginGroups.get(groupKey) || {
        value: `resource:${groupKey}`,
        text: item.metadata?.providerName ? String(item.metadata.providerName) : item.ref.providerId,
        children: [],
      };
      group.children.push({
        value: JSON.stringify(item.ref),
        text: item.displayName || item.name,
      });
      pluginGroups.set(groupKey, group);
    });
  return [
    {
      value: 'local',
      text: t('configGenerator.localRuleSources'),
      children: [
        { value: 'url', text: t('configGenerator.ruleSourceUrl') },
        { value: 'SYSTEM', text: 'SYSTEM' },
        { value: 'LAN', text: 'LAN' },
      ],
    },
    ...pluginGroups.values(),
  ];
});
const ruleBindingName = computed({
  get: () => getRemoteRuleBindingName(remoteRule.value),
  set: (value: string) => remoteRule.value && setRemoteRuleBindingName(remoteRule.value, value),
});
const ruleSetUrl = computed({
  get: () => ruleSet.value?.source.kind === 'url' ? ruleSet.value.source.url : '',
  set: (value: string) => {
    if (ruleSet.value?.source.kind === 'url') ruleSet.value.source.url = value;
  },
});
const ruleSetTarget = computed<ConfigGeneratorTarget>({
  get: () => ruleSet.value?.source.kind === 'url' ? ruleSet.value.source.target || DEFAULT_CONFIG_GENERATOR_TARGET : DEFAULT_CONFIG_GENERATOR_TARGET,
  set: value => {
    if (ruleSet.value?.source.kind === 'url') ruleSet.value.source.target = value;
  },
});
const policyOptions = computed(() => ['DIRECT', 'REJECT', ...(context?.form?.groups || []).map((group: any) => group.name).filter(Boolean)]);

const confirmSource = ({ selectedValue }: any) => {
  const value = selectedValue || sourceModel.value;
  if (!ruleSet.value || !value?.[1]) return;
  if (value[0] === 'local') {
    ruleSet.value.source = value[1] === 'url'
      ? { kind: 'url', url: '', target: DEFAULT_CONFIG_GENERATOR_TARGET }
      : { kind: 'builtin', value: value[1] as 'SYSTEM' | 'LAN' };
    return;
  }
  const ref = JSON.parse(value[1]) as ResourceRefV1;
  const descriptor = descriptors.value.find(item => item.ref.providerId === ref.providerId
    && item.ref.providerContributionId === ref.providerContributionId
    && item.ref.type === ref.type
    && item.ref.id === ref.id
    && item.ref.contract === ref.contract);
  ruleSet.value.source = {
    kind: 'resource',
    ref,
    expectedContract: 'substore.rule-set@1',
    lastKnownName: descriptor?.displayName || descriptor?.name || ref.id,
  };
  if (!ruleSet.value.name.trim()) ruleSet.value.name = `resource-${Date.now()}`;
  context?.ensureResourceDeliveryUrl?.();
};
const updatePolicy = (policy: string) => {
  const index = context?.form?.rules?.indexOf(remoteRule.value) ?? -1;
  if (index >= 0) context?.updateRulePolicy?.(index, policy);
};
const openRuleNameTips = () => Dialog({
  title: t('configGenerator.fields.ruleName'),
  content: t('configGenerator.ruleNameHelp'),
  popClass: 'auto-dialog',
  textAlign: 'left',
  noCancelBtn: true,
  okText: t('specificWord.confirm'),
  closeOnClickOverlay: true,
  closeOnPopstate: true,
});
</script>

<style lang="scss" scoped>
.config-generator-action-form-wrapper {
  width: 100%;
}
.config-generator-action-form {
  width: 100%;
  :deep(.nut-form-item__label) { width: auto; }
  :deep(.nut-form-item__body) { justify-content: flex-end; }
}
.rule-name-label { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.rule-name-tips-button { display: inline-flex; width: 20px; height: 20px; align-items: center; justify-content: center; margin: 0; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--second-text-color); cursor: pointer; }
.rule-name-tips-button:hover, .rule-name-tips-button:focus-visible { color: var(--primary-color); outline: none; }
.rule-name-tips-button svg { width: 13px; height: 13px; }
.rule-target-content { display: inline-flex; align-items: center; gap: 5px; }
.rule-target-content img { width: 16px; height: 16px; flex-shrink: 0; object-fit: contain; }
.radio-wrapper { display: flex; flex-wrap: wrap; justify-content: flex-end; }
.radio-wrapper :deep(.nut-radiogroup) { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 5px; }
.radio-wrapper :deep(.nut-radio) { display: inline-flex; align-items: center; margin: 0; line-height: 1; }
.radio-wrapper :deep(.nut-radio__button.false) { background: var(--divider-color); border-color: transparent; color: var(--second-text-color); }
.radio-wrapper :deep(.nut-radio__button) { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; height: 30px; padding: 0 9px; line-height: 18px; white-space: nowrap; }
.resource-status { display: inline-flex; min-height: 28px; align-items: center; padding: 0 10px; border-radius: 999px; background: var(--divider-color); color: var(--second-text-color); font-size: 12px; }
.resource-status.available { background: rgba(31, 174, 94, 0.12); color: #1b8a4c; }
.resource-status.disabled, .resource-status.missing, .resource-status.incompatible { background: rgba(224, 73, 73, 0.12); color: #c43e3e; }
.resource-status.updating { background: rgba(248, 160, 38, 0.14); color: #b76d00; }
</style>
