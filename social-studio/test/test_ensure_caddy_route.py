import os
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from ops.ensure_caddy_route import canonical_block, ensure_route, is_canonical  # noqa: E402


class EnsureCaddyRouteTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.path = Path(self.temp_dir.name) / "Caddyfile"
        self.domain = "social.haarapp.tech"
        self.upstream = "127.0.0.1:3100"

    def test_adds_managed_block_in_place(self):
        self.path.write_text("example.com {\n    respond \"ok\"\n}\n", encoding="utf-8")
        inode_before = os.stat(self.path).st_ino

        changed = ensure_route(self.path, self.domain, self.upstream)

        self.assertTrue(changed)
        self.assertEqual(os.stat(self.path).st_ino, inode_before)
        text = self.path.read_text(encoding="utf-8")
        self.assertIn("example.com", text)
        self.assertEqual(text.count("# BEGIN HAAR SOCIAL STUDIO"), 1)
        self.assertIn(canonical_block(self.domain, self.upstream), text)
        self.assertTrue(is_canonical(self.path, self.domain, self.upstream))

    def test_replaces_stale_and_duplicate_managed_blocks_with_one_canonical_block(self):
        stale = """
# BEGIN HAAR SOCIAL STUDIO
old.example.com {
    reverse_proxy 127.0.0.1:9999
}
# END HAAR SOCIAL STUDIO
"""
        self.path.write_text(
            "base.example.com { respond \"base\" }\n" + stale + stale,
            encoding="utf-8",
        )

        changed = ensure_route(self.path, self.domain, self.upstream)

        self.assertTrue(changed)
        text = self.path.read_text(encoding="utf-8")
        self.assertEqual(text.count("# BEGIN HAAR SOCIAL STUDIO"), 1)
        self.assertEqual(text.count("# END HAAR SOCIAL STUDIO"), 1)
        self.assertNotIn("old.example.com", text)
        self.assertNotIn("127.0.0.1:9999", text)
        self.assertTrue(is_canonical(self.path, self.domain, self.upstream))

    def test_second_ensure_is_idempotent(self):
        self.path.write_text("base.example.com { respond \"base\" }\n", encoding="utf-8")
        self.assertTrue(ensure_route(self.path, self.domain, self.upstream))

        changed = ensure_route(self.path, self.domain, self.upstream)

        self.assertFalse(changed)
        self.assertTrue(is_canonical(self.path, self.domain, self.upstream))


if __name__ == "__main__":
    unittest.main()
