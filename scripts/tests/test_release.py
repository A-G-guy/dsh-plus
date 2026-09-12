"""release 纯逻辑单测：SemVer 递增、registry 存在性判定、发布拓扑排序。"""
from __future__ import annotations

import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from dshctl import cmd_release, common


class _FakeResponse:
    """urlopen 的最小替身（上下文管理器 + status/read/headers）。"""

    def __init__(self, status: int = 200, body: bytes = b"{}",
                 headers: dict[str, str] | None = None):
        self.status = status
        self._body = body
        self.headers = headers or {}

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *_exc) -> bool:
        return False


def _make_pkg(root: Path, dirname: str, name: str, deps: dict[str, str] | None = None) -> Path:
    pkg = root / dirname
    pkg.mkdir(parents=True)
    meta = {"name": name, "version": "0.1.0", "dependencies": deps or {}}
    (pkg / "package.json").write_text(json.dumps(meta), encoding="utf-8")
    return pkg


class TestBumpVersion(unittest.TestCase):
    def test_semver_increments(self):
        self.assertEqual(cmd_release.bump_version("0.1.3", "patch"), "0.1.4")
        self.assertEqual(cmd_release.bump_version("0.1.3", "minor"), "0.2.0")
        self.assertEqual(cmd_release.bump_version("0.1.3", "major"), "1.0.0")

    def test_explicit_version_allowed_when_greater(self):
        self.assertEqual(cmd_release.bump_version("0.1.3", "0.2.0"), "0.2.0")

    def test_rejects_downgrade_or_equal(self):
        for spec in ("0.1.3", "0.1.2", "0.0.9"):
            with self.assertRaises(SystemExit):
                cmd_release.bump_version("0.1.3", spec)

    def test_rejects_malformed(self):
        for spec in ("1.0", "v1.0.0", "latest", "1.0.0-beta"):
            with self.assertRaises(SystemExit):
                cmd_release.bump_version("0.1.3", spec)


class TestRegistryHasVersion(unittest.TestCase):
    """存在性判定走版本端点（无 CDN 缓存）——200 已发布 / 404 未发布。"""

    def setUp(self):
        # 进程内备忘会跨用例串味（真实 common 缓存），每例前清空
        common.clear_registry_cache()

    def test_200_means_published(self):
        with mock.patch("urllib.request.urlopen",
                        return_value=_FakeResponse(200)):
            self.assertTrue(cmd_release.registry_has_version("@dsh-plus/x", "0.1.0"))

    def test_404_means_unpublished(self):
        err = urllib.error.HTTPError("u", 404, "not found", {}, None)
        with mock.patch("urllib.request.urlopen", side_effect=err):
            self.assertFalse(cmd_release.registry_has_version("@dsh-plus/x", "9.9.9"))

    def test_query_failure_is_fail_loud_not_unpublished(self):
        # 查询故障绝不能退化成"未发布"——那会重复发布并撞 EPUBLISHCONFLICT
        err = urllib.error.HTTPError("u", 503, "unavailable", {}, None)
        with mock.patch("urllib.request.urlopen", side_effect=err):
            with self.assertRaises(SystemExit):
                cmd_release.registry_has_version("@dsh-plus/x", "0.1.0")

    def test_document_query_is_cache_busted(self):
        # 文档端点带 max-age=300：查询必须自带时间戳参数绕开缓存
        with mock.patch("dshctl.cmd_release.urllib.request.urlopen",
                        return_value=_FakeResponse(200, body=b'{"versions":{}}')) as op:
            cmd_release.registry_document("@dsh-plus/x")
        url = op.call_args[0][0].full_url
        self.assertIn("?t=", url)

    def test_repeated_query_hits_cache(self):
        # 同一 (name, version) 在一次链路里被问多次：只应发一次网络请求
        common.clear_registry_cache()
        with mock.patch("urllib.request.urlopen",
                        return_value=_FakeResponse(200)) as op:
            for _ in range(3):
                cmd_release.registry_has_version("@dsh-plus/x", "0.1.0")
        self.assertEqual(op.call_count, 1)

    def test_cached_false_bypasses_cache(self):
        # 发布后确认可见必须绕过备忘（否则读到发布前的旧结论）
        common.clear_registry_cache()
        with mock.patch("urllib.request.urlopen",
                        return_value=_FakeResponse(200)) as op:
            cmd_release.registry_has_version("@dsh-plus/x", "0.1.0", cached=False)
            cmd_release.registry_has_version("@dsh-plus/x", "0.1.0", cached=False)
        self.assertEqual(op.call_count, 2)

    def test_forget_invalidates_entry(self):
        common.clear_registry_cache()
        with mock.patch("urllib.request.urlopen",
                        return_value=_FakeResponse(200)) as op:
            cmd_release.registry_has_version("@dsh-plus/x", "0.1.0")
            common.forget_registry_version("@dsh-plus/x", "0.1.0")
            cmd_release.registry_has_version("@dsh-plus/x", "0.1.0")
        self.assertEqual(op.call_count, 2)


class TestPublishOrder(unittest.TestCase):
    def test_dependencies_publish_first(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            shared = _make_pkg(root, "shared", "@dsh-plus/shared")
            plugin = _make_pkg(root, "plugin", "@dsh-plus/plugin",
                               {"@dsh-plus/shared": "workspace:*"})
            bundle = _make_pkg(root, "bundle", "@dsh-plus/bundle",
                               {"@dsh-plus/plugin": "workspace:*"})
            ordered = [p.name for p in cmd_release.publish_order([bundle, plugin, shared])]
            self.assertEqual(ordered, ["shared", "plugin", "bundle"])

    def test_external_deps_ignored(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _make_pkg(root, "a", "@dsh-plus/a",
                      {"@deepseek-ai/cordis": "4.0.1", "left-pad": "workspace:*"})
            b = _make_pkg(root, "b", "@dsh-plus/b")
            ordered = [p.name for p in cmd_release.publish_order([b, root / "a"])]
            self.assertEqual(sorted(ordered), ["a", "b"])

    def test_cycle_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _make_pkg(root, "a", "@dsh-plus/a", {"@dsh-plus/b": "workspace:*"})
            _make_pkg(root, "b", "@dsh-plus/b", {"@dsh-plus/a": "workspace:*"})
            with self.assertRaises(SystemExit):
                cmd_release.publish_order([root / "a", root / "b"])


class TestWaitPublished(unittest.TestCase):
    """发布后可见性确认：轮询版本端点（无 CDN 缓存）直到可见。"""

    def test_confirms_once_visible(self):
        # 前两次查询尚不可见（发布传播中），随后可见 → 轮询必须返回 True
        seen = iter([False, False, True])
        with mock.patch.object(cmd_release, "registry_has_version",
                               side_effect=lambda _n, _v, **_kw: next(seen)), \
                mock.patch("dshctl.cmd_release.time.sleep"):
            self.assertTrue(cmd_release.wait_published("@dsh-plus/x", "0.2.0",
                                                       attempts=6, interval=0))

    def test_timeout_reports_unconfirmed(self):
        # 传播超过轮询窗口 → 返回 False（发布本身已成功，仅未确认可见，非错误）
        with mock.patch.object(cmd_release, "registry_has_version",
                               return_value=False), \
                mock.patch("dshctl.cmd_release.time.sleep"):
            self.assertFalse(cmd_release.wait_published("@dsh-plus/x", "0.2.0",
                                                        attempts=3, interval=0))

    def test_never_published_package_stays_unconfirmed(self):
        # 从未发布（版本端点恒 404）→ 轮询持续不可见
        with mock.patch.object(cmd_release, "registry_has_version",
                               return_value=False), \
                mock.patch("dshctl.cmd_release.time.sleep"):
            self.assertFalse(cmd_release.wait_published("@dsh-plus/x", "0.1.0",
                                                        attempts=2, interval=0))

    def test_conflict_feature_regex_matches_npm_error(self):
        for text in ("npm ERR! code EPUBLISHCONFLICT",
                     "You cannot publish over the previously published versions",
                     "cannot publish over existing version 0.1.0"):
            self.assertIsNotNone(cmd_release.PUBLISH_CONFLICT_RE.search(text), text)
        self.assertIsNone(cmd_release.PUBLISH_CONFLICT_RE.search("npm ERR! network timeout"))


class TestPublishLayers(unittest.TestCase):
    """并发分层：workspace 依赖落入更早的层，层内包互不依赖。"""

    def test_dependency_gets_earlier_layer(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            shared = _make_pkg(root, "shared", "@dsh-plus/shared")
            plugin = _make_pkg(root, "plugin", "@dsh-plus/plugin",
                               {"@dsh-plus/shared": "workspace:*"})
            bundle = _make_pkg(root, "bundle", "@dsh-plus/bundle",
                               {"@dsh-plus/plugin": "workspace:*"})
            layers = cmd_release.publish_layers([bundle, plugin, shared])
            self.assertEqual([[p.name for p in layer] for layer in layers],
                             [["shared"], ["plugin"], ["bundle"]])

    def test_independent_packages_share_layer(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            a = _make_pkg(root, "a", "@dsh-plus/a")
            b = _make_pkg(root, "b", "@dsh-plus/b")
            layers = cmd_release.publish_layers([a, b])
            self.assertEqual(len(layers), 1)
            self.assertEqual(sorted(p.name for p in layers[0]), ["a", "b"])

    def test_empty_pending(self):
        self.assertEqual(cmd_release.publish_layers([]), [])


class TestSplitPending(unittest.TestCase):
    """并发预筛：registry 已有版本的包落入已发组，其余落入待发组（保拓扑序）。"""

    def test_pending_and_done_partitioned(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            shared = _make_pkg(root, "shared", "@dsh-plus/shared")
            plugin = _make_pkg(root, "plugin", "@dsh-plus/plugin",
                               {"@dsh-plus/shared": "workspace:*"})
            published = {"@dsh-plus/shared"}
            with mock.patch.object(
                    cmd_release, "registry_has_version",
                    side_effect=lambda name, _v: name in published):
                pending, done = cmd_release.split_pending([plugin, shared])
            self.assertEqual([p.name for p in pending], ["plugin"])
            self.assertEqual([p.name for p in done], ["shared"])


class TestPublishMany(unittest.TestCase):
    """并发发布编排：跳过的不再调用 publish_one；依赖方在被依赖方之后启动。"""

    def test_dependency_publishes_before_dependent(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            shared = _make_pkg(root, "shared", "@dsh-plus/shared")
            plugin = _make_pkg(root, "plugin", "@dsh-plus/plugin",
                               {"@dsh-plus/shared": "workspace:*"})
            started: list[str] = []

            def fake_publish(pkg, *, token=None, prechecked=False):
                started.append(pkg.name)
                return "published"

            with mock.patch.object(cmd_release, "registry_has_version",
                                   return_value=False), \
                    mock.patch.object(cmd_release, "publish_one",
                                      side_effect=fake_publish):
                published = cmd_release.publish_many([plugin, shared], token="t")
            self.assertEqual([p.name for p in published], ["shared", "plugin"])
            self.assertLess(started.index("shared"), started.index("plugin"))

    def test_skipped_packages_not_republished(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _make_pkg(root, "a", "@dsh-plus/a")
            with mock.patch.object(cmd_release, "registry_has_version",
                                   return_value=True), \
                    mock.patch.object(cmd_release, "publish_one") as publish:
                published = cmd_release.publish_many([root / "a"], token="t")
            self.assertEqual(published, [])
            publish.assert_not_called()


if __name__ == "__main__":
    unittest.main()
