#!/usr/bin/env python3
"""Writes media/brand/ablauf-datum-produktfilm.txt from the marks of a DATUM console take.

    node media/brand/tools/datum-take.cjs
    ffmpeg -i media/product/raw-datum/<file>.webm -r 25 -c:v libx264 -crf 16 -pix_fmt yuv420p media/product/datum-take.mp4
    python3 media/brand/tools/datum_sequence.py
    cd media/brand && CLIP_W=1728 CLIP_H=972 SEQ=ablauf-datum-produktfilm.txt ./build.sh

Each clip runs from shortly after its mark to shortly before the next one; starts and lengths
are kept on tenths of a second. The walks through the 3D views are recorded with WebGL in
software (a few frames per second, and the controls move by at most a tenth of a second per
frame, so the take runs slow): they are cut out and played four times as fast, which gives about
natural speed; their labels say so.
"""
import json
import pathlib
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
BRAND = HERE.parent
MARKS = BRAND.parent / 'product' / 'datum-marks.json'
OUT = BRAND / 'ablauf-datum-produktfilm.txt'
TAKE = '../product/datum-take.mp4'

marks = {m['name']: m['t'] for m in json.loads(MARKS.read_text(encoding='utf-8'))['marks']}
needed = ['welt', 'turm', 'befund', 'raum', 'gehen', 'glen', 'gelaende', 'messung', 'ende']
missing = [k for k in needed if k not in marks]
if missing:
    raise SystemExit(f'take lacks marks: {missing}')


def clip(start_mark: str, end_mark: str, label: str, lead: float = 0.3, tail: float = 0.2, skip: float = 0.0) -> str:
    start = round(marks[start_mark] + lead + skip, 1)
    length = round(marks[end_mark] - tail - start, 1)
    if length <= 0.5:
        raise SystemExit(f'clip {start_mark}..{end_mark} too short: {length}')
    return f'clip|{TAKE}|{start:.1f}|{length:.1f}|{label}'


def fast(start_mark: str, end_mark: str, name: str, label: str, factor: int = 4, lead: float = 0.3, tail: float = 0.5) -> str:
    """Cuts a segment out of the take, plays it `factor` times as fast, returns its clip line."""
    start = round(marks[start_mark] + lead, 1)
    length = round(marks[end_mark] - tail - start, 1)
    out = BRAND.parent / 'product' / f'datum-{name}-x{factor}.mp4'
    subprocess.run(
        ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', f'{start:.1f}', '-t', f'{length:.1f}',
         '-i', str(BRAND.parent / 'product' / 'datum-take.mp4'), '-vf', f'setpts=PTS/{factor}', '-r', '25', '-an',
         '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', str(out)],
        check=True,
    )
    return f'clip|../product/{out.name}|0.0|{length / factor:.1f}|{label} · {factor}-FACH BESCHLEUNIGT'


lines = [
    '# DATUM — Produktfilm: die Konsole am Referenzbestand, ein durchgehender Mitschnitt.',
    '# Erzeugt von tools/datum_sequence.py aus media/product/datum-marks.json; nicht von Hand ändern.',
    '#',
    '#   cd media/brand && CLIP_W=1728 CLIP_H=972 SEQ=ablauf-datum-produktfilm.txt ./build.sh',
    '',
    'set|OUT|datum-produktfilm.mp4',
    'set|END_WORD|DATUM',
    'set|END_LINE|JEDES BILD HAT EINEN ORT UND EINE UHRZEIT.',
    'set|END_NOTE|BILDSCHIRMAUFNAHME DER KONSOLE · REFERENZBESTAND AUS WIKIMEDIA COMMONS · ERPROBUNGSSTAND',
    'set|MUSIC|audio/bed-lang.mp3',
    '',
    'card|d01-titel|3.0||DATUM|ORT UND UHRZEIT AUS EINEM VIDEO.',
    'card|d02-bestand|3.0|REFERENZBESTAND · WIKIMEDIA COMMONS|60 VIDEOS AUS 30 LÄNDERN.|KEIN GPS. KEINE AUFNAHMEZEIT.',
    clip('welt', 'turm', 'ORTUNG · JEDES VIDEO AUF DER KARTE', lead=0.2),
    clip('turm', 'befund', 'ORTUNG · ORT, UHRZEIT, SONNE UND SCHATTEN'),
    'card|d03-beleg|2.4||JEDE AUSSAGE MIT BELEG.',
    clip('befund', 'raum', 'BEFUND · REFERENZBILDER, UHR, ABLAUF DER ORTUNG'),
    'card|d04-raum|2.8||AUS EINEM BILD WIRD EIN RAUM.',
    clip('raum', 'gehen', 'RAUM · AUS EINEM EINZIGEN BILD DES VIDEOS', skip=1.1),
    fast('gehen', 'glen', 'gehen', 'RAUM · BEGEHBAR, NUR AUS DEM VIDEO'),
    '',
    'mark|turn',
    'card|d05-horizont|3.0||IM GEBIRGE VERRÄT DER HORIZONT|DIE BLICKRICHTUNG.',
    clip('glen', 'gelaende', 'ORTUNG · HÖHENLINIEN UND BLICKKEGEL', skip=0.8),
    fast('gelaende', 'messung', 'gelaende', 'RAUM · GELÄNDE MIT SONNENBAHN', lead=1.7),
    'card|d06-gemessen|2.6||GEMESSEN, NICHT BEHAUPTET.',
    clip('messung', 'ende', 'MESSUNG · ABWEICHUNG GEGEN DIE GRUNDWAHRHEIT'),
    'end|4.4',
    '',
]
OUT.write_text('\n'.join(lines), encoding='utf-8')
print(OUT.name)
for line in lines:
    if line.startswith('clip'):
        print('  ', line.split('|', 2)[2])
