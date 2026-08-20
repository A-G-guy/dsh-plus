/**
 * dsh 工具插件：text_transform。
 * 纯函数演示工具——无网络、无文件副作用，用于验证插件链路（注册 → 模型调用 → 结果渲染）。
 * @module @dsh-plus/tool-text-transform
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { isTransformOp, TRANSFORM_OPS, transformText } from '@dsh-plus/shared'

export const name = 'dsh-plus-text-transform'

export const inject = ['tools'] as const

const DESCRIPTION =
  'Transform a piece of text. Pure and side-effect free. ' +
  'Ops: uppercase | lowercase | reverse | length (code-point count).'

export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'text_transform',
      description: DESCRIPTION,
      parameters: {
        text: {
          type: 'string',
          required: true,
          description: 'The text to transform.',
        },
        op: {
          type: 'string',
          required: true,
          enum: [...TRANSFORM_OPS],
          description: 'Transform operation.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            result: { type: 'string', required: true },
          },
        },
        render: (_args, value: { result: string }) => [{ type: 'text', text: value.result }],
      },
      timeoutMs: 5_000,
      isConcurrencySafe: () => true,
      execute(args: { text: string; op: string }) {
        if (!isTransformOp(args.op)) {
          throw new Error(`text_transform: unknown op ${JSON.stringify(args.op)}`)
        }
        return { result: transformText(args.text, args.op) }
      },
    }),
  )
}
