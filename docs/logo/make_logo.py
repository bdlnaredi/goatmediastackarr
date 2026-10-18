#!/usr/bin/env python3
"""Draws the GoatMediaStackarr logo: G.O.A.T. as in Greatest Of All Time.

A victory laurel and star around radar rings and a G drawn as a ring with a play button inside,
gold on navy. The same shapes produce docs/logo/logo.svg (sharp at any size, used in the README)
and the PNG icons the web app and Unraid use. Needs only Pillow:  python3 docs/logo/make_logo.py
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]

NAVY = (15, 26, 46)
GOLD = (232, 192, 104)
SS = 4  # supersampling for smooth PNG edges

# Design grid is 200 x 200. The mark is drawn around (100, 93) and placed on the tile scaled to 0.84.
SCALE, MARK_CY = 0.84, 93
STAR = [(100, 12), (103.5, 21), (113, 21), (105.5, 27), (108.5, 36), (100, 30.5),
        (91.5, 36), (94.5, 27), (87, 21), (96.5, 21)]
LEAVES_LEFT = [(55, 159, 150), (39.4, 140, 170), (31, 117, 190), (31, 93, 210), (39.4, 70, 230), (55, 51, 250)]
LEAVES = LEAVES_LEFT + [(200 - x, y, -a) for x, y, a in LEAVES_LEFT]
LEAF_RX, LEAF_RY = 6, 14
RING = (100, 105, 55, 3)          # cx, cy, r, stroke width (drawn at half opacity)
DOT = (138.9, 66.1, 6)
G_CX, G_CY, G_R, G_W = 100, 105, 40, 14
G_START, G_SWEEP = -45, -315      # degrees, y axis pointing down; the arc runs over the top and round to 3 o'clock
BAR_END = 116
PLAY = [(82, 90), (82, 120), (104, 105)]
PLAY_W = 5


def svg():
    leaves = "\n".join(
        f'<ellipse cx="{x:g}" cy="{y:g}" rx="{LEAF_RX}" ry="{LEAF_RY}" transform="rotate({a:g} {x:g} {y:g})"/>'
        for x, y, a in LEAVES)
    sx = G_CX + G_R * math.cos(math.radians(G_START))
    sy = G_CY + G_R * math.sin(math.radians(G_START))
    star = " ".join(f"{x:g},{y:g}" for x, y in STAR)
    play = " ".join(f"{x:g},{y:g}" for x, y in PLAY)
    gold = "rgb(%d, %d, %d)" % GOLD
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="GoatMediaStackarr">
<rect width="200" height="200" rx="44" fill="rgb({NAVY[0]}, {NAVY[1]}, {NAVY[2]})"/>
<g transform="translate(100 100) scale({SCALE}) translate(-100 -{MARK_CY})" fill="{gold}">
<polygon points="{star}"/>
{leaves}
<circle cx="{RING[0]}" cy="{RING[1]}" r="{RING[2]}" fill="none" stroke="{gold}" stroke-width="{RING[3]}" opacity="0.5"/>
<circle cx="{DOT[0]}" cy="{DOT[1]}" r="{DOT[2]}"/>
<path d="M{sx:.1f} {sy:.1f} A{G_R} {G_R} 0 1 0 {G_CX + G_R} {G_CY} H{BAR_END}" fill="none" stroke="{gold}" stroke-width="{G_W}" stroke-linecap="round" stroke-linejoin="round"/>
<polygon points="{play}" stroke="{gold}" stroke-width="{PLAY_W}" stroke-linejoin="round"/>
</g>
</svg>
'''


def png(size, rounded=True):
    k = size * SS / 200

    def p(x, y):  # design grid -> pixels
        return ((x - 100) * SCALE + 100) * k, ((y - MARK_CY) * SCALE + 100) * k

    def dot(d, x, y, r, fill):
        cx, cy = p(x, y); rr = r * SCALE * k
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=fill)

    W = size * SS
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, W - 1, W - 1], radius=44 * k, fill=NAVY + (255,))
    else:
        d.rectangle([0, 0, W, W], fill=NAVY + (255,))

    # radar ring at half opacity, on its own layer
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    cx, cy = p(RING[0], RING[1]); r = RING[2] * SCALE * k; w = RING[3] * SCALE * k
    ld.ellipse([cx - r - w / 2, cy - r - w / 2, cx + r + w / 2, cy + r + w / 2], outline=GOLD + (128,), width=max(1, round(w)))
    img.alpha_composite(layer)
    d = ImageDraw.Draw(img)

    fill = GOLD + (255,)
    d.polygon([p(x, y) for x, y in STAR], fill=fill)
    for x, y, a in LEAVES:
        t = math.radians(a)
        pts = []
        for i in range(72):
            u = 2 * math.pi * i / 72
            ex, ey = LEAF_RX * math.cos(u), LEAF_RY * math.sin(u)
            pts.append(p(x + ex * math.cos(t) - ey * math.sin(t), y + ex * math.sin(t) + ey * math.cos(t)))
        d.polygon(pts, fill=fill)
    dot(d, *DOT, fill)

    # the G: a thick arc band with round ends, then the bar
    h = G_W / 2
    steps = 180
    outer, inner = [], []
    for i in range(steps + 1):
        t = math.radians(G_START + G_SWEEP * i / steps)
        outer.append(p(G_CX + (G_R + h) * math.cos(t), G_CY + (G_R + h) * math.sin(t)))
        inner.append(p(G_CX + (G_R - h) * math.cos(t), G_CY + (G_R - h) * math.sin(t)))
    d.polygon(outer + inner[::-1], fill=fill)
    st = math.radians(G_START)
    dot(d, G_CX + G_R * math.cos(st), G_CY + G_R * math.sin(st), h, fill)
    x0, y0 = p(BAR_END, G_CY - h); x1, y1 = p(G_CX + G_R, G_CY + h)
    d.rectangle([x0, y0, x1, y1], fill=fill)
    dot(d, BAR_END, G_CY, h, fill)
    dot(d, G_CX + G_R, G_CY, h, fill)

    # play button with rounded corners
    tri = [p(x, y) for x, y in PLAY]
    d.polygon(tri, fill=fill)
    d.line(tri + [tri[0]], fill=fill, width=round(PLAY_W * SCALE * k), joint="curve")
    for x, y in PLAY:
        dot(d, x, y, PLAY_W / 2, fill)

    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    out = ROOT / "docs" / "logo"
    pub = ROOT / "ui" / "public"
    (out / "logo.svg").write_text(svg())
    png(1024).save(out / "logo-1024.png")
    png(512).save(pub / "icon-512.png")
    png(192).save(pub / "icon-192.png")
    png(180, rounded=False).convert("RGB").save(pub / "apple-touch-icon.png")
    png(64).save(pub / "favicon.png")
    (pub / "logo.svg").write_text(svg())
    print("logo written")
