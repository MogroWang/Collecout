<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { Entry, EntryValue, Library, Template } from '../core/models'
import { useLibrariesStore } from '../stores/libraries'
import { t } from '../locales/strings'
import AppDrawer from './AppDrawer.vue'
import AppIcon from './AppIcon.vue'
import FieldInput from './FieldInput.vue'

const props = defineProps<{ library: Library; template: Template; /** 常驻抽屉：关闭时为 null */ entry: Entry | null; /** 手动新建模式：不显示删除与来源 */ creating?: boolean }>()
const emit = defineEmits<{ close: []; save: [entry: Entry]; delete: [id: string] }>()

const libraries = useLibrariesStore()

const draft = reactive({
  values: { ...(props.entry?.values ?? {}) } as Record<string, EntryValue | undefined>,
})

/* 组件常驻：每次打开（entry 换人）都重置草稿，避免残留上一次的编辑 */
watch(
  () => props.entry,
  (entry) => {
    draft.values = { ...(entry?.values ?? {}) }
  },
)

/* 条目图片（Excel 单元格图片）：按字段归属展示，读字节转 blob URL */
const imageUrls = ref<Record<string, string>>({})
const previewImage = ref<string | null>(null)
const urlCache = new Map<string, string>()

const entryImages = computed(() => props.entry?.images ?? [])

function imagesOf(fieldId: string | undefined): { storedAs: string; url: string }[] {
  return entryImages.value
    .filter((img) => img.fieldId === fieldId)
    .map((img) => ({ storedAs: img.storedAs, url: imageUrls.value[img.storedAs] }))
    .filter((img) => img.url !== undefined)
}

watch(
  entryImages,
  async (images) => {
    for (const img of images) {
      if (urlCache.has(img.storedAs)) continue
      const blob = await libraries.readImage(props.library.id, img.storedAs)
      if (!blob) continue
      const url = URL.createObjectURL(blob)
      urlCache.set(img.storedAs, url)
      imageUrls.value = { ...imageUrls.value, [img.storedAs]: url }
    }
  },
  { immediate: true },
)

function save() {
  if (!props.entry) return
  const values: Record<string, EntryValue> = {}
  for (const [k, v] of Object.entries(draft.values)) {
    if (v !== undefined) values[k] = v
  }
  emit('save', { ...props.entry, values })
}

function remove() {
  if (!props.entry) return
  if (window.confirm(t.entryDrawer.deleteConfirm)) emit('delete', props.entry.id)
}

function isTitle(field: Template['fields'][number]): boolean {
  return field.kind === 'text' && /标题|主题|题目|书名|项目|name|title/i.test(field.name)
}
</script>

<template>
  <AppDrawer :open="!!props.entry" @close="emit('close')">
    <template #title>
      <h2>{{ props.creating ? t.library.addEntry : t.entryDrawer.title }}</h2>
    </template>

    <div class="entry-form">
      <div v-for="field in props.template.fields" :key="field.id" class="form-row">
        <label>{{ field.name }}</label>
        <FieldInput
          :field="field"
          :model-value="draft.values[field.id]"
          :multiline="field.kind === 'text' && !isTitle(field)"
          @update:model-value="(v) => (draft.values[field.id] = v)"
        />
        <div v-if="imagesOf(field.id).length > 0" class="field-images">
          <button
            v-for="img in imagesOf(field.id)"
            :key="img.storedAs"
            type="button"
            class="image-thumb"
            @click="previewImage = img.url"
          >
            <img :src="img.url" alt="" />
          </button>
        </div>
      </div>

      <div v-if="imagesOf(undefined).length > 0" class="form-row">
        <label>{{ t.entryDrawer.images }}</label>
        <div class="field-images">
          <button
            v-for="img in imagesOf(undefined)"
            :key="img.storedAs"
            type="button"
            class="image-thumb"
            @click="previewImage = img.url"
          >
            <img :src="img.url" alt="" />
          </button>
        </div>
      </div>

      <p v-if="props.entry && !props.creating" class="meta source-line">
        <AppIcon name="doc" :size="13" />
        {{ t.entryDrawer.sourceFrom(props.entry.sourceRef.fileName, props.entry.sourceRef.locator) }}
      </p>
    </div>

    <template #footer>
      <button v-if="props.entry && !props.creating" class="btn btn-danger" @click="remove">
        <AppIcon name="trash" :size="15" />
        {{ t.common.delete }}
      </button>
      <span v-else class="foot-spacer"></span>
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

.field-images {
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

.foot-spacer {
  flex: 1;
}
</style>
