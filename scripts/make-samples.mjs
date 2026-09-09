/** 生成 samples/ 下的示例文件，供导入演示与手工测试 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'samples')
mkdirSync(dir, { recursive: true })

writeFileSync(
  join(dir, '会议纪要.txt'),
  [
    '产品周会纪要',
    '',
    '时间：2026年8月28日 14:00',
    '地点：3 号楼 201 会议室',
    '参会人：王明、李华、赵倩、陈拓',
    '主题：萃序 0.1.0 发布计划',
    '',
    '一、进展',
    '- 导入向导联调完成',
    '- 表格视图排序性能优化完成',
    '',
    '二、决议',
    '- 0.1.0 于 2026年9月9日 发布',
    '- 安卓端随桌面端同步内测',
    '',
    '三、待办',
    '- 王明：编写 README，9月5日前',
    '- 李华：整理测试样本文件',
    '',
  ].join('\n'),
)

writeFileSync(
  join(dir, '读书笔记.md'),
  [
    '# 《置身事内》读书笔记',
    '',
    '日期：2026-07-12',
    '作者：兰小欢',
    '类型：经济 / 通识',
    '评分：9',
    '',
    '政府不是蛋糕的旁观者，而是直接下场的分蛋糕人。理解中国经济，得先理解地方政府的行为逻辑。',
    '',
    '## 摘录',
    '- 土地财政的本质是抵押未来收入。',
    '- 地方政府公司化是理解增长的关键。',
    '',
  ].join('\n'),
)

writeFileSync(
  join(dir, '工作日志.txt'),
  [
    '2026-08-30 完成导入向导的状态机，比预想的顺利。',
    '2026-08-31 修复表格映射在空列上的崩溃。',
    '2026-09-01 给字段提取加上置信度标记。',
    '2026-09-02 文件夹导出补齐索引文件。',
    '2026-09-03 深色模式的对比度又调了一轮。',
    '2026-09-05 写完 README，准备发布。',
  ].join('\n'),
)

const wb = XLSX.utils.book_new()
const rows = [
  ['日期', '项目', '类别', '金额', '收支', '备注'],
  ['2026-08-01', '团队午餐', '餐饮', 286, '支出', '项目启动聚餐'],
  ['2026-08-03', '云服务器', '办公', 89, '支出', '8 月账单'],
  ['2026-08-05', '咨询费', '收入', 3000, '收入', '萃序需求梳理'],
  ['2026-08-12', '火车票', '差旅', 553, '支出', '去杭州见客户'],
  ['2026-08-15', '书籍', '学习', 132.5, '支出', '两本数据库书'],
  ['2026-08-20', '软件授权', '收入', 1200, '收入', '内测授权'],
  ['2026-08-26', '办公用品', '办公', 76.4, '支出', '标签纸与笔'],
]
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '八月')
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
writeFileSync(join(dir, '收支流水.xlsx'), buf)

console.log('已生成 samples/ 下的示例文件：会议纪要.txt、读书笔记.md、工作日志.txt、收支流水.xlsx')
