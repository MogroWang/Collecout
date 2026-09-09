export type Platform = 'tauri' | 'capacitor' | 'web'

export function platform(): Platform {
  if (typeof window === 'undefined') return 'web'
  if ('__TAURI_INTERNALS__' in window) return 'tauri'
  const cap = (window as unknown as Record<string, unknown>).Capacitor as { isNativePlatform?: () => boolean } | undefined
  if (cap?.isNativePlatform?.()) return 'capacitor'
  return 'web'
}

export function isDesktop(): boolean {
  return platform() === 'tauri'
}

export function isMobileLayout(): boolean {
  return window.matchMedia('(max-width: 860px)').matches
}
