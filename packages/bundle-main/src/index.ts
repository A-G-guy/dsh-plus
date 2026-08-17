/**
 * dsh-plus 聚合 bundle。
 * 自身不注册任何服务；价值全在 cordis.patch.yml——按序 insert 本仓库各插件行，
 * 作为 profile `dsh.profile.bundles` 中的"一键引入"层。单插件仍可脱离本包独立安装。
 * @module @dsh-plus/bundle-main
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-plus-bundle-main'

export function apply(_ctx: Context): void {
  // 编排由 cordis.patch.yml 声明，这里无需运行期逻辑。
}
