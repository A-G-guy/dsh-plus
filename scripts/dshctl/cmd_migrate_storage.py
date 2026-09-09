"""dshctl migrate-storage：dsh-plus 插件数据存储规范的一次性手动迁移。

旧数据一律复制（原文件原样保留），密钥写入官方 credentials seam，
迁移产物落 $DSH_HOME/dsh-plus/ 并输出清单；删除旧数据由用户确认后另行执行。
"""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path

from .common import PROD_HOME

MANIFEST_VERSION = 1


def _backup_dir() -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return PROD_HOME / "backups" / f"migrate-storage-{stamp}"


def _load_manifest(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def _save_manifest(path: Path, entries: list[dict]) -> None:
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _copy_file(src: Path, dst: Path, manifest: list[dict], note: str) -> None:
    if not src.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        manifest.append({"source": str(src), "target": str(dst), "status": "skipped-exists",
                         "note": note})
        return
    shutil.copy2(src, dst)
    manifest.append({"source": str(src), "target": str(dst), "status": "copied", "note": note})


def _extract_settings_keys(settings_path: Path, manifest: list[dict]) -> dict:
    """从 settings.yaml 原样读出 lifeboat 旧命名空间数据（含 dsh-plus-lifeboat 段）。

    YAML 结构级操作；密码/日志等敏感值不打印。返回提取结果或空 dict。
    """
    if not settings_path.exists():
        return {}
    try:
        import yaml
    except ImportError:
        manifest.append({"source": str(settings_path), "status": "error",
                         "note": "PyYAML 不可用，settings 提取跳过（可手动迁移）"})
        return {}
    doc = yaml.safe_load(settings_path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict):
        return {}
    ns = doc.get("dsh-plus-lifeboat")
    if not isinstance(ns, dict):
        return {}
    journal = ns.get("journal") or []
    fallback = ns.get("llmFallback")
    state: dict = {"journal": _jsonable(journal), "llmFallback": _jsonable(fallback)}
    manifest.append({
        "source": str(settings_path),
        "target": str(PROD_HOME / "dsh-plus" / "lifeboat" / "state.json"),
        "status": "extracted",
        "note": (f"journal {len(journal)} 条；llmFallback {'有' if fallback else '无'}；"
                 "settings.yaml 中的 dsh-plus-lifeboat 段保留原样（删除走清单确认）"),
    })
    return state


def _jsonable(value):  # noqa: ANN001
    """YAML 载荷转 JSON 可序列化（datetime → ISO 8601，兼容 state.json 读取端）。"""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    return value


def _resolve_smtp_pass(settings_path: Path, manifest: list[dict]) -> str | None:
    """读出 settings.yaml 中 notify-email smtp.pass（存在则迁移进 credentials）。"""
    if not settings_path.exists():
        return None
    try:
        import yaml
    except ImportError:
        return None
    doc = yaml.safe_load(settings_path.read_text(encoding="utf-8"))
    ns = doc.get("dsh-plus-notify-email") if isinstance(doc, dict) else None
    if not isinstance(ns, dict):
        return None
    smtp = ns.get("smtp")
    value = smtp.get("pass") if isinstance(smtp, dict) else None
    if isinstance(value, str) and value:
        manifest.append({
            "source": str(settings_path) + "#dsh-plus-notify-email.smtp.pass",
            "target": "credentials refs/NOTIFY_EMAIL_SMTP_PASS",
            "status": "extracted",
            "note": "值不打印；settings 中原键保留原样（删除走清单确认）",
        })
        return value
    return None


def _write_state(state: dict, target: Path, manifest: list[dict]) -> None:
    if not state.get("journal") and state.get("llmFallback") is None:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        existing = json.loads(target.read_text(encoding="utf-8"))
        if not existing.get("journal") and existing.get("llmFallback") is None:
            pass  # 新版运行后留下的空文件，允许覆盖
        else:
            manifest.append({"source": "settings.yaml 提取", "target": str(target),
                             "status": "skipped-exists",
                             "note": "state.json 已有新版数据，不覆盖"})
            return
    target.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_credentials_ref(ref_name: str, value: str, manifest: list[dict]) -> None:
    """把密钥写入官方 .credentials.yaml 的 refs 段（结构性 YAML 编辑，值不打印）。

    dsh CLI 无独立 credentials 子命令，refs 段格式经实测确认
    （refs.<NAME>: <value>，与 secret-env 写入产物同构）。
    """
    cred_path = PROD_HOME / ".credentials.yaml"
    if not cred_path.exists():
        manifest.append({"source": f"refs/{ref_name}", "status": "error",
                         "note": ".credentials.yaml 不存在（dsh 从未启动过？），跳过"})
        return
    try:
        import yaml
    except ImportError:
        manifest.append({"source": f"refs/{ref_name}", "status": "error",
                         "note": "PyYAML 不可用，credentials 写入跳过"})
        return
    doc = yaml.safe_load(cred_path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict) or not isinstance(doc.get("refs"), dict):
        manifest.append({"source": f"refs/{ref_name}", "status": "error",
                         "note": ".credentials.yaml 结构异常，跳过（不动原文件）"})
        return
    if doc["refs"].get(ref_name):
        manifest.append({"source": f"refs/{ref_name}", "status": "skipped-exists",
                         "note": "credentials 引用已存在，不覆盖"})
        return
    doc["refs"][ref_name] = value
    cred_path.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False),
                         encoding="utf-8")
    manifest.append({"source": "settings.yaml 提取", "target": f"refs/{ref_name}",
                     "status": "written", "note": "值已写入官方 credentials refs（原文件已备份）"})


def cmd_migrate_storage(args) -> None:  # noqa: ANN001
    home = PROD_HOME
    manifest_path = home / "dsh-plus" / "migrate-manifest.json"
    backup = _backup_dir()
    manifest: list[dict] = _load_manifest(manifest_path)
    entries_before = len(manifest)

    # 0. 备份（幂等：每次运行新目录）
    backup.mkdir(parents=True, exist_ok=True)
    settings_path = home / "settings.yaml"
    credentials_path = home / ".credentials.yaml"
    for f in (settings_path, credentials_path):
        if f.exists():
            shutil.copy2(f, backup / f.name)
    manifest.append({"source": "settings.yaml / .credentials.yaml", "target": str(backup),
                     "status": "backup", "note": "迁移前的整文件备份"})

    # 1. 纯数据文件：复制（usage-panel / llm-pi / web-files / lifeboat 日志类）
    data_moves = [
        ("usage-panel/cache.json", "usage-panel/cache.json", "用量缓存"),
        ("usage-panel/models-dev.json", "usage-panel/models-dev.json", "模型目录缓存"),
        ("storages/dsh-custom-llm-pi/models-dev.json", "llm-pi/models-dev.json", "llm-pi 目录缓存"),
        ("web-files/prefs.json", "web-files/prefs.json", "web-files 偏好"),
    ]
    for src_rel, dst_rel, note in data_moves:
        _copy_file(home / src_rel, home / "dsh-plus" / dst_rel, manifest, note)

    # 2. lifeboat 运行期状态：settings.yaml → state.json
    state = _extract_settings_keys(settings_path, manifest)
    if state:
        _write_state(state, home / "dsh-plus" / "lifeboat" / "state.json", manifest)

    # 3. SMTP 密码 → 官方 credentials seam
    pass_value = _resolve_smtp_pass(settings_path, manifest)
    if pass_value is not None:
        _write_credentials_ref("NOTIFY_EMAIL_SMTP_PASS", pass_value, manifest)

    _save_manifest(manifest_path, manifest)
    fresh = manifest[entries_before:]
    print(f"清单：{manifest_path}（本次 {len(fresh)} 条，累计 {len(manifest)} 条）")
    for item in fresh:
        print(f"  [{item['status']}] {item.get('source','')} → {item.get('target','')}"
              f"  # {item.get('note','')}")
    print("旧数据已原样保留；删除须待你切换新版验证后另行确认。")


def register(sub: argparse.ArgumentParser) -> None:
    sub.add_parser("migrate-storage", help="dsh-plus 存储规范一次性迁移（复制旧数据+写清单）")
