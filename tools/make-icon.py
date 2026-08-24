"""Generate the full icon set in src-tauri/icons/.

Kept in the repo so the icons are reproducible rather than opaque binaries nobody can
regenerate. Pure standard library: no Pillow, and no dependency on `tauri icon` (which
would need the Node toolchain just to redraw a square).

Produces what tauri.conf.json's bundle.icon list refers to, across all three platforms:

    32x32.png  128x128.png  128x128@2x.png  icon.png   (Linux, Windows, general)
    icon.ico                                           (Windows)
    icon.icns                                          (macOS)

Run from the repo root:  python tools/make-icon.py
"""

import math
import os
import struct
import zlib

OUT_DIR = os.path.join("src-tauri", "icons")

PAGE = (74, 99, 231)  # indigo, matching --accent in the UI
LINE = (255, 255, 255)

# Sizes rendered once and reused by every container below.
SIZES = [32, 64, 128, 256, 512]

# Plain PNG files Tauri and Linux packaging expect, as (filename, pixel size).
PNG_FILES = [
    ("32x32.png", 32),
    ("128x128.png", 128),
    ("128x128@2x.png", 256),
    ("icon.png", 512),
]

ICO_SIZES = [32, 64, 128, 256]

# macOS icon types, as (OSType, pixel size). All PNG-encoded, which macOS has accepted
# since 10.7.
ICNS_ENTRIES = [
    (b"ic11", 32),   # 16pt @2x
    (b"ic12", 64),   # 32pt @2x
    (b"ic07", 128),  # 128pt
    (b"ic08", 256),  # 256pt
    (b"ic13", 256),  # 128pt @2x
    (b"ic09", 512),  # 512pt
    (b"ic14", 512),  # 256pt @2x
]


def rounded_rect_coverage(px, py, cx, cy, half_w, half_h, radius):
    """Antialiased coverage of a rounded rectangle, via its signed distance field.

    Cheaper and smoother than supersampling, and it keeps the small sizes crisp.
    """
    dx = abs(px - cx) - (half_w - radius)
    dy = abs(py - cy) - (half_h - radius)
    outside = math.hypot(max(dx, 0.0), max(dy, 0.0))
    inside = min(max(dx, dy), 0.0)
    return min(max(0.5 - (outside + inside - radius), 0.0), 1.0)


def over(dst, src, alpha):
    """Composite src over dst with the given alpha."""
    return tuple(int(round(s * alpha + d * (1.0 - alpha))) for s, d in zip(src, dst))


def render(size):
    """Draw the icon at `size` and return rows of RGBA tuples."""
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
                a = rounded_rect_coverage(
                    px,
                    py,
                    (left + right) / 2.0,
                    top + bar_h / 2.0,
                    (right - left) / 2.0,
                    bar_h / 2.0,
                    bar_r,
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


def build_ico(pngs):
    """Windows .ico: a directory of PNG-encoded images."""
    header = struct.pack("<HHH", 0, 1, len(ICO_SIZES))
    offset = len(header) + 16 * len(ICO_SIZES)
    entries, blobs = [], []

    for size in ICO_SIZES:
        png = pngs[size]
        # 0 means 256 in the ICO directory format.
        dim = 0 if size >= 256 else size
        entries.append(struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(png), offset))
        blobs.append(png)
        offset += len(png)

    return header + b"".join(entries) + b"".join(blobs)


def build_icns(pngs):
    """macOS .icns: a length-prefixed container of typed, PNG-encoded entries."""
    body = b"".join(
        ostype + struct.pack(">I", len(pngs[size]) + 8) + pngs[size]
        for ostype, size in ICNS_ENTRIES
    )
    return b"icns" + struct.pack(">I", len(body) + 8) + body


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    print("rendering...")
    pngs = {size: to_png(size, render(size)) for size in SIZES}

    written = []
    for name, size in PNG_FILES:
        path = os.path.join(OUT_DIR, name)
        with open(path, "wb") as fh:
            fh.write(pngs[size])
        written.append((name, len(pngs[size])))

    for name, data in (("icon.ico", build_ico(pngs)), ("icon.icns", build_icns(pngs))):
        with open(os.path.join(OUT_DIR, name), "wb") as fh:
            fh.write(data)
        written.append((name, len(data)))

    for name, size in written:
        print("  {:<16} {:>8} bytes".format(name, size))
    print("wrote {} files to {}".format(len(written), OUT_DIR))


if __name__ == "__main__":
    main()
