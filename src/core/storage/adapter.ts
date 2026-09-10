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

  /* ---------- 0.4.0 库文件夹结构（内部库三平台尽量实现，跨位置能力仅桌面端） ---------- */

  /** 列出数据根内某目录的子目录名（内部库文件夹列表） */
  listSubdirs?(dir: string): Promise<string[]>
  /** 递归列出数据根内某目录下的全部文件（相对该目录的路径） */
  listTree?(dir: string): Promise<string[]>
  /** 删除数据根内的整个目录树（内部库 / 其 files 子目录） */
  removeTree?(rel: string): Promise<void>
  /** 把字节写入数据根内（导入附件用）；返回 false 表示平台不支持 */
  writeBinary?(rel: string, bytes: Uint8Array): Promise<boolean>

  /** 相对路径 → 绝对路径（桌面端） */
  absOf?(rel: string): Promise<string>
  /** 递归复制目录（桌面端，库在内部 ↔ 外部之间搬运用） */
  copyDir?(srcAbs: string, destAbs: string): Promise<void>
  /** 删除绝对路径的目录树（桌面端，外部库 / 内部库目录都走这里） */
  removeDir?(abs: string): Promise<void>
  /** 确保绝对路径目录存在（桌面端） */
  ensureDirAbs?(abs: string): Promise<void>
  /** 列绝对路径目录的内容（桌面端；OOBE 校验空文件夹 / 列外部库文件） */
  listDirAbs?(abs: string): Promise<string[]>
  /** 把外部文件复制进数据根（桌面端导入附件） */
  copyFileIn?(srcAbs: string, destRel: string): Promise<void>
}
