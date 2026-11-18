"""Writes a letter-spaced copy of a monospaced font.

ffmpeg's drawtext filter has no letter-spacing option. The title cards are set in tracked
capitals, so the tracking is baked into the advance widths of a derived font file instead.

    python3 tools/track_font.py fonts/JetBrainsMono-Regular.ttf fonts/SichtCard-Regular-t160.ttf 160

The third argument is the extra advance in font units (1000 units = 1 em). Ligature and kerning
tables are dropped so that every character keeps exactly one cell. JetBrains Mono is licensed
under the SIL Open Font License 1.1 (fonts/OFL.txt); the derived files carry a different family
name and remain under the same licence.

Requires fontTools (pip install fonttools). The derived fonts are kept next to the originals,
so this script only has to run again when the tracking changes.
"""
import sys

from fontTools.ttLib import TTFont


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: track_font.py <in.ttf> <out.ttf> <extra advance in font units>")
    source, target, extra = sys.argv[1], sys.argv[2], int(sys.argv[3])
    font = TTFont(source)
    upm = font["head"].unitsPerEm
    delta = round(extra * upm / 1000)

    metrics = font["hmtx"].metrics
    for name, (advance, lsb) in list(metrics.items()):
        if advance > 0:
            metrics[name] = (advance + delta, lsb)
    font["hhea"].advanceWidthMax += delta
    font["OS/2"].xAvgCharWidth += delta

    # One glyph per character, no contextual substitutions.
    for table in ("GSUB", "GPOS", "kern"):
        if table in font:
            del font[table]

    style = font["name"].getDebugName(2) or "Regular"
    family = f"Sicht Card Mono t{extra}"
    for record in font["name"].names:
        if record.nameID in (1, 16):
            record.string = family
        elif record.nameID in (4,):
            record.string = f"{family} {style}"
        elif record.nameID == 6:
            record.string = f"SichtCardMono-t{extra}-{style}".replace(" ", "")
        elif record.nameID == 3:
            record.string = f"SichtCardMono-t{extra}-{style};derived from JetBrains Mono"
    font.save(target)
    print(f"{target}: advance +{delta} units ({extra / 1000:.3f} em)")


if __name__ == "__main__":
    main()
