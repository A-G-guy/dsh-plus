#!/usr/bin/env python3
"""可选 Playwright 渲染 fetch 后端。

该脚本通过 playwright-cli 在 headless Chromium 中打开页面，等待动态内容渲染，
抽取正文后复用 fetch.py 的清理和质量评估逻辑。它是本地 fetch 的增强层：
默认不被普通 fetch 启动，只在 search.py fetch 的自动 JS 判断或显式 --with-js /
--service playwright 时使用。
"""

from __future__ import annotations

import argparse
import atexit
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import fetch as local_fetch  # noqa: E402


DEFAULT_SELECTOR = "main, article, [role='main'], .content, #content, .post, .entry-content"
_ACTIVE_PGIDS: set[int] = set()
_ACTIVE_BROWSER_PIDS: set[int] = set()
_TEMP_DIRS: set[str] = set()


class PlaywrightUnavailable(RuntimeError):
    """Playwright CLI 不可用。"""

    def __init__(self, message: str, *, details: Any = None):
        super().__init__(message)
        self.details = details


class PlaywrightError(RuntimeError):
    """Playwright fetch 失败。"""

    def __init__(self, message: str, *, details: Any = None):
        super().__init__(message)
        self.details = details


def _safe_rmtree(path: str) -> None:
    """只清理本脚本创建的 /tmp 临时目录，避免误删。"""

    real = os.path.realpath(path)
    if not real.startswith("/tmp/search-services-pw-"):
        return
    shutil.rmtree(real, ignore_errors=True)


def _cleanup() -> None:
    for pgid in list(_ACTIVE_PGIDS):
        try:
            os.killpg(pgid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except OSError:
            pass
    time.sleep(0.1)
    for pgid in list(_ACTIVE_PGIDS):
        try:
            os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except OSError:
            pass
    for pid in list(_ACTIVE_BROWSER_PIDS):
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except OSError:
            pass
    time.sleep(0.1)
    for pid in list(_ACTIVE_BROWSER_PIDS):
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except OSError:
            pass
    for temp_dir in list(_TEMP_DIRS):
        _safe_rmtree(temp_dir)
        _TEMP_DIRS.discard(temp_dir)


def _handle_signal(signum: int, _frame: Any) -> None:
    _cleanup()
    raise SystemExit(128 + signum)


atexit.register(_cleanup)
for _sig in (signal.SIGINT, signal.SIGTERM):
    try:
        signal.signal(_sig, _handle_signal)
    except (ValueError, OSError):
        pass


def _playwright_command_base() -> list[str]:
    configured = os.getenv("PLAYWRIGHT_CLI") or os.getenv("PWCLI")
    if configured:
        path = os.path.expanduser(configured)
        if os.path.exists(path) or shutil.which(path):
            return [path]
        raise PlaywrightUnavailable(f"PLAYWRIGHT_CLI/PWCLI 指向的命令不存在: {configured}")

    global_cli = shutil.which("playwright-cli")
    if global_cli:
        return [global_cli]

    codex_home = os.getenv("CODEX_HOME") or os.path.join(os.path.expanduser("~"), ".codex")
    wrapper = os.path.join(codex_home, "skills", "playwright-headless", "scripts", "playwright_cli.sh")
    if os.path.exists(wrapper):
        return [wrapper]

    npx = shutil.which("npx")
    if npx:
        return [npx, "--yes", "--package", "@playwright/cli", "playwright-cli"]

    raise PlaywrightUnavailable("缺少 npx/playwright-cli，无法使用 Playwright 渲染 fetch")


def _playwright_retries(value: Optional[int]) -> int:
    retries = int(os.getenv("PLAYWRIGHT_RETRIES") or "0") if value is None else max(0, value)
    return min(retries, int(os.getenv("PLAYWRIGHT_MAX_RETRIES") or "1"))


def _write_proxy_config(temp_dir: str, proxy: Optional[str]) -> Optional[str]:
    proxy_url = local_fetch.normalize_proxy_url(proxy)
    if not proxy_url:
        return None
    config_dir = Path(temp_dir) / ".playwright"
    config_dir.mkdir(parents=True, exist_ok=True)
    config_path = config_dir / "cli.config.json"
    config_path.write_text(json.dumps({
        "browser": {
            "launchOptions": {
                "headless": True,
                "proxy": {"server": proxy_url},
            }
        }
    }, ensure_ascii=False), encoding="utf-8")
    return str(config_path)


def _open_command(base: list[str], session: str, url: str, config_path: Optional[str]) -> list[str]:
    cmd = base + ["--session", session, "open", url]
    if config_path:
        cmd.extend(["--config", config_path])
    return cmd


def _run_checked_with_retries(cmd: list[str], *, timeout: float, cwd: str, retries: int, retry_delay: float = 0.75) -> str:
    last_error: Optional[PlaywrightError] = None
    for attempt in range(retries + 1):
        try:
            return _run_checked(cmd, timeout=timeout, cwd=cwd)
        except PlaywrightError as exc:
            last_error = exc
            if attempt >= retries:
                break
            time.sleep(min(3.0, retry_delay * (1.6 ** attempt)))
    if last_error is not None:
        raise last_error
    raise PlaywrightError("Playwright 命令失败")


def _run_command(cmd: list[str], *, timeout: float, cwd: str) -> tuple[int, str, str]:
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=cwd,
        start_new_session=True,
    )
    try:
        pgid = os.getpgid(proc.pid)
        _ACTIVE_PGIDS.add(pgid)
    except OSError:
        pgid = None
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
        return proc.returncode, stdout, stderr
    except subprocess.TimeoutExpired as exc:
        if pgid is not None:
            try:
                os.killpg(pgid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            except OSError:
                pass
            time.sleep(0.2)
            try:
                os.killpg(pgid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except OSError:
                pass
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
        raise PlaywrightError(f"Playwright 命令超时: {' '.join(cmd[-3:])}", details={"timeout": timeout}) from exc
    finally:
        if pgid is not None:
            _ACTIVE_PGIDS.discard(pgid)


def _run_checked(cmd: list[str], *, timeout: float, cwd: str) -> str:
    code, stdout, stderr = _run_command(cmd, timeout=timeout, cwd=cwd)
    if code != 0:
        raise PlaywrightError(
            f"Playwright 命令失败，退出码 {code}",
            details={"cmdTail": cmd[-4:], "stdout": stdout[-2000:], "stderr": stderr[-2000:]},
        )
    return stdout


def _extract_browser_pid(output: str) -> Optional[int]:
    match = re.search(r"opened with pid\s+(\d+)", output)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def _extract_cli_result(output: str) -> Any:
    match = re.search(r"### Result\s*\n(?P<value>.*?)(?:\n### |\Z)", output, re.S)
    if not match:
        raise PlaywrightError("无法解析 playwright-cli eval 结果", details={"stdout": output[-2000:]})
    raw = match.group("value").strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise PlaywrightError("playwright-cli eval 返回的结果不是 JSON", details={"raw": raw[:1000]}) from exc
    if isinstance(parsed, str):
        try:
            return json.loads(parsed)
        except json.JSONDecodeError:
            return parsed
    return parsed


def _build_eval_script(*, wait_ms: int, selector: Optional[str], max_chars: int) -> str:
    selector_json = json.dumps(selector or "")
    default_selector_json = json.dumps(DEFAULT_SELECTOR)
    wait_ms = max(0, int(wait_ms))
    max_chars = max(1, int(max_chars))
    return f"""async () => {{
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  await sleep({wait_ms});
  const explicitSelector = {selector_json};
  const defaultSelector = {default_selector_json};
  const root = (explicitSelector ? document.querySelector(explicitSelector) : null)
    || document.querySelector(defaultSelector)
    || document.body
    || document.documentElement;
  const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
  const text = root ? (root.innerText || root.textContent || '') : '';
  return JSON.stringify({{
    url: location.href,
    title: document.title || '',
    description: meta ? (meta.getAttribute('content') || '') : '',
    text: text.slice(0, {max_chars * 2})
  }});
}}"""


def _clean_rendered_text(text: str, *, max_chars: int, markdownish: bool = True) -> tuple[str, bool]:
    cleaned = local_fetch.normalize_text(text or "")
    cleaned = local_fetch.filter_noise_lines(cleaned)
    if markdownish:
        cleaned = local_fetch.to_markdownish(cleaned)
    truncated = len(cleaned) > max_chars
    if truncated:
        cleaned = cleaned[:max_chars].rstrip()
    return cleaned, truncated


def fetch_one(
    url: str,
    *,
    timeout: Optional[float] = None,
    wait_ms: Optional[int] = None,
    selector: Optional[str] = None,
    max_chars: int = 20000,
    markdownish: bool = True,
    session: Optional[str] = None,
    proxy: Optional[str] = None,
    retries: Optional[int] = None,
) -> Dict[str, Any]:
    timeout = timeout or float(os.getenv("PLAYWRIGHT_TIMEOUT") or os.getenv("SEARCH_TIMEOUT") or "30")
    wait_ms = int(os.getenv("PLAYWRIGHT_WAIT_MS") or "1000") if wait_ms is None else wait_ms
    session = session or f"search-fetch-{os.getpid()}-{int(time.time() * 1000)}"
    temp_dir = tempfile.mkdtemp(prefix="search-services-pw-")
    _TEMP_DIRS.add(temp_dir)
    base = _playwright_command_base()
    config_path = _write_proxy_config(temp_dir, proxy)
    proxy_url = local_fetch.normalize_proxy_url(proxy)
    max_retries = _playwright_retries(retries)
    browser_pid: Optional[int] = None
    opened = False
    try:
        open_cmd = _open_command(base, session, url, config_path)
        open_out = _run_checked_with_retries(open_cmd, timeout=timeout, cwd=temp_dir, retries=max_retries)
        opened = True
        browser_pid = _extract_browser_pid(open_out)
        if browser_pid is not None:
            _ACTIVE_BROWSER_PIDS.add(browser_pid)

        eval_script = _build_eval_script(wait_ms=wait_ms, selector=selector, max_chars=max_chars)
        eval_timeout = timeout + max(1.0, wait_ms / 1000.0) + 2.0
        eval_cmd = base + ["--session", session, "eval", eval_script]
        eval_out = _run_checked(eval_cmd, timeout=eval_timeout, cwd=temp_dir)
        payload = _extract_cli_result(eval_out)
        if isinstance(payload, str):
            payload = {"url": url, "title": "", "description": "", "text": payload}
        text, truncated = _clean_rendered_text(payload.get("text") or "", max_chars=max_chars, markdownish=markdownish)
        result = {
            "ok": True,
            "url": payload.get("url") or url,
            "status": 200,
            "contentType": "text/html; rendered=playwright",
            "title": local_fetch.normalize_inline(payload.get("title") or ""),
            "description": local_fetch.normalize_inline(payload.get("description") or ""),
            "text": text,
            "truncated": truncated,
            "characters": len(text),
            "rendered": True,
            "waitMs": wait_ms,
            "selector": selector,
            "proxy": proxy_url,
        }
        return result
    except (PlaywrightUnavailable, PlaywrightError) as exc:
        return {
            "ok": False,
            "url": url,
            "service": "playwright",
            "rendered": True,
            "error": str(exc),
            "details": getattr(exc, "details", None),
        }
    finally:
        if opened:
            try:
                close_cmd = base + ["--session", session, "close"]
                _run_command(close_cmd, timeout=min(8.0, max(2.0, timeout / 3)), cwd=temp_dir)
            except Exception:
                pass
        if browser_pid is not None:
            try:
                os.kill(browser_pid, 0)
            except ProcessLookupError:
                _ACTIVE_BROWSER_PIDS.discard(browser_pid)
            except OSError:
                _ACTIVE_BROWSER_PIDS.discard(browser_pid)
            else:
                try:
                    os.kill(browser_pid, signal.SIGTERM)
                    time.sleep(0.2)
                    os.kill(browser_pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except OSError:
                    pass
                _ACTIVE_BROWSER_PIDS.discard(browser_pid)
        _safe_rmtree(temp_dir)
        _TEMP_DIRS.discard(temp_dir)


def fetch_urls(
    urls: list[str],
    *,
    timeout: Optional[float] = None,
    wait_ms: Optional[int] = None,
    selector: Optional[str] = None,
    max_chars: int = 20000,
    markdownish: bool = True,
    min_quality_score: Optional[float] = None,
    proxy: Optional[str] = None,
    retries: Optional[int] = None,
) -> Dict[str, Any]:
    threshold = local_fetch.DEFAULT_QUALITY_THRESHOLD if min_quality_score is None else min_quality_score
    results = [
        fetch_one(
            url,
            timeout=timeout,
            wait_ms=wait_ms,
            selector=selector,
            max_chars=max_chars,
            markdownish=markdownish,
            proxy=proxy,
            retries=retries,
        )
        for url in urls
    ]
    failures: list[Dict[str, Any]] = []
    for item in results:
        quality = local_fetch.assess_quality(item, threshold=threshold)
        item["quality"] = quality
        if min_quality_score is not None and (not item.get("ok") or quality["score"] < threshold):
            failures.append({
                "url": item.get("url"),
                "status": item.get("status"),
                "score": quality["score"],
                "threshold": threshold,
                "reason": quality["reason"],
                "flags": quality.get("flags"),
                "suggestions": quality.get("suggestions"),
                "error": item.get("error"),
            })
    result = {
        "ok": any(item.get("ok") for item in results),
        "allOk": all(item.get("ok") for item in results) if results else False,
        "service": "playwright",
        "data": {"results": results},
    }
    if min_quality_score is not None:
        result["qualityThreshold"] = threshold
        result["qualityPass"] = not failures
        if failures:
            result["qualityFailures"] = failures
            raise local_fetch.LowQualityError(failures, result)
    return result


def split_csv(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Playwright 渲染 fetch：用于动态页面/JS 页面，本地可选增强后端")
    parser.add_argument("--urls", required=True, help="逗号分隔 URL")
    parser.add_argument("--timeout", type=float, help="每个 Playwright 命令的超时秒数")
    parser.add_argument("--wait-ms", type=int, help="页面打开后额外等待毫秒；默认 PLAYWRIGHT_WAIT_MS 或 1000")
    parser.add_argument("--selector", help="优先抽取的 CSS selector；未提供时自动选择 main/article/content/body")
    parser.add_argument("--proxy", help="Playwright 浏览器代理地址，如 127.0.0.1:7890 或 http://127.0.0.1:7890")
    parser.add_argument("--retries", type=int, help="Playwright open 失败重试次数；默认 PLAYWRIGHT_RETRIES 或 0，上限 1")
    parser.add_argument("--max-characters", type=int, default=20000)
    parser.add_argument("--plain", action="store_true", help="不做标题式 markdown 整理")
    parser.add_argument("--min-quality", type=float, help="质量评分阈值（0-1）；低于阈值时退出码为 1")
    parser.add_argument("--format", choices=["json", "markdown", "text"], default="json")
    args = parser.parse_args(argv)

    exit_code = 0
    try:
        result = fetch_urls(
            split_csv(args.urls),
            timeout=args.timeout,
            wait_ms=args.wait_ms,
            selector=args.selector,
            max_chars=args.max_characters,
            markdownish=not args.plain,
            min_quality_score=args.min_quality,
            proxy=args.proxy,
            retries=args.retries,
        )
    except local_fetch.LowQualityError as exc:
        result = exc.result
        result["ok"] = False
        result["error"] = str(exc)
        exit_code = 1

    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.format == "markdown":
        print(local_fetch.result_to_markdown(result))
    else:
        print("\n\n".join(item.get("text", "") for item in result.get("data", {}).get("results", [])))
    return exit_code if exit_code else (0 if result.get("ok") else 1)


if __name__ == "__main__":
    sys.exit(main())
