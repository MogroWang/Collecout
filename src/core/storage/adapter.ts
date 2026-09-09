/** 存储适配层：桌面 / 安卓 / 浏览器预览各一套实现，路径相对于应用数据根目录 */
export interface StorageAdapter {
  readText(path: string): Promise<string | null>
  writeText(path: string, data: string): Promise<void>
  remove(path: string): Promise<void>
  listFiles(dir: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  /** 数据根目录的可读描述（绝对路径或平台化说明），供设置页展示 */
  describeRoot?(): Promise<string>
}
