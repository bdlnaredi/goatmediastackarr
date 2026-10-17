#!/usr/bin/env python3
"""Draws the GoatMediaStackarr logo: a goat head with amber horns and a play button on its forehead.

The same shapes produce docs/logo/logo.svg (sharp at any size, used in the README) and the PNG icons the
web app and Unraid use. Needs only Pillow:  python3 docs/logo/make_logo.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
S = 512  # design grid

BG_TOP, BG_BOTTOM = (36, 22, 74), (12, 70, 78)        # deep violet to deep teal
HORN_A, HORN_B = (255, 205, 92), (236, 112, 52)       # amber to orange
FACE = (246, 240, 229)
INK = (36, 22, 74)
PLAY = (236, 112, 52)


def cubic(p0, p1, p2, p3, n=48):
    pts = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3
        pts.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return pts


class Shape:
    """A closed outline made of cubic curves, kept both as SVG path data and as points for Pillow."""
    def __init__(self, start):
        self.start, self.cur, self.d, self.pts = start, start, [f"M{start[0]:g} {start[1]:g}"], [start]

    def c(self, p1, p2, p3):
        self.d.append(f"C{p1[0]:g} {p1[1]:g} {p2[0]:g} {p2[1]:g} {p3[0]:g} {p3[1]:g}")
        self.pts += cubic(self.cur, p1, p2, p3)[1:]
        self.cur = p3
        return self

    def l(self, p):
        self.d.append(f"L{p[0]:g} {p[1]:g}")
        self.pts.append(p); self.cur = p
        return self

    def path(self):
        return " ".join(self.d) + " Z"

    def mirrored(self):
        m = Shape((S - self.start[0], self.start[1]))
        m.d = [seg for seg in self._mirror_d()]
        m.pts = [(S - x, y) for x, y in self.pts]
        return m

    def _mirror_d(self):
        out = []
        for seg in self.d:
            nums = [float(v) for v in seg[1:].split()]
            for i in range(0, len(nums), 2):
                nums[i] = S - nums[i]
            out.append(seg[0] + " ".join(f"{v:g}" for v in nums))
        return out


# ---- shapes (left side; the right side is mirrored) ----
horn = (Shape((192, 230))
        .c((150, 186), (100, 146), (96, 88))       # outer edge sweeping up and out
        .c((94, 52), (126, 34), (158, 46))         # rounded tip curling back
        .c((140, 62), (146, 104), (186, 136))      # inner edge coming back down
        .c((216, 160), (240, 176), (254, 206)))    # into the forehead

ear = (Shape((182, 246))
       .c((150, 236), (112, 244), (86, 268))
       .c((116, 286), (152, 290), (186, 280)))

face = (Shape((256, 190))
        .c((300, 190), (330, 206), (338, 236))     # right forehead
        .c((346, 268), (336, 300), (316, 336))     # right cheek
        .c((302, 362), (300, 396), (282, 414))     # right muzzle
        .c((272, 424), (240, 424), (230, 414))     # chin
        .c((212, 396), (210, 362), (196, 336))     # left muzzle
        .c((176, 300), (166, 268), (174, 236))     # left cheek
        .c((182, 206), (212, 190), (256, 190)))    # left forehead

beard = (Shape((236, 414))
         .c((246, 430), (250, 452), (256, 474))
         .c((262, 452), (266, 430), (276, 414)))

eye = (Shape((204, 284))
       .c((210, 270), (234, 268), (242, 282))
       .c((236, 298), (210, 300), (204, 284)))

nose = (Shape((236, 376)).c((240, 368), (250, 370), (250, 380)).c((246, 386), (238, 384), (236, 376)))

play = Shape((242, 226)).l((242, 266)).l((276, 246))


def svg():
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" role="img" aria-label="GoatMediaStackarr">',
        '<defs>',
        f'<linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="rgb{BG_TOP}"/><stop offset="1" stop-color="rgb{BG_BOTTOM}"/></linearGradient>',
        f'<linearGradient id="horn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb{HORN_A}"/><stop offset="1" stop-color="rgb{HORN_B}"/></linearGradient>',
        '</defs>',
        f'<rect width="{S}" height="{S}" rx="116" fill="url(#bg)"/>',
    ]
    for shp in (horn, horn.mirrored()):
        parts.append(f'<path d="{shp.path()}" fill="url(#horn)"/>')
    for shp in (ear, ear.mirrored()):
        parts.append(f'<path d="{shp.path()}" fill="rgb{FACE}" opacity="0.92"/>')
    parts.append(f'<path d="{face.path()}" fill="rgb{FACE}"/>')
    parts.append(f'<path d="{beard.path()}" fill="rgb{FACE}"/>')
    for shp in (eye, eye.mirrored(), nose, nose.mirrored()):
        parts.append(f'<path d="{shp.path()}" fill="rgb{INK}"/>')
    parts.append(f'<path d="{play.path()}" fill="rgb{PLAY}" stroke="rgb{PLAY}" stroke-width="6" stroke-linejoin="round"/>')
    parts.append('</svg>')
    return "\n".join(parts) + "\n"


def gradient(size, top, bottom, slant=0.35):
    w, h = size
    g = Image.new("RGB", size)
    px = g.load()
    for y in range(h):
        for x in range(w):
            t = min(1.0, max(0.0, (y / h) * (1 - slant) + (x / w) * slant))
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
    return g


def png(size, rounded=True):
    k = 4                      # draw large, then shrink, for smooth edges
    W = S * k
    sc = lambda pts: [(x * k, y * k) for x, y in pts]
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    bg = gradient((W // 8, W // 8), BG_TOP, BG_BOTTOM).resize((W, W), Image.BICUBIC)
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, W - 1, W - 1), radius=116 * k if rounded else 0, fill=255)
    img.paste(bg, (0, 0), mask)

    horns = Image.new("L", (W, W), 0)
    d = ImageDraw.Draw(horns)
    for shp in (horn, horn.mirrored()):
        d.polygon(sc(shp.pts), fill=255)
    hg = gradient((8, W // 8), HORN_A, HORN_B, slant=0).resize((W, W), Image.BICUBIC)
    img.paste(hg, (0, 0), horns)

    d = ImageDraw.Draw(img)
    for shp in (ear, ear.mirrored()):
        d.polygon(sc(shp.pts), fill=FACE + (235,))
    d.polygon(sc(face.pts), fill=FACE + (255,))
    d.polygon(sc(beard.pts), fill=FACE + (255,))
    for shp in (eye, eye.mirrored(), nose, nose.mirrored()):
        d.polygon(sc(shp.pts), fill=INK + (255,))
    # Rounded play button: the triangle, a thick outline and a dot on each corner (matches stroke-linejoin round).
    corners = [(242, 226), (242, 266), (276, 246)]
    d.polygon(sc(corners), fill=PLAY + (255,))
    for a, b in zip(corners, corners[1:] + corners[:1]):
        d.line(sc([a, b]), fill=PLAY + (255,), width=6 * k)
    for x, y in corners:
        d.ellipse(((x - 3) * k, (y - 3) * k, (x + 3) * k, (y + 3) * k), fill=PLAY + (255,))
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    out = ROOT / "docs" / "logo"
    out.mkdir(parents=True, exist_ok=True)
    (out / "logo.svg").write_text(svg())
    png(1024).save(out / "logo-1024.png")
    pub = ROOT / "ui" / "public"
    png(512).save(pub / "icon-512.png")
    png(192).save(pub / "icon-192.png")
    png(180, rounded=False).convert("RGB").save(pub / "apple-touch-icon.png")
    png(64).save(pub / "favicon.png")
    (pub / "logo.svg").write_text(svg())
    print("logo written")
