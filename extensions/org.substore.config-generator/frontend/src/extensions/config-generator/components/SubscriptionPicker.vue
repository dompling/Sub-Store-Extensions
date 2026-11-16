<template>
  <nut-popup :visible="visible" position="bottom" round :style="{ maxHeight: '75vh' }" @update:visible="$emit('update:visible', $event)">
    <div class="subscription-picker">
      <div class="picker-toolbar">
        <button type="button" @click="$emit('update:visible', false)">{{ $t('specificWord.cancel') }}</button>
        <strong>{{ $t('configGenerator.fields.source') }}</strong>
        <button type="button" :disabled="!selected" @click="confirm">{{ $t('specificWord.confirm') }}</button>
      </div>
      <div class="picker-options">
        <template v-for="section in sections" :key="section.key">
          <p v-if="section.text" class="picker-heading">{{ section.text }}</p>
          <button
            v-for="option in section.options"
            :key="JSON.stringify(option.path)"
            type="button"
            class="picker-option"
            :aria-pressed="JSON.stringify(selection) === JSON.stringify(option.path)"
            @click="selection = option.path"
          >
            <SubscriptionIcon :url="option.icon" />
            <span>{{ option.text }}</span>
            <nut-icon v-if="JSON.stringify(selection) === JSON.stringify(option.path)" name="check-normal" size="14px" />
          </button>
        </template>
      </div>
    </div>
  </nut-popup>
</template>

<script setup lang="ts">
import { computed, ref, watch } from '@/extensions/frontend-sdk-v1';
import SubscriptionIcon from './SubscriptionIcon.vue';
type Option = { value: string; text: string; icon?: string; children?: Option[] };
const props = defineProps<{ visible: boolean; modelValue: string[]; columns: Option[] }>();
const emit = defineEmits(['update:visible', 'update:modelValue', 'confirm']);
const selection = ref<string[]>([]);
const sections = computed(() => props.columns.some(option => option.children)
  ? props.columns.map(option => ({
      key: option.value,
      text: option.text,
      options: (option.children || []).map(child => ({ ...child, path: [option.value, child.value] })),
    }))
  : [{ key: '', text: '', options: props.columns.map(option => ({ ...option, path: [option.value] })) }]);
const selected = computed(() => sections.value.flatMap(section => section.options)
  .find(option => JSON.stringify(option.path) === JSON.stringify(selection.value)));
watch(() => props.visible, visible => {
  if (visible) selection.value = [...props.modelValue];
}, { immediate: true });
const confirm = () => {
  if (!selected.value) return;
  emit('update:modelValue', [...selection.value]);
  emit('confirm', { selectedValue: [...selection.value] });
  emit('update:visible', false);
};
</script>

<style scoped>
.subscription-picker { color: var(--text-color); padding-bottom: env(safe-area-inset-bottom); }
.picker-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 16px; }
.picker-toolbar button { border: 0; background: transparent; color: var(--primary-color); cursor: pointer; }
.picker-toolbar button:disabled { opacity: .45; }
.picker-options { max-height: 55vh; overflow-y: auto; padding: 0 16px 16px; }
.picker-heading { color: var(--comment-color); font-size: 12px; }
.picker-option { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px; border: 0; border-radius: 10px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.picker-option[aria-pressed="true"] { background: color-mix(in srgb, var(--primary-color) 10%, transparent); color: var(--primary-color); }
.picker-option span:nth-child(2) { flex: 1; min-width: 0; overflow-wrap: anywhere; }
</style>
