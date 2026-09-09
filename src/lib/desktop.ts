import { isDesktop, platform } from './platform'

/**
 * 桌面端的系统对话框 / 文件写入 / 访达定位。
 * 非桌面平台返回 null 或走浏览器下载兜底。
 */
export async function pickDirectory(): Promise<string | null> {
  if (!isDesktop()) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({ directory: true, title: '选择导出位置' })
  return typeof picked === 'string' ? picked : null
}

export async function pickSavePath(defaultName: string): Promise<string | null> {
  if (!isDesktop()) return null
  const { save } = await import('@tauri-apps/plugin-dialog')
  return await save({ defaultPath: defaultName })
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
