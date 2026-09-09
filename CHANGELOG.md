# 变更日志

本项目的所有显著变更将记录在此文件。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-09-09

### Added

- 首个可用版本：Vue 3 + TypeScript + Vite 前端，Tauri 2 桌面端，Capacitor 7 安卓端。
- 导入 Word（.docx）、Excel / CSV、纯文本（.txt / .md），解析为统一的块结构。
- 本地规则引擎：按模板提取字段（关键词、正则、标题分节、表格列映射），支持中英文日期识别；每个字段带置信度，低置信度内容在导入预览中高亮并可逐格修正。
- 「自动识别」模板：分析文档结构（表格主导 / key:value / 日志式段首日期），现场推断字段与提取模式。
- 模板系统：内置会议纪要、读书笔记、收支流水、通用表格；支持新建自定义模板与复制内置模板，字段名称 / 类型 / 提取方式可配置，附样例试提取。
- 库与条目管理：表格 / 卡片双视图，列排序，全文搜索，按日期时间段、数值区间、标签与包含文字组合筛选。
- 导出：Markdown / 纯文本 / CSV / JSON 单文件导出，本地文件夹导出（每条目一个 Markdown 文件 + 索引.md + index.json）；导出范围支持全部、当前筛选结果与勾选条目，字段可选。
- 存储：桌面端（Tauri plugin-fs）与安卓端（Capacitor Filesystem）各一套 JSON 文件存储，浏览器开发预览走 localStorage。
- 外观：浅色 / 深色 / 跟随系统主题；桌面与移动端双布局。
- 53 个 Vitest 单元测试覆盖解析、提取、筛选与导出。
- `scripts/gen-icon.mjs`：零依赖 Node 脚本程序化生成应用图标。

[0.1.0]: https://github.com/mogrowang/collecout/releases/tag/v0.1.0
