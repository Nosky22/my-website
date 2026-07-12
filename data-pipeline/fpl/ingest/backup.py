"""Produce a compressed backup of raw/ for upload to Cloudflare R2.

Run after a successful Phase 0 live capture.
"""
from __future__ import annotations

import tarfile
from pathlib import Path

RAW_DIR = Path(__file__).parent.parent / "raw"


def make_archive(season: str, out_dir: Path | None = None) -> Path:
    out_dir = out_dir or RAW_DIR.parent
    out_path = out_dir / f"raw-{season}.tar.gz"
    source = RAW_DIR / season
    if not source.exists():
        raise FileNotFoundError(f"raw/{season}/ not found — run ingestion first")
    with tarfile.open(out_path, "w:gz") as tar:
        tar.add(source, arcname=f"raw/{season}")
    size_mb = out_path.stat().st_size / 1_048_576
    print(f"Archive: {out_path} ({size_mb:.1f} MB)")
    return out_path
