<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { Entry, EntryValue, Library, Template } from '../core/models'
import { useLibrariesStore } from '../stores/libraries'
import { t } from '../locales/strings'
import AppDrawer from './AppDrawer.vue'
import AppIcon from './AppIcon.vue'
import FieldInput from './FieldInput.vue'

const props = defineProps<{ library: Library; template: Template; entry: Entry }>()
const emit = defineEmits<{ close: []; save: [entry: Entry]; delete: [id: string] }>()

const libraries = useLibrariesStore()

const draft = reactive({
  values: { ...props.entry.values } as Record<string, EntryValue | undefined>,
})

/* 条目图片（Excel 单元格图片）：按存储名读字节转 blob URL 展示 */
const imageUrls = ref<{ storedAs: string; url: string }[]>([])
const previewImage = ref<string | null>(null)
const urlCache = new Map<string, string>()

const imageNames = computed(() => props.entry.images ?? [])

watch(
  imageNames,
  async (names) => {
    const loaded: { storedAs: string; url: string }[] = []
    for (const storedAs of names) {
      let url = urlCache.get(storedAs)
      if (!url) {
        const blob = await libraries.readImage(props.library.id, storedAs)
        if (!blob) continue
        url = URL.createObjectURL(blob)
        urlCache.set(storedAs, url)
      }
      loaded.push({ storedAs, url })
    }
    imageUrls.value = loaded
  },
  { immediate: true },
)

function save() {
  const values: Record<string, EntryValue> = {}
  for (const [k, v] of Object.entries(draft.values)) {
    if (v !== undefined) values[k] = v
  }
  emit('save', { ...props.entry, values })
}

function remove() {
  if (window.confirm(t.entryDrawer.deleteConfirm)) emit('delete', props.entry.id)
}

function isTitle(field: Template['fields'][number]): boolean {
  return field.kind === 'text' && /标题|主题|题目|书名|项目|name|title/i.test(field.name)
}
</script>

<template>
  <AppDrawer @close="emit('close')">
    <template #title>
      <h2>{{ t.entryDrawer.title }}</h2>
    </template>

    <div class="entry-form">
      <div v-if="imageUrls.length > 0" class="form-row">
        <label>{{ t.entryDrawer.images }}</label>
        <div class="image-grid">
          <button
            v-for="img in imageUrls"
            :key="img.storedAs"
            type="button"
            class="image-thumb"
            @click="previewImage = img.url"
          >
            <img :src="img.url" alt="" />
          </button>
        </div>
      </div>

      <div v-for="field in props.template.fields" :key="field.id" class="form-row">
        <label>{{ field.name }}</label>
        <FieldInput
          :field="field"
          :model-value="draft.values[field.id]"
          :multiline="field.kind === 'text' && !isTitle(field)"
          @update:model-value="(v) => (draft.values[field.id] = v)"
        />
      </div>

      <p class="meta source-line">
        <AppIcon name="doc" :size="13" />
        {{ t.entryDrawer.sourceFrom(props.entry.sourceRef.fileName, props.entry.sourceRef.locator) }}
      </p>
    </div>

    <template #footer>
      <button class="btn btn-danger" @click="remove">
        <AppIcon name="trash" :size="15" />
        {{ t.common.delete }}
      </button>
      <button class="btn btn-primary" @click="save">{{ t.common.save }}</button>
    </template>

    <Teleport to="body">
      <Transition name="fade">
        <div v-if="previewImage" class="img-preview" role="button" @click="previewImage = null">
          <img :src="previewImage" alt="" />
        </div>
      </Transition>
    </Teleport>
  </AppDrawer>
</template>

<style scoped>
.entry-form {
  display: flex;
  flex-direction: column;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
}

.image-thumb {
  aspect-ratio: 1;
  border-radius: var(--r-m);
  border: 1px solid var(--hairline);
  overflow: hidden;
  background: var(--surface-2);
  padding: 0;
}

.image-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 150ms var(--ease-sheet);
}

.image-thumb:hover img {
  transform: scale(1.04);
}

.img-preview {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: var(--scrim);
  display: grid;
  place-items: center;
  padding: 32px;
  cursor: zoom-out;
}

.img-preview img {
  max-width: min(920px, 92vw);
  max-height: 88vh;
  border-radius: var(--r-m);
  box-shadow: var(--shadow-2);
  background: #fff;
}

.source-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: var(--ink-3);
}
</style>
