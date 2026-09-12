import { platform } from './platform'

/**
 * 安卓 SystemBars 插件（android/app/.../SystemBarsPlugin.java）的 web 侧封装：
 * 读取 edge-to-edge 下的系统栏 insets 写入 CSS 变量，供顶栏/底栏避让；
 * 按主题切换状态栏图标明暗。非安卓端全部静默跳过。
 */
interface SystemBarsPlugin {
  insets(): Promise<{ top?: number; bottom?: number }>
  setLight(options: { light: boolean }): Promise<void>
}

function systemBars(): SystemBarsPlugin | null {
  if (platform() !== 'capacitor') return null
  const plugins = (window as unknown as { Capacitor?: { Plugins?: Record<string, SystemBarsPlugin> } }).Capacitor?.Plugins
  return plugins?.SystemBars ?? null
}

/** 把系统栏 insets 写入 --safe-top / --safe-bottom（CSS 里与 env() 取最大值兜底） */
export async function applySafeAreaInsets(): Promise<void> {
  const plugin = systemBars()
  if (!plugin) return
  try {
    const { top, bottom } = await plugin.insets()
    const style = document.documentElement.style
    style.setProperty('--safe-top', `${Math.max(0, top ?? 0)}px`)
    style.setProperty('--safe-bottom', `${Math.max(0, bottom ?? 0)}px`)
  } catch {
    /* insets 拿不到时保持 0，布局退化为不避让，不影响可用性 */
  }
}

/** light = true 表示状态栏底色浅，图标用深色（与浅色主题的白顶栏匹配） */
export function setStatusBarIcons(light: boolean): void {
  systemBars()
    ?.setLight({ light })
    .catch(() => {})
}
