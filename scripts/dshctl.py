#!/usr/bin/env python3
"""dshctl：dsh-plus 仓库的开发/分发入口。

子命令总览：
  doctor [--release]     环境体检；--release 附加 npm 版本对照
  init-hooks             部署 pre-commit 链
  new-plugin <名>        脚手架新插件（--type tool/service/persona/ui）
  lint [--write]         biome 静态检查；--write 自动修复
  test                   静态检查 + 构建 + 全部单测（无网络、零费用）
  smoke                  headless 工具调用冒烟（mock LLM，零费用）
  smoke-prod             生产布局回归（scratch home + tgz 安装，不碰生产）
  dev up|down|restart    dev 实例一键启停（~/.dsh-dev + mock LLM + :3082）
  dev init|link|status   初始化 / 重链 workspace 包 / 查看状态
  dev logs [名]          查看 mock-llm / dsh-web-dev 日志尾部
  dev seed [--reset]     造 mock 会话数据（仅 ~/.dsh-dev，供 UI 调试）
  hl <任务>              无头调试：headless profile + mock 跑一轮，终答打终端
  pw open|status|close   dev GUI 的 playwright 持久会话
  pw run -- <命令>       转发任意 playwright-cli 命令（截图/快照/追踪）
  session list|new|send|open   经 RPC 操作 dev 会话（免 DOM 点击）
  chat -w 工作区 -m 消息 一键：工作区 → 会话 → 发消息
  mock run --session S   向指定会话注入 mock 内容（回复/工具/todo/斜杠命令）
  pack [包...]           构建并打包 tarball 到 dist/
  platform-sync <版本>   校验 npm 可用性并统一全仓平台钉版
  release status|bump|publish  npm 发版（token 自动读取，幂等跳过已发版本）
  finish [包...] [-m 信息]     收尾一条龙：测试→bump→提交→push→发布→本机安装
  install-prod <包>      vendor tarball 装进生产 profile（--dry-run 预览）
  uninstall-prod <包>    从生产 profile 移除（含传递闭包与孤儿 vendor tgz）
  restart-prod           确认后重启生产 web 服务（systemctl）
  url [--dev] [--host H] 输出当前进程认证链接（含启动令牌；令牌随重启更新）

环境变量 DSHCTL_VERBOSE=1：命令回显 + 子命令输出原文全量透传。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dshctl.cmd_dev import (cmd_dev_down, cmd_dev_init, cmd_dev_link,
                            cmd_dev_logs, cmd_dev_restart, cmd_dev_status,
                            cmd_dev_up)
from dshctl.cmd_doctor import cmd_doctor, cmd_test
from dshctl.cmd_finish import cmd_finish
from dshctl.cmd_headless import cmd_hl
from dshctl.cmd_hooks import cmd_init_hooks
from dshctl.cmd_lint import cmd_lint
from dshctl.cmd_mock import cmd_mock_run
from dshctl.cmd_pack import (cmd_install_prod, cmd_pack, cmd_restart_prod,
                             cmd_uninstall_prod)
from dshctl.cmd_platform import cmd_platform_sync
from dshctl.cmd_plugin import cmd_new_plugin
from dshctl.cmd_pw import (cmd_pw_close, cmd_pw_open, cmd_pw_run,
                           cmd_pw_status)
from dshctl.cmd_release import (cmd_release_bump, cmd_release_publish,
                                cmd_release_status)
from dshctl.cmd_seed import cmd_dev_seed
from dshctl.cmd_session import (cmd_chat, cmd_session_list, cmd_session_new,
                                cmd_session_open, cmd_session_send)
from dshctl.cmd_smoke import cmd_smoke, cmd_smoke_prod
from dshctl.cmd_url import cmd_url
from dshctl.common import DEV_PORT
from dshctl.pwcli import DEFAULT_SESSION


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="dshctl", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    doc = sub.add_parser("doctor")
    doc.add_argument("--release", action="store_true",
                     help="附加 release status 对照（需网络查询 npm registry）")
    doc.set_defaults(func=cmd_doctor)
    sub.add_parser("init-hooks").set_defaults(func=cmd_init_hooks)
    lint = sub.add_parser("lint",
                          help="biome 静态检查（lint + format + import 整理）")
    lint.add_argument("--write", action="store_true",
                      help="自动修复并格式化（biome check --write）")
    lint.set_defaults(func=cmd_lint)
    sub.add_parser("test").set_defaults(func=cmd_test)
    sub.add_parser("smoke").set_defaults(func=cmd_smoke)
    smp = sub.add_parser("smoke-prod",
                         help="生产布局回归：scratch home + tgz 安装 + bash 工具调用")
    smp.add_argument("--linker", choices=["hoisted", "isolated"],
                     help="被测 nodeLinker 布局，缺省读生产 profile 当前值")
    smp.set_defaults(func=cmd_smoke_prod)
    sub.add_parser("restart-prod").set_defaults(func=cmd_restart_prod)

    urlp = sub.add_parser("url", help="输出当前进程认证链接（含启动令牌；令牌随重启更新）")
    urlp.add_argument("--dev", action="store_true", help="目标 dev 实例（缺省生产）")
    urlp.add_argument("--port", type=int, default=DEV_PORT, help="dev 端口（仅 --dev）")
    urlp.add_argument("--host", help="生成指定 authority 变体，如 miniserver.example:3080")
    urlp.add_argument("--scheme", default="http", choices=["http", "https"])
    urlp.set_defaults(func=cmd_url)

    newp = sub.add_parser("new-plugin")
    newp.add_argument("name", help="包目录名，小写 kebab-case，如 tool-weather")
    newp.add_argument("--type", choices=["tool", "service", "persona", "ui"],
                      default="tool")
    newp.set_defaults(func=cmd_new_plugin)

    dev = sub.add_parser("dev", help="dev 实例（~/.dsh-dev + mock LLM + :3082）")
    dev_sub = dev.add_subparsers(dest="dev_command", required=True)
    dev_sub.add_parser("init").set_defaults(func=cmd_dev_init)
    dev_sub.add_parser("link").set_defaults(func=cmd_dev_link)
    up = dev_sub.add_parser("up", help="构建 + 重链 + 拉起 mock-llm 与 dev web")
    up.add_argument("--fast", action="store_true",
                    help="跳过构建与重链，只拉起进程（改了源码请用完整 up）")
    up.set_defaults(func=cmd_dev_up)
    dev_sub.add_parser("down", help="停止 mock-llm 与 dev web").set_defaults(
        func=cmd_dev_down)
    rst = dev_sub.add_parser("restart", help="down + up 一步完成")
    rst.add_argument("--fast", action="store_true", help="同 up --fast")
    rst.set_defaults(func=cmd_dev_restart)
    dev_sub.add_parser("status").set_defaults(func=cmd_dev_status)
    logs = dev_sub.add_parser("logs", help="查看守护进程日志尾部（缺省两个都打）")
    logs.add_argument("name", nargs="?", choices=["mock-llm", "dsh-web-dev"])
    logs.add_argument("-n", "--lines", type=int, default=40, help="行数，默认 40")
    logs.set_defaults(func=cmd_dev_logs)
    seed = dev_sub.add_parser("seed", help="自动 mock 会话数据（仅 ~/.dsh-dev）")
    seed.add_argument("--reset", action="store_true", help="先清空既有 seed 会话分组")
    seed.set_defaults(func=cmd_dev_seed)

    hl = sub.add_parser("hl", help="无头调试：headless profile + mock 跑一轮，终答打终端")
    hl.add_argument("task", nargs="*", help="任务文本（多词自动拼接；--spec 时可省）")
    hl.add_argument("--spec", help="场景 spec JSON 文件（{prompt?, entries, marker?}）")
    hl.add_argument("--reply", help="脚本化终答文本")
    hl.add_argument("--thinking", help="模型思考内容（reasoning_content）")
    hl.add_argument("--tool", help="模拟工具调用：工具名")
    hl.add_argument("--args", help="模拟工具调用：参数 JSON")
    hl.add_argument("--then", help="工具/todo 之后的脚本化终答")
    hl.add_argument("--match", help="首条目的 match 子串（缺省取任务原文）")
    hl.add_argument("--then-match", help="终答条目的 match 子串（缺省匹配任意请求）")
    hl.add_argument("--todo", help="生成 todo：分号分隔的任务列表")
    hl.add_argument("--todo-status", choices=["pending", "in_progress", "completed"],
                    default="pending")
    hl.add_argument("--marker", help="完成后在输出中校验的标记子串")
    hl.add_argument("--timeout", type=float, default=120.0, help="超时秒数，默认 120")
    hl.set_defaults(func=cmd_hl, command=None)

    pw = sub.add_parser("pw", help="dev GUI 的 playwright 持久会话（创建或连接）")
    pw_sub = pw.add_subparsers(dest="pw_command", required=True)
    for name, func, helptext in (
            ("open", cmd_pw_open, "创建或连接已有会话并定位到 dev GUI"),
            ("status", cmd_pw_status, "查看会话状态与当前页"),
            ("close", cmd_pw_close, "关闭会话"),
            ("run", cmd_pw_run, "转发任意 playwright-cli 命令（截图/快照/追踪）")):
        p = pw_sub.add_parser(name, help=helptext)
        p.add_argument("--name", default=DEFAULT_SESSION, help="会话名，默认 dsh-dev")
        p.add_argument("--url", help=f"默认 http://127.0.0.1:{DEV_PORT}")
        if name == "run":
            p.add_argument("args", nargs=argparse.REMAINDER,
                           help="playwright-cli 参数（建议以 -- 开头），"
                                "如: pw run -- screenshot --filename out.png")
        p.set_defaults(func=func)

    sess = sub.add_parser("session", help="经 HTTP RPC 操作 dev 会话（免 DOM 点击）")
    sess_sub = sess.add_subparsers(dest="session_command", required=True)
    sl = sess_sub.add_parser("list", help="列出会话")
    sl.add_argument("--workspace", help="按工作区过滤（id/路径/标题）")
    sl.add_argument("--port", type=int, default=DEV_PORT)
    sl.set_defaults(func=cmd_session_list)
    sn = sess_sub.add_parser("new", help="新建会话")
    src = sn.add_mutually_exclusive_group()
    src.add_argument("--workspace", help="工作区（id/路径/标题，路径未注册则创建）")
    src.add_argument("--cwd", help="直接用 cwd 创建（不挂工作区）")
    sn.add_argument("--title", help="创建后重命名")
    sn.add_argument("--port", type=int, default=DEV_PORT)
    sn.set_defaults(func=cmd_session_new)
    ss = sess_sub.add_parser("send", help="向会话发送消息（mock 护栏强制）")
    ss.add_argument("session", help="sessionId 前缀或标题子串")
    ss.add_argument("message", nargs="+", help="消息文本（多词自动拼接）")
    ss.add_argument("--mode", choices=["queue", "steer"], default="queue")
    ss.add_argument("--port", type=int, default=DEV_PORT)
    ss.set_defaults(func=cmd_session_send)
    so = sess_sub.add_parser("open", help="在 pw 浏览器会话中选中该会话")
    so.add_argument("session", help="sessionId 前缀或标题子串")
    so.add_argument("--port", type=int, default=DEV_PORT)
    so.set_defaults(func=cmd_session_open)

    chat = sub.add_parser("chat", help="一键：选定工作区 →（新建或复用）会话 → 发送消息")
    chat.add_argument("--workspace", "-w", required=True, help="工作区（id/路径/标题）")
    chat.add_argument("--message", "-m", required=True, help="消息文本")
    chat.add_argument("--new", action="store_true", help="强制新建会话（缺省复用最新）")
    chat.add_argument("--wait", action="store_true", help="等待执行完毕（转空闲）")
    chat.add_argument("--timeout", type=float, default=120.0, help="--wait 的超时秒数")
    chat.add_argument("--open", action="store_true", help="发送后在浏览器中定位该会话")
    chat.add_argument("--port", type=int, default=DEV_PORT)
    chat.set_defaults(func=cmd_chat)

    mock = sub.add_parser("mock", help="向指定 dev 会话注入 mock 内容（零 API 费用）")
    mock_sub = mock.add_subparsers(dest="mock_command", required=True)
    mr = mock_sub.add_parser("run", help="注入并执行一轮 mock 内容")
    mr.add_argument("--session", required=True, help="目标会话（id 前缀或标题子串）")
    mr.add_argument("--spec", help="场景 spec JSON 文件（{prompt?, entries, title?, marker?}）")
    mr.add_argument("--prompt", help="触发该轮的用户消息（缺省自动生成占位文本）")
    mr.add_argument("--reply", help="脚本化终答文本")
    mr.add_argument("--thinking", help="模型思考内容（reasoning_content）")
    mr.add_argument("--tool", help="模拟工具调用：工具名")
    mr.add_argument("--args", help="模拟工具调用：参数 JSON")
    mr.add_argument("--then", help="工具/todo 之后的脚本化终答")
    mr.add_argument("--match", help="首条目的 match 子串（缺省取 prompt 原文）")
    mr.add_argument("--then-match", help="终答条目的 match 子串（缺省匹配任意请求）")
    mr.add_argument("--todo", help="生成 todo：分号分隔的任务列表")
    mr.add_argument("--todo-status", choices=["pending", "in_progress", "completed"],
                    default="pending")
    mr.add_argument("--command", help="模拟执行斜杠命令，如 '/plan 做某某'（真实执行，不经模型）")
    mr.add_argument("--marker", help="完成后在会话历史中校验的标记子串")
    mr.add_argument("--title", help="完成后重命名会话（mock 标题为回显，建议显式命名）")
    mr.add_argument("--timeout", type=float, default=120.0, help="等待空闲的超时秒数")
    mr.add_argument("--open", action="store_true", help="完成后在浏览器中定位该会话")
    mr.add_argument("--port", type=int, default=DEV_PORT)
    mr.set_defaults(func=cmd_mock_run)

    pack = sub.add_parser("pack")
    pack.add_argument("packages", nargs="*", help="留空打包全部")
    pack.set_defaults(func=cmd_pack)

    ps = sub.add_parser("platform-sync",
                        help="校验 npm 可用性并把全仓 dsh 平台钉版统一到指定版本")
    ps.add_argument("version", help="目标平台版本（如 0.1.2-alpha.2）")
    ps.set_defaults(func=cmd_platform_sync)

    rel = sub.add_parser("release", help="npm 发版（官方 registry，幂等跳过已发版本）")
    rel_sub = rel.add_subparsers(dest="release_command", required=True)
    rs = rel_sub.add_parser("status", help="本地版本与 npm 已发版本对照")
    rs.add_argument("packages", nargs="*", help="留空对照全部")
    rs.set_defaults(func=cmd_release_status)
    rb = rel_sub.add_parser("bump", help="版本号递增")
    rb.add_argument("package", help="包名（@dsh-plus/xxx 或目录名）")
    rb.add_argument("spec", help="patch/minor/major 或显式 x.y.z（必须大于当前）")
    rb.set_defaults(func=cmd_release_bump)
    rp = rel_sub.add_parser("publish", help="测试守门后按依赖序发布到 npm")
    rp.add_argument("packages", nargs="*", help="留空发布全部")
    rp.add_argument("--skip-tests", action="store_true", help="跳过发版前测试守门")
    rp.set_defaults(func=cmd_release_publish)

    fin = sub.add_parser("finish", help="开发收尾一条龙：测试→bump→提交→push→npm 发布→本机安装")
    fin.add_argument("packages", nargs="*",
                     help="留空自动识别工作区有改动的包；目标均级联 client 打苞依赖方")
    fin.add_argument("-m", "--message",
                     help="Conventional Commits 提交信息（缺省交互询问）")
    fin.add_argument("--bump", default="patch", metavar="规格",
                     help="版本递增 patch/minor/major 或 x.y.z，默认 patch")
    fin.add_argument("--skip-tests", action="store_true", help="跳过第 1 步测试守门")
    fin.add_argument("--no-bump", action="store_true", help="跳过第 2 步版本递增")
    fin.add_argument("--no-commit", action="store_true", help="跳过第 3 步 git 提交")
    fin.add_argument("--no-push", action="store_true", help="跳过第 4 步 git push")
    fin.add_argument("--no-publish", action="store_true", help="跳过第 5 步 npm 发布")
    fin.add_argument("--no-install", action="store_true",
                     help="跳过第 6 步本机安装（install-prod，重启始终不在链路内）")
    fin.set_defaults(func=cmd_finish)

    inst = sub.add_parser("install-prod")
    inst.add_argument("package")
    inst.add_argument("--restart", action="store_true", help="安装后交互确认并重启 dsh-web")
    inst.add_argument("--dry-run", action="store_true",
                      help="只预览闭包/依赖图/将写入的 spec，不写任何文件")
    inst.set_defaults(func=cmd_install_prod)

    uninst = sub.add_parser("uninstall-prod")
    uninst.add_argument("package")
    uninst.set_defaults(func=cmd_uninstall_prod)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
