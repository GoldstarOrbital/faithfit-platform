#!/usr/bin/env python3
"""Generate Functioning Faith App Store icons from the approved brand mark.

Usage:
  python3 ios/FunctioningFaith/scripts/generate-app-icon.py --source /path/to/logo.png
"""
from __future__ import annotations

import argparse
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError as exc:
    raise SystemExit("Pillow is required: pip install Pillow") from exc

SIZE = 1024
CREAM = (245, 237, 224, 255)
BLACK = (28, 28, 28, 255)
GOLD = (201, 160, 80, 255)
ICON_SIZES = {
    "AppIcon-20@2x.png": 40,
    "AppIcon-20@3x.png": 60,
    "AppIcon-29@2x.png": 58,
    "AppIcon-29@3x.png": 87,
    "AppIcon-40@2x.png": 80,
    "AppIcon-40@3x.png": 120,
    "AppIcon-60@2x.png": 120,
    "AppIcon-60@3x.png": 180,
    "AppIcon-20-ipad.png": 20,
    "AppIcon-20@2x-ipad.png": 40,
    "AppIcon-29-ipad.png": 29,
    "AppIcon-29@2x-ipad.png": 58,
    "AppIcon-40-ipad.png": 40,
    "AppIcon-40@2x-ipad.png": 80,
    "AppIcon-76-ipad.png": 76,
    "AppIcon-76@2x-ipad.png": 152,
    "AppIcon-83.5@2x-ipad.png": 167,
}
LEGACY_ICON_SIZES = {
    "AppIcon60x60@2x.png": 120,
    "AppIcon60x60@3x.png": 180,
    "AppIcon76x76@2x.png": 152,
    "AppIcon83.5x83.5@2x.png": 167,
}


def generate(source: Path, dest: Path) -> None:
    brand = Image.open(source).convert("RGBA")
    if brand.width != brand.height:
        raise SystemExit("The approved app-icon source must be square.")
    out = Image.new("RGB", (SIZE, SIZE), CREAM[:3])
    resized = brand.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    out.paste(resized, mask=resized.getchannel("A"))
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, "PNG", optimize=True)
    for filename, pixels in ICON_SIZES.items():
        out.resize((pixels, pixels), Image.Resampling.LANCZOS).save(
            dest.parent / filename, "PNG", optimize=True
        )
    legacy_dir = dest.parent.parent.parent
    for filename, pixels in LEGACY_ICON_SIZES.items():
        out.resize((pixels, pixels), Image.Resampling.LANCZOS).save(
            legacy_dir / filename, "PNG", optimize=True
        )
    print(f"Wrote {dest} ({dest.stat().st_size} bytes)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    args = parser.parse_args()
    if not args.source.is_file():
        raise SystemExit(f"Brand source not found: {args.source}")
    root = Path(__file__).resolve().parent.parent
    dest = (
        root
        / "FunctioningFaith"
        / "Resources"
        / "Assets.xcassets"
        / "AppIcon.appiconset"
        / "AppIcon.png"
    )
    generate(args.source, dest)


if __name__ == "__main__":
    main()
