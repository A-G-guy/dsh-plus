/**
 * 动作表：本 CLI 的**唯一事实来源**——argv 解析、帮助文本、以及暴露给 DSH/MCP 的
 * 工具 schema 全部由这张表派生，三者不可能漂移。
 *
 * 约定：
 * - 每个 action 一个子命令，参数一律用长选项（不做位置参数，避免歧义与越界解析）；
 * - `--definition` / `--overrides` 收 JSON 字符串（`@file` 形式可从文件读取，
 *   由 `cli.ts` 在读取层展开）；
 * - `readOnly` 只描述「不改预算数据」，用于审批判定；写动作必须显式标注。
 * - `needsBudget: false` 的动作只读本机/服务端资产，不打开预算。
 * @module @dsh-plus/actual-reports/actions-reference
 */

import type { FamilySpec } from './family.ts'

const KIND_DOC =
  'core（本机官方 CLI 自带的 @actual-app/core 源码）/ client（服务端托管的客户端源码）/ all（默认）。'

/** 参考族：定制组件与报表所需的官方语义。 */
export const REFERENCE_FAMILY: FamilySpec = {
  family: 'reference',
  summary:
    '定制报表/仪表盘所需的官方语义查询：组件类型与 meta 字段、实验开关、报表字段取值、' +
    '本机官方源码。全部取自本机（官方 CLI 自带的 @actual-app/core 源码、服务端托管的客户端' +
    '源码、当前预算的偏好表），**不需要联网翻官方仓库**。',
  guidance:
    '写组件前先 widgets 拿类型与 meta 字段名（不要凭猜：字段名写错不会报错，界面里直接渲染不出来）；' +
    '实验类组件（公式卡等）先 prefs 看开关是否开启，未开启就告知用户去界面开，别硬写。' +
    'widgets/prefs 说不出细节时用 source 读本机源码：--list 列路径、--grep 检索、--file 读一份；' +
    '--kind core 是本机官方源码（模型、服务端实现），--kind client 是服务端托管的界面源码（区间词汇、卡片渲染），' +
    'client 需要拉服务端 source map（默认 8 份、结果缓存），只在必要时用。' +
    '报表字段的合法取值用 report-options（可用 --verify 与本机客户端资产逐字核对）。',
  actions: [
    {
      action: 'widgets',
      needsBudget: false,
      summary: '列出组件类型与每个类型的 meta 字段（字段名、类型、是否可选），并给出共享类型定义。',
      readOnly: true,
      args: [
        {
          prop: 'type',
          flag: 'type',
          type: 'string',
          description:
            '只列这一个组件类型（如 formula-card）；省略则列出全部类型。收窄后只带它引用到的共享类型。',
        },
      ],
      output:
        '{ source, uiDefaults, types: [{type, nullable, fields:[{name,type,optional}]}], sharedTypes }',
    },
    {
      action: 'prefs',
      summary:
        '列出当前预算的同步偏好与实验开关（实验开关全集取自本机 core 的 FeatureFlag 声明，取值取自预算 preferences 表）。',
      readOnly: true,
      args: [],
      output: '{ flagsSource, flags: [{flag,prefId,value,enabled}], enabledFlags, prefs }',
    },
    {
      action: 'source',
      needsBudget: false,
      summary:
        '检索本机官方源码：列路径 / 正则检索 / 读一份（core = 本机官方 CLI 源码，client = 服务端托管的界面源码）。',
      readOnly: true,
      args: [
        { prop: 'list', flag: 'list', type: 'boolean', description: '列出可读源码路径。' },
        {
          prop: 'grep',
          flag: 'grep',
          type: 'string',
          description: '正则检索源码，返回命中行（配 --context 给上下文行数，--max 限命中数）。',
        },
        {
          prop: 'file',
          flag: 'file',
          type: 'string',
          description: '读一份源码的正文（路径取自 --list；正文过大时会报错，请改用 --grep）。',
        },
        { prop: 'kind', flag: 'kind', type: 'string', description: KIND_DOC },
        {
          prop: 'match',
          flag: 'match',
          type: 'string',
          description: '仅 --list 时按子串过滤路径（如 reports/ 或 formula）。',
        },
        {
          prop: 'max',
          flag: 'max',
          type: 'string',
          description: '检索命中数上限，默认 40。',
        },
        {
          prop: 'context',
          flag: 'context',
          type: 'string',
          description: '每条命中的上下文行数，默认 0。',
        },
        {
          prop: 'maxAssets',
          flag: 'max-assets',
          type: 'string',
          description: '--kind client/all 时最多读几份客户端资产，默认 8；源码没找全时可加大。',
        },
      ],
      output: '{ mode, coverage, paths|matches|text }',
    },
    {
      action: 'report-options',
      needsBudget: false,
      summary: '列出报表定义的合法取值（实时区间、粒度、分组、口径、排序、模式）与静态区间写法。',
      readOnly: true,
      args: [
        {
          prop: 'verify',
          flag: 'verify',
          type: 'boolean',
          description:
            '额外用本机服务端的客户端源码逐字核对上表（拉 source map，默认 8 份）；核对结果里 missing 非空即说明本机客户端不认这些字面量。',
        },
        {
          prop: 'maxAssets',
          flag: 'max-assets',
          type: 'string',
          description: '--verify 时最多读几份客户端资产，默认 8。',
        },
      ],
      output: '{ dateRange, interval, groupBy, balanceType, sortBy, mode, verified? }',
    },
  ],
}
