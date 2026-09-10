// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { plainClone } from '../core/models'
import { initRepo, repo } from '../core/storage/repo'
import { useTemplatesStore } from './templates'

beforeEach(async () => {
  localStorage.clear()
  setActivePinia(createPinia())
  await initRepo()
})

describe('templates store 编辑与持久化', () => {
  it('个人模板可编辑：update 即时落盘，重载后修改保留', async () => {
    const store = useTemplatesStore()
    const tpl = await store.create({ id: 'u1', name: '我的模板', description: '', fields: [] })

    // 模拟视图层：byId 返回响应式代理，plainClone 必须能克隆（此前 structuredClone 在这里抛错）
    const draft = plainClone(store.byId('u1')!)
    draft.name = '改名后'
    await store.update({ ...draft, builtin: false })

    expect(store.byId('u1')?.name).toBe('改名后')
    const reloaded = useTemplatesStore()
    await reloaded.load()
    expect(reloaded.byId('u1')?.name).toBe('改名后')
    expect(tpl.builtin).toBe(false)
  })

  it('复制内置模板得到可编辑副本，副本再编辑不影响原模板', async () => {
    const store = useTemplatesStore()
    const builtin = store.all.find((x) => x.builtin)!
    const copy = await store.duplicate(builtin.id)
    expect(copy).not.toBeNull()
    expect(copy!.builtin).toBe(false)
    expect(store.byId(builtin.id)?.builtin).toBe(true)

    await store.update({ ...plainClone(copy!), name: '副本改', fields: copy!.fields })
    expect(store.byId(copy!.id)?.name).toBe('副本改')
    // 内置原模板不受影响
    expect(store.byId(builtin.id)?.name).toBe(builtin.name)
  })

  it('删除个人模板后不再出现', async () => {
    const store = useTemplatesStore()
    await store.create({ id: 'u2', name: '待删', description: '', fields: [] })
    await store.remove('u2')
    expect(store.byId('u2')).toBeUndefined()
    const reloaded = useTemplatesStore()
    await reloaded.load()
    expect(reloaded.byId('u2')).toBeUndefined()
  })

  it('存储中的模板文件随 create 即时写入', async () => {
    const store = useTemplatesStore()
    await store.create({ id: 'u3', name: '落盘检查', description: '', fields: [] })
    const persisted = await repo().readJSON<{ name: string } | null>('templates/u3.json', null)
    expect(persisted?.name).toBe('落盘检查')
  })
})
