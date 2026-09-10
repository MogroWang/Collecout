<script setup lang="ts">
const props = defineProps<{ name: IconName; size?: number }>()

const icons = {
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  import: '<path d="M12 3v10"/><path d="m8 9 4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  export: '<path d="M12 21V11"/><path d="m8 15 4-4 4 4"/><path d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M3 15h18"/><path d="M9 10v10"/>',
  cards: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-3.2-3.2"/>',
  filter: '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>',
  x: '<path d="m6 6 12 12"/><path d="M18 6 6 18"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16"/><path d="M9 3v4"/><path d="M15 3v4"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
  sheet: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16"/><path d="M4 14h16"/><path d="M10 9v11"/>',
  text: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  gear: '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M19.63 9.96L21.51 10.66L21.59 11.55L21.59 12.45L21.51 13.34L19.63 14.04L18.84 15.95L19.67 17.78L19.1 18.47L18.47 19.1L17.78 19.67L15.95 18.84L14.04 19.63L13.34 21.51L12.45 21.59L11.55 21.59L10.66 21.51L9.96 19.63L8.05 18.84L6.22 19.67L5.53 19.1L4.9 18.47L4.33 17.78L5.16 15.95L4.37 14.04L2.49 13.34L2.41 12.45L2.41 11.55L2.49 10.66L4.37 9.96L5.16 8.05L4.33 6.22L4.9 5.53L5.53 4.9L6.22 4.33L8.05 5.16L9.96 4.37L10.66 2.49L11.55 2.41L12.45 2.41L13.34 2.49L14.04 4.37L15.95 5.16L17.78 4.33L18.47 4.9L19.1 5.53L19.67 6.22L18.84 8.05ZM12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 1 0 0-6.4Z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 12.5 9 5 9-5"/>',
  pencil: '<path d="m4 20 1-4L16.5 4.5a2.12 2.12 0 0 1 3 3L8 19l-4 1Z"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="m6 7 .8 12a2 2 0 0 0 2 1.9h6.4a2 2 0 0 0 2-1.9L18 7"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  library: '<rect x="4" y="3" width="7" height="18" rx="2"/><path d="M15 5h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/>',
  warning: '<path d="M10.3 4.2 2.8 17.5a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9v5"/><path d="M12 17.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M12 11v6"/>',
  sort: '<path d="M7 20V7"/><path d="m4 10 3-3 3 3"/><path d="M17 4v13"/><path d="m14 14 3 3 3-3"/>',
  'arrow-left': '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
} as const

type IconName = keyof typeof icons
</script>

<template>
  <svg
    :width="props.size ?? 18"
    :height="props.size ?? 18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="icons[props.name]"
  />
</template>
