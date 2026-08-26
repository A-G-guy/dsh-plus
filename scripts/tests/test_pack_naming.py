"""生产分发防陈旧单测：vendor 哈希命名与旧 tarball 清理。"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from dshctl import cmd_pack


class TestHashedVendorName(unittest.TestCase):
    def test_content_change_changes_name(self):
        with tempfile.TemporaryDirectory() as td:
            tarball = Path(td) / "dsh-plus-shared-0.1.0.tgz"
            tarball.write_bytes(b"v1")
            name1 = cmd_pack.hashed_vendor_name(tarball)
            tarball.write_bytes(b"v2")
            name2 = cmd_pack.hashed_vendor_name(tarball)
        self.assertNotEqual(name1, name2)
        self.assertTrue(name1.startswith("dsh-plus-shared-0.1.0-"))
        self.assertTrue(name1.endswith(".tgz"))

    def test_same_content_stable_name(self):
        with tempfile.TemporaryDirectory() as td:
            tarball = Path(td) / "dsh-plus-shared-0.1.0.tgz"
            tarball.write_bytes(b"same")
            self.assertEqual(cmd_pack.hashed_vendor_name(tarball),
                             cmd_pack.hashed_vendor_name(tarball))


class TestVendorCleanup(unittest.TestCase):
    def test_stale_tarballs_removed_and_spec_written(self):
        with tempfile.TemporaryDirectory() as td:
            prod = Path(td)
            vendor = prod / "profiles/web/vendor/dsh-plus"
            vendor.mkdir(parents=True)
            (vendor / "dsh-plus-shared-0.1.0-deadbeef.tgz").write_bytes(b"old")
            (vendor / "dsh-plus-ui-mobile-fit-0.1.0-cafebabe.tgz").write_bytes(b"other")
            new_tarball = Path(td) / "dsh-plus-shared-0.1.0.tgz"
            new_tarball.write_bytes(b"new-content")
            with mock.patch.object(cmd_pack, "PROD_HOME", prod):
                import contextlib, io
                with contextlib.redirect_stdout(io.StringIO()):
                    specs = cmd_pack._vendor_into_prod_profile(
                        [("@dsh-plus/shared", new_tarball)])
            remaining = sorted(p.name for p in vendor.glob("*.tgz"))
            self.assertEqual(len(remaining), 2)  # 新文件 + 别包旧文件保留
            self.assertIn("dsh-plus-ui-mobile-fit-0.1.0-cafebabe.tgz", remaining)
            spec = specs["@dsh-plus/shared"]
            self.assertTrue(spec.startswith("file:./vendor/dsh-plus/"))
            self.assertIn(spec[len("file:./vendor/dsh-plus/"):], remaining)


class TestTarballHashes(unittest.TestCase):
    def test_package_prefix_stripped(self):
        import tarfile
        with tempfile.TemporaryDirectory() as td:
            tarball = Path(td) / "x.tgz"
            payload = Path(td) / "index.js"
            payload.write_bytes(b"console.log(1)")
            with tarfile.open(tarball, "w:gz") as tf:
                tf.add(payload, arcname="package/lib/index.js")
            hashes = cmd_pack._tarball_file_hashes(tarball)
            self.assertEqual(list(hashes), ["lib/index.js"])


if __name__ == "__main__":
    unittest.main()
