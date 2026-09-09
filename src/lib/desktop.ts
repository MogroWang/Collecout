import { invoke } from '@tauri-apps/api/core'
import { isDesktop, platform } from './platform'

/**
 * 桌面端的系统对话框 / 文件写入 / 访达定位。
 * 非桌面平台返回 null 或走浏览器下载兜底。
 */
export async function pickDirectory(): Promise<string | null> {
  if (!isDesktop()) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({ directory: true, title: '选择文件夹' })
  if (typeof picked !== 'string') return null
  // 把用户选中的目录加入文件系统访问范围（含内部全部内容），否则后续写入会被 scope 拒绝
  await extendFsScope(picked, true)
  return picked
}

export async function pickSavePath(defaultName: string): Promise<string | null> {
  if (!isDesktop()) return null
  const { save } = await import('@tauri-apps/plugin-dialog')
  const picked = await save({ defaultPath: defaultName })
  if (!picked) return null
  await extendFsScope(picked, false)
  return picked
}

/** 通过自定义 Rust 命令把路径登记进 tauri-plugin-fs 的运行时 scope */
async function extendFsScope(path: string, isDir: boolean): Promise<void> {
  try {
    await invoke('extend_fs_scope', { path, isDir })
  } catch {
    /* 授权失败时写入可能仍被 dialog 插件的联动放行，交给后续写入的错误处理 */
  }
}

export async function writeTextAbsolute(path: string, content: string): Promise<void> {
  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  await writeTextFile(path, content)
}

export async function mkdirAbsolute(path: string): Promise<void> {
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  await mkdir(path, { recursive: true })
}

export async function revealInFinder(path: string, isDir: boolean): Promise<void> {
  const opener = await import('@tauri-apps/plugin-opener')
  if (isDir) {
    await opener.openPath(path)
  } else {
    await opener.revealItemInDir(path)
  }
}

/**
 * 复制文本到系统剪贴板。优先用异步 Clipboard API，
 * WebView 不提供时回退到隐藏文本域 + execCommand（Tauri 在部分平台非安全上下文）。
 */
export async function copyToClipboard(content: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(content)
      return true
    }
  } catch {
    /* 落到下面的兜底方案 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = content
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

/** 浏览器兜底：触发一次下载 */
export function downloadText(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function isWebPreview(): boolean {
  return platform() === 'web'
}
