<script setup lang="ts">
import { useUiStore } from '../stores/ui'
import AppIcon from './AppIcon.vue'

const ui = useUiStore()
</script>

<template>
  <div class="toast-host">
    <TransitionGroup name="pop">
      <div v-for="toast in ui.toasts" :key="toast.id" class="toast" :class="toast.kind" @click="ui.dismiss(toast.id)">
        <AppIcon :name="toast.kind === 'info' ? 'check' : toast.kind === 'warn' ? 'warning' : 'warning'" :size="15" />
        {{ toast.text }}
      </div>
    </TransitionGroup>
  </div>
</template>
