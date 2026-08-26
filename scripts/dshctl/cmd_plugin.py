"""dshctl new-plugin：脚手架生成插件包，并同步 doc_roots 与 bundle-main 编排。

支持类型：tool（工具）/ service（cordis 服务）/ persona（提示词）/ ui（客户端界面）。
ui 与 persona 模板为起步骨架，关键扩展点以注释标注，权威契约见 docs/reference。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .common import PACKAGES_DIR, REPO_ROOT, fail, read_json, write_json

PKG_JSON = """\
{{
  "name": "@dsh-plus/{dir}",
  "version": "0.1.0",
  "description": "dsh-plus {kind} plugin: {dir}",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {{
    ".": {{ "types": "./lib/index.d.ts", "default": "./lib/index.js" }},
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  }},
  "files": ["lib", "src"],
  "scripts": {{ "build": "tsdown src/index.ts -d lib --format esm --dts" }},
  "dependencies": {{
    "@dsh-plus/shared": "workspace:*"
  }},
  "peerDependencies": {{
    "@deepseek-ai/cordis": "^4.0.1"
  }},
  "devDependencies": {{
    "@deepseek-ai/cordis": "4.0.1"
  }},
  "publishConfig": {{ "access": "public" }}
}}
"""

TOOL_SRC = """\
/**
 * dsh 工具插件模板。契约权威来源：docs/reference/官方机制参照.md
 * @module @dsh-plus/{dir}
 */
import type {{ Context }} from '@deepseek-ai/cordis'
import {{ defineTool }} from '@deepseek-ai/dsh-tools'

export const name = 'dsh-plus-{dir}'
export const inject = ['tools'] as const

export function apply(ctx: Context): void {{
  ctx.tools.register(defineTool({{
    name: '{tool_name}',
    description: 'TODO: 一句话说明这个工具做什么、何时该用。',
    parameters: {{
      input: {{ type: 'string', required: true, description: 'TODO' }},
    }},
    output: {{
      schema: {{
        type: 'object',
        additionalProperties: false,
        properties: {{ result: {{ type: 'string', required: true }} }},
      }},
      render: (_args, value: {{ result: string }}) => [{{ type: 'text', text: value.result }}],
    }},
    timeoutMs: 30_000,
    execute(args: {{ input: string }}) {{
      return {{ result: `TODO: ${{args.input}}` }}
    }},
  }}))
}}
"""

SERVICE_SRC = """\
/**
 * dsh cordis 服务插件模板：provide 一个服务供其他插件 inject（插件联动的正统方式）。
 * @module @dsh-plus/{dir}
 */
import type {{ Context }} from '@deepseek-ai/cordis'

export const name = 'dsh-plus-{dir}'

declare module '@deepseek-ai/cordis' {{
  interface Context {{
    {serviceKey}: {class_name}
  }}
}}

export class {class_name} {{
  static [Context.inject] = [] as string[]
  constructor(_ctx: Context) {{}}
  ping(): string {{ return 'pong' }}
}}

export function apply(ctx: Context): void {{
  ctx.provide('{serviceKey}')
  ctx.plugin({class_name})
}}
"""

PERSONA_SRC = """\
/**
 * dsh 提示词/persona 插件模板。
 * 扩展点：systemPrompt 服务提供 section 注册（见 docs/reference 的 dsh-agent-instructions 条目），
 * 或通过 bundle/profile 的 cordis.patch.yml 覆盖 id=system-prompt 行的 persona 文本。
 * @module @dsh-plus/{dir}
 */
import type {{ Context }} from '@deepseek-ai/cordis'

export const name = 'dsh-plus-{dir}'
export const inject = ['systemPrompt'] as const

export function apply(ctx: Context): void {{
  // TODO: 确认 systemPrompt 服务的 section 注册 API 后实现；临时方案见模块注释的 patch 路线。
  void ctx
}}
"""

UI_SRC = """\
/**
 * dsh UI 插件模板（node 半）。浏览器半见 src/client.ts，经 ./client 导出 + tsdown 构建，
 * 由 dsh-client-modules 扫描进 __DSH_BOOT__；dsh-client-hmr 轮询构建产物实现热更。
 * 挂载点：dsh-client-ui-slots 的插槽体系（契约见 docs/reference）。
 * @module @dsh-plus/{dir}
 */
import type {{ Context }} from '@deepseek-ai/cordis'

export const name = 'dsh-plus-{dir}'

export function apply(_ctx: Context): void {{
  // node 半：通常仅声明 client 模块；需要服务端配合时在此注册服务/工具。
}}
"""

TEMPLATES = {"tool": TOOL_SRC, "service": SERVICE_SRC, "persona": PERSONA_SRC, "ui": UI_SRC}


def _scaffold(pkg_dir: Path, kind: str, short: str) -> None:
    (pkg_dir / "src").mkdir(parents=True)
    (pkg_dir / "docs").mkdir()
    class_name = "".join(part.title() for part in re.split(r"[-_]", short)) + "Service"
    src = TEMPLATES[kind].format(dir=pkg_dir.name, tool_name=short.replace("-", "_"),
                                 class_name=class_name, serviceKey=short.replace("-", "_"))
    (pkg_dir / "package.json").write_text(PKG_JSON.format(dir=pkg_dir.name, kind=kind),
                                          encoding="utf-8")
    (pkg_dir / "src/index.ts").write_text(src, encoding="utf-8")
    docs = pkg_dir / "docs/README.md"
    docs.write_text(f"---\nlast_modified: \"1970-01-01 00:00\"\n---\n\n"
                    f"# @dsh-plus/{pkg_dir.name} 文档索引\n\n- （待补充：契约、配置项、使用示例）\n",
                    encoding="utf-8")


def _register_in_bundle(pkg_dir: Path) -> None:
    bundle = PACKAGES_DIR / "bundle-main"
    patch = bundle / "cordis.patch.yml"
    meta = read_json(pkg_dir / "package.json")
    row = f"    - id: dsh-plus-{pkg_dir.name}\n      name: '{meta['name']}'\n"
    text = patch.read_text(encoding="utf-8")
    if meta["name"] in text:
        return
    patch.write_text(text.rstrip("\n") + "\n" + row, encoding="utf-8")
    deps = read_json(bundle / "package.json")
    deps.setdefault("dependencies", {})[meta["name"]] = "workspace:*"
    write_json(bundle / "package.json", deps)
    print(f"[new-plugin] 已登记进 bundle-main: {meta['name']}")


def cmd_new_plugin(args) -> None:
    if not re.fullmatch(r"[a-z][a-z0-9-]*", args.name):
        fail("插件名必须是小写 kebab-case（如 tool-weather）")
    pkg_dir = PACKAGES_DIR / args.name
    if pkg_dir.exists():
        fail(f"包已存在: {pkg_dir}")
    _scaffold(pkg_dir, args.type, args.name)
    if args.type == "tool":
        pkg = read_json(pkg_dir / "package.json")
        # 平台包一律 peer（宿主提供单实例）+ dev 精确版（供构建/类型）
        pkg["peerDependencies"]["@deepseek-ai/dsh-tools"] = "^0.1.0-rc.8"
        pkg["devDependencies"]["@deepseek-ai/dsh-tools"] = "0.1.0-rc.8"
        write_json(pkg_dir / "package.json", pkg)
    _register_in_bundle(pkg_dir)
    print(f"[new-plugin] 已创建 {pkg_dir}（type={args.type}）")
    print("下一步: pnpm install && pnpm -r build && python3 scripts/dshctl.py dev link")
