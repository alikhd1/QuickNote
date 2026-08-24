"""Generate src-tauri/icons/icon.ico.

Kept in the repo so the icon is reproducible rather than an opaque binary blob nobody
can regenerate. Pure standard library: no Pillow, no build-time dependency.

Run from the repo root:  python tools/make-icon.py
"""

import math
import os
import struct
import zlib

SIZES = [16, 32, 48, 64, 128, 256]
PAGE = (74, 99, 231)  # indigo, matching --accent in the UI
LINE = (255, 255, 255)
OUT = os.path.join("src-tauri", "icons", "icon.ico")


def rounded_rect_coverage(px, py, cx, cy, half_w, half_h, radius):
    """Antialiased coverage of a rounded rectangle, via its signed distance field.

    Cheaper and smoother than supersampling, and it keeps the small sizes crisp.
    """
    dx = abs(px - cx) - (half_w - radius)
    dy = abs(py - cy) - (half_h - radius)
    outside = math.hypot(max(dx, 0.0), max(dy, 0.0))
    inside = min(max(dx, dy), 0.0)
    distance = outside + inside - radius
    return min(max(0.5 - distance, 0.0), 1.0)


def over(dst, src, alpha):
    """Composite src over dst with the given alpha."""
    return tuple(int(round(s * alpha + d * (1.0 - alpha))) for s, d in zip(src, dst))


def render(size):
    s = float(size)
    margin = s * 0.09
    half = (s - 2 * margin) / 2.0
    cx = cy = s / 2.0
    radius = s * 0.20

    # Three "text" lines; the first is short, like a title.
    bar_h = max(s * 0.070, 1.0)
    bar_r = bar_h / 2.0
    bars = [
        (s * 0.30, s * 0.36, s * 0.62),
        (s * 0.30, s * 0.52, s * 0.70),
        (s * 0.30, s * 0.66, s * 0.70),
    ]

    rows = []
    for y in range(size):
        row = []
        py = y + 0.5
        for x in range(size):
            px = x + 0.5

            page_a = rounded_rect_coverage(px, py, cx, cy, half, half, radius)
            if page_a <= 0.0:
                row.append((0, 0, 0, 0))
                continue

            rgb = PAGE
            for left, top, right in bars:
                bar_cx = (left + right) / 2.0
                bar_cy = top + bar_h / 2.0
                a = rounded_rect_coverage(
                    px, py, bar_cx, bar_cy, (right - left) / 2.0, bar_h / 2.0, bar_r
                )
                if a > 0.0:
                    rgb = over(rgb, LINE, a)

            row.append((rgb[0], rgb[1], rgb[2], int(round(page_a * 255))))
        rows.append(row)
    return rows


def to_png(size, rows):
    raw = b"".join(
        b"\x00" + b"".join(struct.pack("4B", *px) for px in row) for row in rows
    )

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main():
    images = [(size, to_png(size, render(size))) for size in SIZES]

    header = struct.pack("<HHH", 0, 1, len(images))
    offset = len(header) + 16 * len(images)
    entries, blobs = [], []

    for size, png in images:
        # 0 means 256 in the ICO directory format.
        dim = 0 if size >= 256 else size
        entries.append(
            struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(png), offset)
        )
        blobs.append(png)
        offset += len(png)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "wb") as fh:
        fh.write(header + b"".join(entries) + b"".join(blobs))

    print("wrote {} ({} bytes, sizes {})".format(OUT, offset, SIZES))


if __name__ == "__main__":
    main()
