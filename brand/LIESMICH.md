# Marke: Dateien

Die Wortmarke von Sicht als Dateien, für alles außerhalb von Website, Präsentation und Konsole:
Anschreiben, Signaturen, Profilbilder, Vorschaubilder geteilter Verweise. Die Regeln dazu stehen in
[`docs/BRAND.md`](../docs/BRAND.md); dieses Blatt nennt nur, welche Datei wofür gedacht ist.

| Datei | Wofür |
| --- | --- |
| `sicht-wortmarke-hell.svg`, `.png` | Wortmarke in hellen Buchstaben (`#ededed`) auf dunklem Grund. Der Normalfall. |
| `sicht-wortmarke-dunkel.svg`, `.png` | Wortmarke in dunklen Buchstaben (`#050505`) auf Papier und hellem Grund. |
| `sicht-eckmarke.svg` | Die Eckmarke: vier Winkel, die ein Bild oder einen Kartenausschnitt fassen. Kein Zeichen für sich; sie steht nie ohne Inhalt oder Wortmarke. |
| `sicht-karte.png` | 1200 × 630, das Vorschaubild für einen geteilten Verweis. |
| `sicht-profil.png` | 800 × 800, Profilbild. |

## Regeln in Kürze

- Die Wortmarke ist das Wort SICHT in JetBrains Mono Bold, Versalien, um 0,42 Geviert gesperrt.
  Die Buchstaben liegen in den SVG-Dateien als Umrisse vor; es braucht keine Schrift.
- Es gibt kein Bildzeichen. Die Wortmarke steht allein.
- Freiraum: ringsum mindestens die halbe Höhe der Buchstaben. Die SVG- und PNG-Dateien der
  Wortmarke enthalten diesen Rand bereits.
- Nur Schwarz, Weiß und die Grautöne aus `docs/BRAND.md`. Keine Farbe, kein Verlauf, kein
  Schatten, keine Kontur, nicht verzerren, nicht neu setzen.
- Die PNG-Dateien der Wortmarke haben einen durchsichtigen Grund.

## Neu erzeugen

```bash
python3 brand/tools/build.py
```

Braucht fontTools (`pip install fonttools`) und Node mit dem Paket sharp, das der Server dieses
Repositorys mitbringt. Die Umrisse stammen aus JetBrains Mono (SIL Open Font License 1.1,
`media/brand/fonts/OFL.txt`).

## Vor der ersten öffentlichen Verwendung

Der Name „Sicht“ ist markenrechtlich nicht geprüft (DPMA, EUIPO, Firmennamen). Bis das geschehen
ist, sind diese Dateien für den internen Gebrauch und für Gespräche unter vier Augen gedacht,
nicht für öffentliche Auftritte.
