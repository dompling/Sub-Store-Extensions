<template>
  <span class="subscription-icon">
    <img v-if="url && failedUrl !== url" :src="url" alt="" @error="failedUrl = url">
    <font-awesome-icon v-else :icon="fallback" />
  </span>
</template>

<script setup lang="ts">
import { ref } from '@/extensions/frontend-sdk-v1';
withDefaults(defineProps<{ url?: string; fallback?: string }>(), {
  url: '',
  fallback: 'fa-solid fa-layer-group',
});
const failedUrl = ref('');
</script>

<style scoped>
.subscription-icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex: 0 0 32px; }
.subscription-icon img { width: 100%; height: 100%; object-fit: contain; border-radius: 8px; }
</style>
