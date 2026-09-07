from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch


os.environ.setdefault("APP_ENV", "development")

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.services import auto_spy_scraper as scraper  # noqa: E402


class AutoSpyScraperTests(unittest.TestCase):
    def test_extracts_recipe_jsonld_from_page(self) -> None:
        page_html = """
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@graph": [
                  {
                    "@type": "Recipe",
                    "name": "Chewy Chocolate Chip Cookies",
                    "image": [{"url": "/images/cookies.webp"}],
                    "datePublished": "2026-09-06T12:00:00Z",
                    "recipeIngredient": ["flour"],
                    "recipeInstructions": ["Bake until golden"]
                  }
                ]
              }
            </script>
          </head>
          <body></body>
        </html>
        """

        row = scraper._extract_recipe_row_from_page(
            "https://example.com/chewy-chocolate-chip-cookies/",
            page_html,
        )

        self.assertIsNotNone(row)
        assert row is not None
        self.assertEqual(row["recipe_text"], "Chewy Chocolate Chip Cookies")
        self.assertEqual(row["image_url"], "https://example.com/images/cookies.webp")
        self.assertEqual(row["post_url"], "https://example.com/chewy-chocolate-chip-cookies/")
        self.assertEqual(row["published_at"], "2026-09-06T12:00:00+00:00")

    def test_sitemap_parser_ignores_nested_image_locs(self) -> None:
        sitemap_xml = """
        <urlset
          xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
          xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
          <url>
            <loc>https://example.com/chewy-chocolate-chip-cookies/</loc>
            <lastmod>2026-09-06T12:00:00Z</lastmod>
            <image:image>
              <image:loc>https://example.com/images/cookies.webp</image:loc>
            </image:image>
          </url>
        </urlset>
        """

        child_sitemaps, entries = scraper._parse_sitemap_xml(sitemap_xml)

        self.assertEqual(child_sitemaps, [])
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].url, "https://example.com/chewy-chocolate-chip-cookies/")
        self.assertEqual(entries[0].lastmod, datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc))


class AutoSpyScrapeSourceRowsTests(unittest.IsolatedAsyncioTestCase):
    async def test_scrape_source_rows_uses_sitemap_after_wp_and_rss_empty(self) -> None:
        after = datetime(2026, 9, 1, tzinfo=timezone.utc)
        row = {
            "image_url": "https://example.com/images/cookies.webp",
            "recipe_text": "Chewy Chocolate Chip Cookies",
            "post_url": "https://example.com/chewy-chocolate-chip-cookies/",
            "published_at": "2026-09-06T12:00:00+00:00",
        }

        with (
            patch.object(scraper, "_scrape_wp_rest", new=AsyncMock(return_value=[])) as wp_rest,
            patch.object(scraper, "_scrape_rss", new=AsyncMock(return_value=[])) as rss,
            patch.object(scraper, "_scrape_sitemap_pages", new=AsyncMock(return_value=[row])) as sitemap_pages,
        ):
            rows = await scraper.scrape_source_rows("https://example.com", after)

        self.assertEqual(rows, [row])
        wp_rest.assert_awaited_once()
        rss.assert_awaited_once()
        sitemap_pages.assert_awaited_once()

    async def test_scrape_source_rows_can_seed_latest_when_recent_window_is_empty(self) -> None:
        after = datetime(2026, 9, 1, tzinfo=timezone.utc)
        row = {
            "image_url": "https://example.com/images/brownies.webp",
            "recipe_text": "Fudge Brownies",
            "post_url": "https://example.com/fudge-brownies/",
            "published_at": "2026-08-15T12:00:00+00:00",
        }

        with (
            patch.object(scraper, "_scrape_wp_rest", new=AsyncMock(return_value=[])),
            patch.object(scraper, "_scrape_rss", new=AsyncMock(return_value=[])),
            patch.object(scraper, "_scrape_sitemap_pages", new=AsyncMock(side_effect=[[], [row]])) as sitemap_pages,
        ):
            rows = await scraper.scrape_source_rows(
                "https://example.com",
                after,
                seed_when_empty=True,
            )

        self.assertEqual(rows, [row])
        self.assertEqual(sitemap_pages.await_count, 2)
        self.assertEqual(sitemap_pages.await_args_list[0].args[1], after)
        self.assertIsNone(sitemap_pages.await_args_list[1].args[1])


if __name__ == "__main__":
    unittest.main()
