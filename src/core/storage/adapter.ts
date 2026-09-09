/** 存储适配层：桌面 / 安卓 / 浏览器预览各一套实现，路径相对于应用数据根目录 */
export interface StorageAdapter {
  readText(path: string): Promise<string | null>
  writeText(path: string, data: string): Promise<void>
  remove(path: string): Promise<void>
  listFiles(dir: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  /** 数据根目录的可读描述（绝对路径或平台化说明），供设置页展示 */
  describeRoot?(): Promise<string>

  /* ---------- 以下能力仅桌面端（Tauri）支持，其他平台为 undefined ---------- */

  /** 读取 / 写入 / 删除任意绝对路径的文本文件（独立存放的库文件用） */
  readAbs?(path: string): Promise<string | null>
  writeAbs?(path: string, data: string): Promise<void>
  removeAbs?(path: string): Promise<void>
  existsAbs?(path: string): Promise<boolean>

  /** 目录是否可写（OOBE / 更改数据位置前探测） */
  canWriteAbs?(path: string): Promise<boolean>

  /**
   * 首次启动判定：默认数据文件夹不存在且从未设置过数据位置时返回 true，
   * 由 OOBE 向导引导用户选择数据存放位置。
   */
  needsOnboarding?(): Promise<boolean>
  /** 默认数据位置的可读路径（OOBE 里展示的推荐选项） */
  describeDefaultRoot?(): Promise<string>
  /**
   * 设置数据存放位置：null 表示恢复默认。设置后立即生效，
   * 指针文件保存在默认数据文件夹内，下次启动自动跟随。
   */
  setDataRoot?(path: string | null): Promise<void>
}
