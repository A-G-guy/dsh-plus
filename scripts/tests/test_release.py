"""release 纯逻辑单测：SemVer 递增、registry 版本解析、发布拓扑排序。"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from dshctl import cmd_release


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


class TestPublishedVersions(unittest.TestCase):
    def test_unpublished_package_is_empty(self):
        self.assertEqual(cmd_release.published_versions(None), set())

    def test_versions_extracted_from_document(self):
        doc = {"versions": {"0.1.0": {}, "0.1.1": {}}, "dist-tags": {"latest": "0.1.1"}}
        self.assertEqual(cmd_release.published_versions(doc), {"0.1.0", "0.1.1"})


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
    """发布后可见性确认：覆盖官方 registry 对刚发布版本的最终一致性窗口。"""

    def test_confirms_once_visible(self):
        # 前两次查询落在同步窗口内（不可见），随后可见 → 轮询必须返回 True
        seen = iter([{"versions": {"0.1.0": {}}},
                     {"versions": {"0.1.0": {}}},
                     {"versions": {"0.1.0": {}, "0.2.0": {}}}])
        with mock.patch.object(cmd_release, "registry_document",
                               side_effect=lambda _name: next(seen)), \
                mock.patch("dshctl.cmd_release.time.sleep"):
            self.assertTrue(cmd_release.wait_published("@dsh-plus/x", "0.2.0",
                                                       attempts=6, interval=0))

    def test_timeout_reports_unconfirmed(self):
        # 同步延迟超过轮询窗口 → 返回 False（发布本身已成功，由调用方警告）
        with mock.patch.object(cmd_release, "registry_document",
                               return_value={"versions": {"0.1.0": {}}}), \
                mock.patch("dshctl.cmd_release.time.sleep"):
            self.assertFalse(cmd_release.wait_published("@dsh-plus/x", "0.2.0",
                                                        attempts=3, interval=0))

    def test_empty_document_counts_as_unpublished(self):
        # 包文档 404（从未发布）时轮询持续不可见
        with mock.patch.object(cmd_release, "registry_document",
                               return_value=None), \
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
            docs = {"@dsh-plus/shared": {"versions": {"0.1.0": {}}},
                    "@dsh-plus/plugin": None}
            with mock.patch.object(cmd_release, "registry_document",
                                   side_effect=lambda name: docs[name]):
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

            with mock.patch.object(cmd_release, "registry_document",
                                   return_value=None), \
                    mock.patch.object(cmd_release, "publish_one",
                                      side_effect=fake_publish):
                published = cmd_release.publish_many([plugin, shared], token="t")
            self.assertEqual([p.name for p in published], ["shared", "plugin"])
            self.assertLess(started.index("shared"), started.index("plugin"))

    def test_skipped_packages_not_republished(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _make_pkg(root, "a", "@dsh-plus/a")
            doc = {"versions": {"0.1.0": {}}}
            with mock.patch.object(cmd_release, "registry_document",
                                   return_value=doc), \
                    mock.patch.object(cmd_release, "publish_one") as publish:
                published = cmd_release.publish_many([root / "a"], token="t")
            self.assertEqual(published, [])
            publish.assert_not_called()


if __name__ == "__main__":
    unittest.main()
