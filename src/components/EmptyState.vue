<script setup lang="ts">
import AppIcon from './AppIcon.vue'

defineProps<{ icon: 'library' | 'search' | 'table' | 'doc' | 'layers' | 'filter'; title: string; desc?: string }>()
</script>

<template>
  <div class="empty-state">
    <div class="icon-wrap">
      <AppIcon :name="icon" :size="24" />
    </div>
    <h2>{{ title }}</h2>
    <p v-if="desc">{{ desc }}</p>
    <div v-if="$slots.default" class="actions">
      <slot />
    </div>
  </div>
</template>
