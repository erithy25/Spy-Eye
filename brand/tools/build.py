"""Writes the wordmark of Sicht as outlined SVG files and the pictures derived from them.

    python3 brand/tools/build.py

Output, next to this folder:

    sicht-wortmarke-hell.svg     light letters, for dark grounds (the normal case)
    sicht-wortmarke-dunkel.svg   dark letters, for paper
    sicht-wortmarke-hell.png, sicht-wortmarke-dunkel.png   2400 px wide, transparent ground
    sicht-eckmarke.svg           the corner mark that frames pictures and map details
    sicht-karte.png              1200 x 630, the card shown when a link to Sicht is shared
    sicht-profil.png             800 x 800, for a profile picture

The wordmark is the word SICHT in JetBrains Mono Bold, capitals, tracked by 0.42 em, as on the
website and the one-pager. The letters are written as outlines, so the files need no font.
There is no symbol: docs/BRAND.md says that the wordmark stands alone.

Needs fontTools (pip install fonttools) for the outlines and, for the PNG files, Node with the
sharp package that the server of this repository installs. JetBrains Mono is licensed under the
SIL Open Font License 1.1 (media/brand/fonts/OFL.txt); outlines taken from it may be used freely.
"""
import pathlib
import subprocess

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent
REPO = OUT.parent
FONTS = REPO / "media" / "brand" / "fonts"

GROUND = "#050505"
LIGHT = "#ededed"
DARK = "#050505"
SECONDARY = "#8a8a8a"

WORD = "SICHT"
TRACKING = 0.42  # em, as in the header of the website


def outline(font_file, text, size, tracking_em, x0, baseline):
    """SVG path data for `text` set at `size` px with extra advance; returns (path, width in px)."""
    font = TTFont(str(font_file))
    upm = font["head"].unitsPerEm
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = size / upm
    pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    x = x0
    last_ink = x0
    for ch in text:
        name = cmap[ord(ch)]
        advance = font["hmtx"][name][0]
        # Font units have y up; SVG has y down.
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
        last_ink = x + advance * scale
        x += advance * scale + tracking_em * size
    return pen.getCommands(), last_ink - x0


def cap_height(font_file):
    font = TTFont(str(font_file))
    return font["OS/2"].sCapHeight / font["head"].unitsPerEm


def wordmark_svg(colour):
    """The wordmark alone, with a clear space of half a cap height on every side."""
    size = 200.0
    cap = cap_height(FONTS / "JetBrainsMono-Bold.ttf") * size
    pad = cap / 2
    path, width = outline(FONTS / "JetBrainsMono-Bold.ttf", WORD, size, TRACKING, pad, pad + cap)
    w, h = width + 2 * pad, cap + 2 * pad
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.1f} {h:.1f}" width="{w:.0f}" height="{h:.0f}" role="img" aria-label="Sicht">\n'
        f'  <title>Sicht</title>\n'
        f'  <path fill="{colour}" d="{path}"/>\n'
        f"</svg>\n"
    )


def corner_mark_svg():
    """Four angles around a square: the frame Sicht puts around pictures and map details."""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="320" height="320" role="img" aria-label="Eckmarke">\n'
        "  <title>Eckmarke</title>\n"
        f'  <path d="M5 12V5h7M20 5h7v7M27 20v7h-7M12 27H5v-7" fill="none" stroke="{LIGHT}" stroke-width="2"/>\n'
        "</svg>\n"
    )


def corners(x, y, w, h, arm, stroke, colour):
    return (
        f'<path fill="none" stroke="{colour}" stroke-width="{stroke}" d="'
        f"M{x} {y + arm}V{y}h{arm}M{x + w - arm} {y}h{arm}v{arm}"
        f'M{x + w} {y + h - arm}v{arm}h{-arm}M{x + arm} {y + h}h{-arm}v{-arm}"/>'
    )


def card_svg():
    """1200 x 630: ground, corner marks, wordmark, tagline, one line on what it is."""
    w, h = 1200, 630
    bold = FONTS / "JetBrainsMono-Bold.ttf"
    medium = FONTS / "JetBrainsMono-Medium.ttf"
    regular = FONTS / "JetBrainsMono-Regular.ttf"
    left = 112
    mark, _ = outline(bold, WORD, 44, TRACKING, left, 140)
    claim1, _ = outline(medium, "Keine Sicht", 82, -0.01, left, 318)
    claim2, _ = outline(medium, "ohne Aufsicht.", 82, -0.01, left, 418)
    line, _ = outline(regular, "DIE BILDSCHICHT FÜR DAS ZIVILE LAGEBILD", 19, 0.2, left, 520)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">\n'
        f'  <rect width="{w}" height="{h}" fill="{GROUND}"/>\n'
        f"  {corners(56, 56, w - 112, h - 112, 28, 2, LIGHT)}\n"
        f'  <path fill="{LIGHT}" d="{mark}"/>\n'
        f'  <path fill="{LIGHT}" d="{claim1}"/>\n'
        f'  <path fill="{LIGHT}" d="{claim2}"/>\n'
        f'  <path fill="{SECONDARY}" d="{line}"/>\n'
        f"</svg>\n"
    )


def profile_svg():
    """800 x 800: the wordmark inside the corner mark."""
    size = 800
    bold = FONTS / "JetBrainsMono-Bold.ttf"
    font_px = 92.0
    cap = cap_height(bold) * font_px
    probe, width = outline(bold, WORD, font_px, TRACKING, 0, 0)
    x0 = (size - width) / 2
    path, _ = outline(bold, WORD, font_px, TRACKING, x0, size / 2 + cap / 2)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">\n'
        f'  <rect width="{size}" height="{size}" fill="{GROUND}"/>\n'
        f"  {corners(96, 96, size - 192, size - 192, 56, 4, LIGHT)}\n"
        f'  <path fill="{LIGHT}" d="{path}"/>\n'
        f"</svg>\n"
    )


RASTER = r"""
const { createRequire } = require('node:module');
const path = require('node:path');
const [repo, out, work] = process.argv.slice(2);
const sharp = createRequire(path.join(repo, 'apps', 'server', 'package.json'))('sharp');
const jobs = [
  ['sicht-wortmarke-hell.svg', 'sicht-wortmarke-hell.png', { width: 2400 }, out],
  ['sicht-wortmarke-dunkel.svg', 'sicht-wortmarke-dunkel.png', { width: 2400 }, out],
  ['karte.svg', 'sicht-karte.png', { width: 1200, height: 630 }, work],
  ['profil.svg', 'sicht-profil.png', { width: 800, height: 800 }, work],
];
(async () => {
  for (const [from, to, size, dir] of jobs) {
    const info = await sharp(path.join(dir, from), { density: 300 }).resize(size).png({ compressionLevel: 9 }).toFile(path.join(out, to));
    console.log(`${to} ${info.width}x${info.height} ${Math.round(info.size / 1024)} kB`);
  }
})().catch((err) => { console.error(err.message); process.exit(1); });
"""


def main():
    work = HERE / ".work"
    work.mkdir(exist_ok=True)
    (OUT / "sicht-wortmarke-hell.svg").write_text(wordmark_svg(LIGHT), encoding="utf-8")
    (OUT / "sicht-wortmarke-dunkel.svg").write_text(wordmark_svg(DARK), encoding="utf-8")
    (OUT / "sicht-eckmarke.svg").write_text(corner_mark_svg(), encoding="utf-8")
    (work / "karte.svg").write_text(card_svg(), encoding="utf-8")
    (work / "profil.svg").write_text(profile_svg(), encoding="utf-8")
    script = work / "raster.cjs"
    script.write_text(RASTER, encoding="utf-8")
    subprocess.run(["node", str(script), str(REPO), str(OUT), str(work)], check=True)
    for leftover in work.iterdir():
        leftover.unlink()
    work.rmdir()


if __name__ == "__main__":
    main()
