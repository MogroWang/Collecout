import { defineStore } from 'pinia'
import type { Template } from '../core/models'
import { BUILTIN_TEMPLATES } from '../core/extract'
import { repo } from '../core/storage/repo'

function templateFile(id: string): string {
  return `templates/${id}.json`
}

export const useTemplatesStore = defineStore('templates', {
  state: () => ({
    user: [] as Template[],
  }),
  getters: {
    all(state): Template[] {
      return [...BUILTIN_TEMPLATES, ...state.user]
    },
    byId(): (id: string) => Template | undefined {
      return (id) => this.all.find((t) => t.id === id)
    },
  },
  actions: {
    async load() {
      this.user = await repo().loadUserTemplates()
    },
    async create(tpl: Omit<Template, 'builtin'>) {
      const template: Template = { ...tpl, builtin: false }
      this.user.push(template)
      await repo().saveNow(templateFile(template.id), template)
      return template
    },
    async update(template: Template) {
      const i = this.user.findIndex((x) => x.id === template.id)
      if (i === -1) return
      this.user[i] = { ...template, builtin: false }
      repo().saveJSON(templateFile(template.id), this.user[i])
    },
    async remove(id: string) {
      this.user = this.user.filter((x) => x.id !== id)
      await repo().remove(templateFile(id))
    },
    /** 复制任意模板（内置或用户）为「我的模板」副本 */
    async duplicate(id: string): Promise<Template | null> {
      const source = this.all.find((t) => t.id === id)
      if (!source) return null
      const baseName = source.name.replace(/（副本\d*）$/, '')
      const copy: Template = {
        ...structuredClone(source),
        id: crypto.randomUUID(),
        name: `${baseName}（副本）`,
        builtin: false,
      }
      this.user.push(copy)
      await repo().saveNow(templateFile(copy.id), copy)
      return copy
    },
  },
})
