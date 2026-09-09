<script setup lang="ts">
const props = defineProps<{ conf: number }>()

const low = () => props.conf < 0.6
</script>

<template>
  <span class="chip" :class="{ warn: low() }">{{ low() ? '待确认' : '已确认' }}</span>
</template>
