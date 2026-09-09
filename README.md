# 萃序 Collecout

把 Word、Excel 和纯文本，萃成结构化的信息库。

萃序是一款本地优先的信息提取与整理工具：导入 `.docx`、`.xlsx`、`.csv`、`.txt`、`.md` 文件，选择（或自定义）一个模板，软件会自动分析文档结构、抽取字段并归纳成条目，形成可筛选、可检索、可导出的信息管理系统。适合整理会议纪要、读书笔记、收支流水、工作日志等零散文档。

> 萃，是萃取；序，是秩序。

## 功能

- **多格式导入**：Word（.docx）、Excel / CSV（.xlsx / .csv）、纯文本（.txt / .md）
- **自动识别**：分析标题层级、表格、`key: value` 行与段首日期，现场推断字段与提取方式
- **模板系统**：内置会议纪要、读书笔记、收支流水、通用表格四个模板；字段名、类型（文本/日期/数字/标签）与提取方式（自动/关键词/正则/标题分节/表格列）均可自定义
- **置信度确认**：每个字段带 0–1 置信度，低置信度在导入预览中高亮，逐格修正后再入库
- **两种视图**：表格视图（列排序、显隐）与卡片视图
- **筛选**：全文搜索、按日期字段的时间段、按数值区间、按标签/包含文字组合筛选
- **导出**：Markdown / 纯文本（制表符分隔）/ CSV / JSON / 本地文件夹（每条目一个 Markdown 文件 + 索引）；支持按「全部 / 筛选结果 / 勾选条目」与所选字段导出
- **本地存储**：所有数据以 JSON 存于应用数据目录，可直接备份与同步；不联网、不上传

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3 + TypeScript + Vite |
| 桌面端 | Tauri 2（macOS / Windows / Linux） |
| 安卓端 | Capacitor 7 |
| 解析 | mammoth.js（Word）、SheetJS（Excel/CSV） |
| 提取引擎 | 自研规则引擎（正则 + 关键词 + 结构启发式），预留 LLM 扩展接口 |
| 测试 | Vitest（53 个单元测试覆盖解析、提取、筛选、导出） |

## 快速开始

环境要求：Node.js ≥ 20；桌面端构建需要 Rust 工具链；打包安卓 APK 需要 Android Studio。

```bash
npm install

# 浏览器预览（数据存于 localStorage，仅供开发调试）
npm run dev

# 桌面端开发（Tauri 窗口）
npm run tauri dev

# 桌面端打包
npm run tauri build

# 安卓：生成工程并同步（已在仓库内，无需重复 add）
npm run build && npx cap sync android
npx cap open android   # 在 Android Studio 中打包 APK
```

示例文件在 `samples/` 目录（会议纪要、读书笔记、工作日志、收支流水），导入向导里可直接试用。

## 目录结构

```
├─ src/
│  ├─ core/            # 纯 TS 核心层（无框架依赖，全部有单测）
│  │  ├─ parsers/      # docx / xlsx / 纯文本 → 统一块结构
│  │  ├─ extract/      # 规则引擎、日期识别、列映射、模板推断
│  │  ├─ query/        # 筛选与排序
│  │  ├─ export/       # Markdown / TXT / CSV / JSON / 文件夹
│  │  └─ storage/      # 存储适配层（Tauri / Capacitor / Web）
│  ├─ stores/          # Pinia 状态（库 / 模板 / 导入向导 / 设置）
│  ├─ views/           # 首页、库详情、导入向导、模板编辑器、设置
│  ├─ components/      # 表格、卡片、筛选、导出对话框等
│  ├─ styles/          # 设计令牌与基础样式（明暗双主题）
│  └─ locales/         # 界面文案集中管理
├─ src-tauri/          # Tauri 2 桌面壳
├─ android/            # Capacitor 安卓工程
├─ scripts/            # 图标生成（纯 Node）与示例文件生成
└─ samples/            # 演示与测试用示例文件
```

## 设计说明

界面遵循两套原则打磨：Apple 流体界面规范（系统字体栈、半透明材质工具栏、同路径进出场动效、尊重「减弱动态效果」与「降低透明度」设置、安全区与触控目标适配），以及反 AI 味准则（单一墨青强调色、层级靠字号字重与留白、无渐变无发光无表情符号、每个装饰都有存在理由）。

## Roadmap

- [ ] 0.2：LLM 提取接口（用户自备 OpenAI 兼容 API，语义化字段抽取）
- [ ] 0.2：库内手动建条目、条目间引用
- [ ] 0.3：iOS 端（需完整 Xcode 环境）
- [ ] 0.3：CSV 导入映射的列类型手动指定、模板导入导出

## 变更日志

见 [CHANGELOG.md](./CHANGELOG.md)。

## License

[MIT](./LICENSE) © 2026 MogroWang Studio
