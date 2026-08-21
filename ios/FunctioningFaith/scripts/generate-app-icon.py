#!/usr/bin/env python3
"""Generate Functioning Faith App Store icon (1024x1024, opaque).

Usage:
  python3 ios/FunctioningFaith/scripts/generate-app-icon.py
  bash ios/FunctioningFaith/scripts/install-app-icon.sh

Produces a cream / gold-arc / black cross + ff mark matching the brand.
Replace the output PNG in Xcode with a designer master if you have one.
"""
from __future__ import annotations

import math
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


def draw_arc(draw: ImageDraw.ImageDraw, bbox, start, end, fill, width):
    x0, y0, x1, y1 = bbox
    rx = (x1 - x0) / 2
    ry = (y1 - y0) / 2
    ox, oy = (x0 + x1) / 2, (y0 + y1) / 2
    steps = 120
    points = []
    for i in range(steps + 1):
        t = start + (end - start) * i / steps
        rad = math.radians(t)
        points.append((ox + rx * math.cos(rad), oy + ry * math.sin(rad)))
    if len(points) > 1:
        draw.line(points, fill=fill, width=width, joint="curve")


def generate(dest: Path) -> None:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, SIZE, SIZE], fill=CREAM)

    cx = SIZE // 2
    stroke = int(SIZE * 0.07)
    pad = int(SIZE * 0.12)
    draw_arc(draw, [pad, pad, SIZE - pad, SIZE - pad], 110, 250, GOLD, stroke)
    draw_arc(draw, [pad, pad, SIZE - pad, SIZE - pad], -70, 70, GOLD, stroke)

    cross_w = int(SIZE * 0.09)
    cross_h = int(SIZE * 0.42)
    cross_bar_w = int(SIZE * 0.28)
    cross_bar_h = int(SIZE * 0.09)
    cross_top = int(SIZE * 0.22)
    vx0 = cx - cross_w // 2
    draw.rounded_rectangle(
        [vx0, cross_top, vx0 + cross_w, cross_top + cross_h],
        radius=cross_w // 3,
        fill=BLACK,
    )
    hy = cross_top + int(cross_h * 0.28)
    hx0 = cx - cross_bar_w // 2
    draw.rounded_rectangle(
        [hx0, hy, hx0 + cross_bar_w, hy + cross_bar_h],
        radius=cross_bar_h // 3,
        fill=BLACK,
    )

    ff_left = cx + int(SIZE * 0.02)
    ff_top = int(SIZE * 0.38)
    ff_h = int(SIZE * 0.28)
    ff_stem = int(SIZE * 0.055)
    ff_bar = int(SIZE * 0.12)
    ff_gap = int(SIZE * 0.04)

    def draw_f(x: int, y: int) -> None:
        draw.rounded_rectangle(
            [x, y, x + ff_stem, y + ff_h], radius=ff_stem // 3, fill=BLACK
        )
        draw.rounded_rectangle(
            [x, y, x + ff_bar, y + ff_stem], radius=ff_stem // 3, fill=BLACK
        )
        mid_y = y + int(ff_h * 0.38)
        draw.rounded_rectangle(
            [x, mid_y, x + int(ff_bar * 0.85), mid_y + ff_stem],
            radius=ff_stem // 3,
            fill=BLACK,
        )

    draw_f(ff_left, ff_top)
    draw_f(ff_left + ff_bar + ff_gap - ff_stem, ff_top)

    out = Image.new("RGB", (SIZE, SIZE), CREAM[:3])
    out.paste(img, mask=img.split()[-1])
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, "PNG", optimize=True)
    for filename, pixels in ICON_SIZES.items():
        out.resize((pixels, pixels), Image.Resampling.LANCZOS).save(
            dest.parent / filename, "PNG", optimize=True
        )
    print(f"Wrote {dest} ({dest.stat().st_size} bytes)")


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    dest = (
        root
        / "FunctioningFaith"
        / "Resources"
        / "Assets.xcassets"
        / "AppIcon.appiconset"
        / "AppIcon.png"
    )
    generate(dest)


if __name__ == "__main__":
    main()
