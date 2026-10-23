"""Preview/reclaim old orphan images. Run: python -m app.scripts.cleanup_uploads --help."""
from __future__ import annotations

import argparse
import asyncio
import json
import logging

from app.services.upload_storage import prune_orphan_uploads


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Delete candidates; default is read-only")
    parser.add_argument("--min-age-hours", type=float, default=48)
    parser.add_argument("--limit", type=int, default=2000, help="Maximum removals per run; 0 means no limit")
    parser.add_argument("--scope", choices=("all", "recipes"), default="recipes")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    result = asyncio.run(prune_orphan_uploads(
        dry_run=not args.apply, min_age_hours=args.min_age_hours, limit=args.limit, scope=args.scope,
    ))
    result["candidate_gib"] = round(result["candidate_bytes"] / 1024**3, 2)
    result["deleted_gib"] = round(result["deleted_bytes"] / 1024**3, 2)
    print(json.dumps(result, indent=2))
    if result["failed"] or result["busy"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
