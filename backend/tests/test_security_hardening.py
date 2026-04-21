from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def _read(path: str) -> str:
    return (REPO_ROOT / path).read_text(encoding="utf-8")


class SecurityHardeningTests(unittest.TestCase):
    def test_download_dependency_disallows_query_token(self) -> None:
        text = _read("backend/app/dependencies.py")
        self.assertNotIn("Query(default=None)", text)
        self.assertNotIn("?token=", text)

    def test_security_headers_include_csp_and_hsts(self) -> None:
        text = _read("backend/main.py")
        self.assertIn("Content-Security-Policy", text)
        self.assertIn("Strict-Transport-Security", text)

    def test_auth_cookies_are_configured(self) -> None:
        text = _read("backend/app/config.py")
        self.assertIn("auth_cookie_name", text)
        self.assertIn("auth_cookie_samesite", text)
        self.assertIn("auth_cookie_secure", text)

    def test_frontend_no_localstorage_token_usage(self) -> None:
        frontend = REPO_ROOT / "frontend" / "src"
        token_reads: list[str] = []
        for f in frontend.rglob("*"):
            if not f.is_file():
                continue
            if f.suffix.lower() not in {".ts", ".tsx", ".js", ".jsx"}:
                continue
            text = f.read_text(encoding="utf-8")
            if 'localStorage.getItem("token")' in text or "Authorization: `Bearer ${token}`" in text:
                token_reads.append(str(f))

        self.assertEqual(token_reads, [])


if __name__ == "__main__":
    unittest.main()
