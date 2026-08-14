<template>
  <nut-popup
    :visible="visible"
    position="bottom"
    round
    pop-class="rule-studio-option-picker-popup"
    :lock-scroll="true"
    :safe-area-inset-bottom="true"
    :z-index="13200"
    @update:visible="handleVisibleChange"
  >
    <section class="option-picker-shell" role="dialog" aria-modal="true" :aria-label="title">
      <header class="option-picker-header">
        <span>
          <small>{{ title }}</small>
          <strong>{{ selectedText || title }}</strong>
          <p v-if="description">{{ description }}</p>
        </span>
        <button type="button" :aria-label="cancelText" @click="close">
          <font-awesome-icon icon="fa-solid fa-xmark" />
        </button>
      </header>

      <div class="option-picker-list" role="radiogroup" :aria-label="title">
        <button
          v-for="option in options"
          :key="option.value"
          type="button"
          class="option-picker-item"
          :class="{ selected: draftValue === option.value }"
          role="radio"
          :aria-checked="draftValue === option.value"
          @click="draftValue = option.value"
        >
          <span class="option-picker-marker">
            <font-awesome-icon v-if="draftValue === option.value" icon="fa-solid fa-check" />
          </span>
          <span class="option-picker-copy">
            <strong>{{ option.text }}</strong>
            <small v-if="option.description">{{ option.description }}</small>
          </span>
          <font-awesome-icon
            class="option-picker-state"
            :icon="draftValue === option.value ? 'fa-solid fa-circle-check' : 'fa-solid fa-chevron-right'"
          />
        </button>
      </div>

      <footer class="option-picker-footer">
        <button type="button" class="option-picker-cancel" @click="close">{{ cancelText }}</button>
        <nut-button type="primary" class="option-picker-confirm" :disabled="!allowEmpty && !draftValue" @click="confirm">
          {{ confirmText }}
        </nut-button>
      </footer>
    </section>
  </nut-popup>
</template>

<script setup lang="ts">
import { computed, ref, watch } from '@/extensions/frontend-sdk-v1';

type RuleStudioPickerOption = {
  value: string;
  text: string;
  description?: string;
};

const props = defineProps<{
  visible: boolean;
  modelValue: string;
  title: string;
  cancelText: string;
  confirmText: string;
  options: RuleStudioPickerOption[];
  description?: string;
  allowEmpty?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void;
  (event: 'update:modelValue', value: string): void;
  (event: 'confirm', value: string): void;
}>();

const draftValue = ref(props.modelValue);
const selectedText = computed(() => props.options.find(option => option.value === draftValue.value)?.text || '');

const close = () => emit('update:visible', false);
const confirm = () => {
  if (!props.allowEmpty && !draftValue.value) return;
  emit('update:modelValue', draftValue.value);
  emit('confirm', draftValue.value);
  close();
};
const handleVisibleChange = (visible: boolean) => emit('update:visible', visible);

watch(() => props.visible, (visible) => {
  if (visible) draftValue.value = props.modelValue;
});
watch(() => props.modelValue, (value) => {
  if (!props.visible) draftValue.value = value;
});
</script>

<style scoped>
.option-picker-shell {
  display: flex;
  box-sizing: border-box;
  max-height: min(72vh, 540px);
  flex-direction: column;
  padding: 18px 14px 0;
  background: var(--background-color);
  color: var(--primary-text-color);
}

.option-picker-header {
  position: relative;
  padding: 3px 52px 14px 2px;
}

.option-picker-header > span {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.option-picker-header small {
  color: var(--primary-color);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .08em;
}

.option-picker-header strong {
  overflow: hidden;
  font-size: 19px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-picker-header p {
  margin: 2px 0 0;
  color: var(--comment-text-color);
  font-size: 11px;
  line-height: 1.5;
}

.option-picker-header > button {
  position: absolute;
  top: 0;
  right: 0;
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: var(--card-color);
  color: var(--primary-text-color);
  cursor: pointer;
}

.option-picker-list {
  display: grid;
  min-height: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  overflow-y: auto;
  padding: 2px;
}

.option-picker-item {
  display: grid;
  min-width: 0;
  min-height: 56px;
  grid-template-columns: 24px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--divider-color);
  border-radius: 12px;
  padding: 10px 11px;
  background: var(--card-background-color);
  color: var(--primary-text-color);
  cursor: pointer;
  text-align: left;
}

.option-picker-item.selected {
  border-color: color-mix(in srgb, var(--primary-color) 52%, var(--divider-color));
  background: color-mix(in srgb, var(--primary-color) 7%, var(--card-background-color));
}

.option-picker-marker {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 1px solid var(--divider-color);
  border-radius: 7px;
  color: #fff;
  font-size: 10px;
}

.option-picker-item.selected .option-picker-marker {
  border-color: var(--primary-color);
  background: var(--primary-color);
}

.option-picker-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.option-picker-copy strong,
.option-picker-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
}

.option-picker-copy strong {
  font-size: 12px;
  white-space: nowrap;
}

.option-picker-copy small {
  color: var(--comment-text-color);
  font-size: 10px;
  line-height: 1.35;
}

.option-picker-state {
  justify-self: end;
  color: var(--comment-text-color);
  font-size: 11px;
}

.option-picker-item.selected .option-picker-state {
  color: var(--primary-color);
}

.option-picker-footer {
  display: flex;
  gap: 8px;
  padding: 10px 0 max(8px, env(safe-area-inset-bottom));
  margin-top: 12px;
  border-top: 1px solid var(--divider-color);
}

.option-picker-cancel,
.option-picker-confirm {
  min-height: 42px;
  border-radius: 10px;
}

.option-picker-cancel {
  min-width: 96px;
  padding: 0 16px;
  border: 1px solid var(--divider-color);
  background: transparent;
  color: var(--secondary-text-color);
  cursor: pointer;
}

.option-picker-confirm {
  flex: 1;
}

@media (min-width: 700px) {
  :global(.rule-studio-option-picker-popup) {
    right: 0 !important;
    left: 0 !important;
    width: min(560px, calc(100vw - 48px)) !important;
    max-height: min(540px, calc(100vh - 64px)) !important;
    margin-right: auto;
    margin-left: auto;
  }
}

@media (max-width: 560px) {
  .option-picker-shell {
    max-height: 78vh;
  }

  .option-picker-list {
    grid-template-columns: 1fr;
  }
}
</style>
