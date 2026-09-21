"""Search Services skill 环境变量加载器。

从用户私有 env 文件加载变量到当前 Python 进程环境，避免在脚本中硬编码密钥。
"""

from __future__ import annotations

import os
import re
from pathlib import Path


DEFAULT_ENV_FILE = Path.home() / ".config" / "search-services" / "env"


def _strip_shell_quotes(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]
    return value


def load_env_file(path: str | None = None, *, override: bool = False) -> None:
    """加载 export KEY=value 格式的私有 env 文件。

    默认不覆盖已存在的环境变量；可用 SEARCH_SERVICES_ENV_FILE 指定路径。
    """

    env_path = Path(path or os.getenv("SEARCH_SERVICES_ENV_FILE", "") or DEFAULT_ENV_FILE).expanduser()
    if not env_path.is_file():
        return

    pattern = re.compile(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$")
    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            match = pattern.match(line)
            if not match:
                continue
            key, value = match.group(1), _strip_shell_quotes(match.group(2))
            if override or key not in os.environ:
                os.environ[key] = value
    except OSError:
        return
