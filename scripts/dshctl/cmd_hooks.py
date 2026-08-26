"""dshctl init-hooks：部署 pre-commit 门槛 + md-doc-timestamp 时间戳链。

链式结构（md-doc-timestamp 中央 hook 在先，本仓库行数门槛作为 legacy 被调用）：
  scripts/git-hooks/pre-commit → 软链接到 md-doc-timestamp 中央 hook
  scripts/git-hooks/pre-commit.md-doc-timestamp-legacy → 行数门槛 wrapper
"""
from __future__ import annotations

import os
import stat
import subprocess

from .common import REPO_ROOT, TS_HOOK_REPO, fail, read_json, run, write_json

HOOKS_DIR = REPO_ROOT / "scripts" / "git-hooks"
GATE_WRAPPER = """\
#!/usr/bin/env sh
# dsh-plus pre-commit 行数门槛 wrapper（由 dshctl init-hooks 生成，机器本地文件）
set -eu
cd "$(git rev-parse --show-toplevel)"
exec python3 scripts/pre_commit_gate.py
"""
DOC_TIMESTAMP_CONFIG = REPO_ROOT / ".md-doc-timestamp.json"


def _write_gate_wrapper() -> None:
    HOOKS_DIR.mkdir(parents=True, exist_ok=True)
    wrapper = HOOKS_DIR / "pre-commit"
    wrapper.write_text(GATE_WRAPPER, encoding="utf-8")
    wrapper.chmod(wrapper.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP)
    print(f"[hooks] 行数门槛 wrapper 已写入 {wrapper}")


def _sync_doc_roots() -> None:
    """doc_roots = 仓库级 docs + 插件级 docs 的 glob（md-doc-timestamp 已支持通配）。"""
    data = {"doc_roots": ["docs", "packages/*/docs"]}
    if DOC_TIMESTAMP_CONFIG.exists() and read_json(DOC_TIMESTAMP_CONFIG) == data:
        return
    write_json(DOC_TIMESTAMP_CONFIG, data)
    print(f"[hooks] .md-doc-timestamp.json doc_roots → {data['doc_roots']}")


def _install_timestamp_hook() -> None:
    """调用 md-doc-timestamp 的 install_project（仅本仓库，不走批量入口）。

    该工具为外部可选依赖：未配置（DSHCTL_TS_HOOK_REPO / local_config）时跳过，
    pre-commit 仅保留行数门槛。
    """
    if TS_HOOK_REPO is None:
        print("[hooks] 未配置 md-doc-timestamp-hook（DSHCTL_TS_HOOK_REPO），"
              "跳过文档时间戳链")
        return
    if not (TS_HOOK_REPO / "src/md_doc_timestamp/install.py").exists():
        fail(f"md-doc-timestamp-hook 仓库不存在: {TS_HOOK_REPO}")
    snippet = (
        "from pathlib import Path;"
        "from md_doc_timestamp.install import install_project;"
        f"r = install_project(Path({str(REPO_ROOT)!r}), Path({str(TS_HOOK_REPO)!r}));"
        "print(f'{r.status}: {r.message}')"
    )
    env = dict(os.environ, PYTHONPATH=str(TS_HOOK_REPO / "src"))
    out = run(["python3", "-c", snippet], env=env)
    print(f"[hooks] md-doc-timestamp: {out.stdout.strip()}")


def cmd_init_hooks(_args) -> None:
    run(["git", "config", "core.hooksPath", "scripts/git-hooks"], cwd=REPO_ROOT)
    _write_gate_wrapper()
    if TS_HOOK_REPO is not None:
        _sync_doc_roots()
    _install_timestamp_hook()
    if TS_HOOK_REPO is not None:
        print("[hooks] 完成。提交时将依次执行: 文档时间戳更新 → 行数门槛(500警告/800拦截)")
    else:
        print("[hooks] 完成。提交时执行: 行数门槛(500警告/800拦截)")
