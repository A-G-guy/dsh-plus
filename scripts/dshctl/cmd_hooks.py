"""dshctl init-hooks：安装 projects-go git 钩子（pre-commit / commit-msg / pre-push）。

门禁统一由 projects-go 承载（配置 projects.go.toml，只记录与默认的偏差）；钩子清单、
触发时机与失败处理见 docs/repo/仓库管理规范.md「提交与门槛」。
钩子为 per-clone：每个新 clone 执行一次本命令。
"""
from __future__ import annotations

import shutil

from .common import REPO_ROOT, fail, run


def cmd_init_hooks(_args) -> None:
    if shutil.which("projects-go") is None:
        fail("projects-go 不在 PATH：先安装 projects-go，再重跑 dshctl.py init-hooks")
    # 存在外来钩子时 projects-go 拒绝安装（exit 1，原文提示 --force）；
    # --force 会把原钩子备份为 <name>.projects-go.bak，替换前须确认其检查已迁走。
    run(["projects-go", "hook", "install"], cwd=REPO_ROOT)
    print("[hooks] 已安装 projects-go 钩子：pre-commit（文档/索引/行数/体量/结构/密钥/混码）、"
          "commit-msg（提交信息）、pre-push（force-push 拦截）")
    print("[hooks] 机器本地钩子不入库：新 clone 需再执行一次本命令；"
          "projects-go 二进制移动后执行 projects-go hook install --force 重装")
