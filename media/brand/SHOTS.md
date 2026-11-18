# Sicht — Markenfilm: Aufnahmen, Tafeln, Ton

Stand: 18. November 2026. Alles in diesem Ordner lässt sich mit `./build.sh` neu bauen.

## Ergebnis

| Datei | Inhalt |
| --- | --- |
| `sicht-markenfilm-v1.mp4` | Erster Schnitt, 39,6 s, 1920×1080, 25 B/s, H.264/AAC, 29 MB |
| `sicht-markenfilm-v1-web.mp4` | Dieselbe Fassung in 1280×720 zum Einbetten, 2,8 MB |
| `shots/*.mp4` | Neun angeglichene Aufnahmen, je 4,84 s, 1920×1080, Schwarzweiß, ohne Korn, ohne Einblendung, ohne Ton |
| `cards/*.mp4` | Die Tafeln des ersten Schnitts als einzelne Clips |
| `cards/ablauf-lang/*.mp4` | Die Tafeln der Langfassung |
| `audio/bed-elevenlabs.mp3` | Tonbett, 90 s |
| `raw/*.kling.mp4` | Die Aufnahmen, wie Higgsfield sie geliefert hat (1280×720, 24 B/s) |
| `raw/verworfen/` | Verworfene Aufnahme (siehe unten) |
| `build.sh`, `ablauf-lang.txt` | Schnitt als Skript; Vorlage für die Langfassung mit Konsolenaufnahmen |
| `fonts/`, `tools/track_font.py` | JetBrains Mono (SIL OFL 1.1) und die daraus abgeleiteten gesperrten Schnitte |

## Guthaben

| | Credits |
| --- | --- |
| Vorher | 454,08 |
| Nachher | 378,50 |
| Verbraucht | 75,58 (zehn Aufnahmen zu je 6,25 · ein Musikstück zu 13,08) |

Der Auftrag erlaubte 260. Die Kostenabfrage vor der Erzeugung (`get_cost`) lieferte für fünf
Einstellungen einen Preis und wurde danach vom Server abgelehnt; erzeugt wurde nur mit
Einstellungen, deren Preis vorher feststand.

| Abgefragte Einstellung, 5 s, 16:9, ohne Ton | Credits |
| --- | --- |
| Kling v3.0, `std` (gewählt) | 6,25 |
| Kling 3.0 Turbo, 1080p | 10 |
| Seedance 2.5 Flash, 720p | 25 |
| Seedance 2.5, 720p | 35 |
| ElevenLabs Music v2.5, 90 s instrumental | 13,08 |

## Aufnahmen

Alle mit `kling3_0`, `mode: std`, `sound: off`, `duration: 5`, `aspect_ratio: 16:9`.
Geliefert in 1280×720; auf 1920×1080 hochgerechnet, entsättigt und leicht gradiert.

| Datei | Auftrag (job_id) | Credits | Im ersten Schnitt | Urteil |
| --- | --- | --- | --- | --- |
| `01-tal-daemmerung` | `08e47a5d-1ee4-4635-88eb-797a2114f568` | 6,25 | ja | stark; am linken Ufer anfangs ein kleines helles Fahrzeug |
| `02-bruecke-treibgut` | `bc41c042-2097-41d8-9965-f22ea698472b` | 6,25 | ja | gut; schräg von oben statt senkrecht, Fahrbahnstriche ohne Schrift |
| `03-lagezentrum` | `4e46b090-b8fb-4316-8584-2ce72a59e9d9` | 6,25 | ja | gut; winzige unleserliche Scheinbeschriftung oben rechts auf den Bildschirmen |
| `04-tastatur` | `426c6a24-b3e8-48b3-b5a7-a9ec4fc384b1` | 6,25 | ja | brauchbar; unscharfe Scheinzeichen auf den Tasten, Bildschirmkante im Hintergrund |
| `05-drohne-morgen` | `924f3910-4b71-4ac4-bfc5-cf7a01513bed` | 6,25 | nein, Reserve | stark, ruhig; für die Langfassung vorgesehen |
| `06-tal-morgen` | `b02c2998-8e4a-48d6-9824-d23608b7c2fe` | 6,25 | ja | stark |
| `07-hubschrauber-nacht` | `10adb57d-1191-43d5-ab58-24812cc47512` | 6,25 | ja | zweiter Versuch; passt zur Region (Fachwerk, Weinberge), wirkt etwas modellhaft |
| `07a-hubschrauber-nacht` | `e97d147a-f9bc-4d83-8f95-8cfc70a6fd74` | 6,25 | nein, Reserve | erster Versuch; fotografischer, aber Bauweise und Freileitungen wirken nicht mitteleuropäisch |
| `08-leerer-leitstand` | `dcff417f-7887-46d8-82db-51a43fba7ae8` | 6,25 | ja | stark; winzige unleserliche Scheinbeschriftung auf den Bildschirmen |
| `09-mastkamera` (verworfen) | `b9383966-18b5-4648-9cbf-ffed4e508d90` | 6,25 | nein | Scheinschriftzug auf dem Kameragehäuse; eine Überwachungskamera im Bild widerspricht zudem der Aussage des Films |

### Prompts

**01 Tal, Dämmerung** — Black-and-white documentary aerial footage. High-altitude drone view
over a small European river valley town at dusk. The river has burst its banks: streets and
gardens lie under dark, slowly moving water; only pitched roofs, a church tower and tree crowns
stand out above the surface. Steep wooded hills on both sides, low overcast sky, the last light
reflecting on the water. The camera pushes forward slowly and steadily along the valley.
Monochrome, high contrast, fine 35mm film grain, restrained, photorealistic. No people, no
moving vehicles, no text, no signs, no logos.

**02 Brücke, Treibgut** — Black-and-white documentary drone footage, camera pointing straight
down in a top-down bird's-eye view onto an old stone road bridge crossing a swollen,
fast-flowing muddy river. Tree trunks, branches and debris are jammed against the bridge piers,
white water churns around them. The empty road surface on the bridge is wet. The camera
descends slowly and vertically toward the bridge. Monochrome, high contrast, fine 35mm film
grain, photorealistic. No people, no vehicles, no text, no road markings, no logos.

**03 Lagezentrum** — Black-and-white cinematic footage inside a dark operations room at night,
filmed from behind. Two operators sit at desks, seen only from the back as dark silhouettes,
facing a large wall of dim screens that show abstract monochrome topographic maps with thin
contour lines and small square markers. A faint glow from the screens outlines their shoulders
and headsets. The camera dollies slowly sideways behind them. Monochrome, deep blacks, high
contrast, slight haze, calm and quiet, photorealistic. No faces visible, no readable text, no
letters, no logos, no insignia, no flags.

**04 Tastatur** — Black-and-white macro close-up of two hands typing calmly on a plain dark
keyboard in a dark room. Only the faint cool glow of a screen outside the frame lights the
fingertips and the edges of the keys. Very shallow depth of field, slow subtle push-in,
deliberate unhurried keystrokes. Monochrome, high contrast, fine 35mm film grain,
photorealistic. Blank keycaps without letters, no logos, no text, no face in frame.

**05 Drohne, Morgen** — Black-and-white cinematic footage at dawn. A small quadcopter drone
hovers low over wide, calm floodwater, seen from behind and slightly below as a dark silhouette
against a pale misty sky. Mist drifts over the water; half-submerged trees and fence posts fade
into the distance. The drone holds its position with spinning rotors, then drifts slowly
forward while the camera follows gently. Monochrome, high contrast, soft fog, fine 35mm film
grain, photorealistic. No people, no text, no markings or logos on the drone.

**06 Tal, Morgen** — Black-and-white documentary aerial footage. Wide, almost static high view
over a small European river valley town at dawn after a flood. The water has receded into the
riverbed; wet streets and mud-covered meadows glisten, thin mist lies in the valley, the first
light breaks over wooded hills. Very slow, barely perceptible forward drift of the camera. Calm
and quiet. Monochrome, high contrast, fine 35mm film grain, photorealistic. No people, no
vehicles, no text, no signs.

**07 Hubschrauber, Nacht (verwendet)** — Black-and-white cinematic aerial footage at night in
heavy rain. Seen from behind and slightly above: a helicopter flies low and slowly along a
narrow, dark, flooded river valley in central Europe, visible only as a small dark unmarked
silhouette. Its single searchlight beam cuts through the rain and sweeps over black floodwater
and a half-submerged old German village: half-timbered houses with steep slate roofs, a stone
church tower, steep vineyard slopes rising on both sides of the valley. The camera follows
steadily behind the helicopter. Monochrome, deep blacks, high contrast, fine 35mm film grain,
photorealistic. No text, no numbers, no markings or logos on the helicopter, no people visible,
no overhead power lines.

**07a Hubschrauber, Nacht (erster Versuch)** — Black-and-white cinematic aerial footage at
night in the rain. Seen from behind and slightly above: a helicopter flies low and slowly along
a dark flooded river valley, visible only as a dark unmarked silhouette. Its single searchlight
beam cuts through the rain and sweeps over black water and the wet roofs of a half-submerged
village below. The camera follows steadily behind the helicopter. Monochrome, deep blacks, high
contrast, fine 35mm film grain, photorealistic. No text, no numbers, no markings or logos on
the helicopter, no people visible.

**08 Leerer Leitstand** — Black-and-white cinematic footage of an empty, dark control room at
night with nobody present. A row of empty office chairs stands in front of a wall of screens
that play grainy black-and-white aerial video of a flooded landscape, water and rooftops seen
from above. The screens flicker faintly and light the empty chairs and desks. Very slow push-in
toward the screens. Monochrome, deep blacks, high contrast, slight haze, quiet and still,
photorealistic. No people, no readable text, no letters, no logos, no insignia.

**09 Mastkamera (verworfen)** — Black-and-white cinematic footage in steady rain at dusk. A
small weatherproof camera in a plain housing is mounted on a steel mast at a riverbank, seen
from a low angle against a dark overcast sky; rain drips from the housing. The camera points
down at a swollen, fast-flowing river in the background, the water close to the top of the
bank, trees standing in the water on the far side. Slow, steady push-in toward the camera on
the mast. Monochrome, high contrast, shallow depth of field, fine 35mm film grain,
photorealistic. No text, no numbers, no labels, no logos, no people.

## Ton

`audio/bed-elevenlabs.mp3` — `elevenlabs_music_v2_5`, `duration: 90`, `force_instrumental: true`,
Auftrag `5bcbbf10-a8df-49f4-9cf0-67aa066c3e0b`, 13,08 Credits.

> Minimal dark ambient bed for a restrained documentary brand film. First twenty seconds: a low
> sustained drone in A minor, cold and tense, very slow swell, a few sparse soft single piano
> notes far apart. From about twenty seconds on: it opens into a warmer, calm, hopeful sustained
> chord in A major with soft strings, which continues quietly and evenly until the end and fades
> out. No drums, no percussion, no melody hook, no vocals, no choir. Slow, serious, spacious,
> understated.

Gemessen, nicht gehört: Der helle Klang setzt in der Datei bei 21,2 s ein und wird danach etwa
alle 5,3 s neu angeschlagen; Schlagzeug ist im Spektrum nicht zu erkennen. `build.sh` schiebt
das Stück so, dass der Einsatz auf `mark|turn` fällt — im ersten Schnitt auf die Tafel „Sicht
macht Einsatzbilder in Sekunden durchsuchbar“ bei 20,52 s. Zu jeder Tafel kommt ein leiser,
mit ffmpeg erzeugter Tick. Der fertige Ton liegt bei −17,0 LUFS, Spitze −3,0 dBFS.

**Vor der Vorführung einmal anhören.** Wer das Stück nicht will: `BED=synth ./build.sh` erzeugt
stattdessen einen Liegeton mit ffmpeg, in beliebiger Länge.

## Tafeln

Gesetzt in JetBrains Mono, Versalien, gesperrt, `#ededed` auf `#050505`, Eckmarken in
`#8a8a8a`. Der Text wird zeichenweise aufgedeckt (50 Zeichen je Sekunde), davor läuft eine
Schreibmarke. Standzeit: rund 18 Zeichen je Sekunde plus eine halbe Sekunde.

| Tafel | Text | Fußzeile |
| --- | --- | --- |
| 01 | AHRTAL · 14. JULI 2021 · 22:14 UHR | |
| 02 | EIN POLIZEIHUBSCHRAUBER FILMT / MENSCHEN AUF DÄCHERN. | QUELLEN: DPA, EPD · OKTOBER 2022 |
| 03 | DIE AUFNAHMEN WERDEN NICHT WEITERGEGEBEN. | QUELLEN: DPA, EPD · OKTOBER 2022 |
| 04 | BILDER, DIE KEINER SIEHT, / HELFEN NIEMANDEM. | |
| 05 | SICHT MACHT EINSATZBILDER / IN SEKUNDEN DURCHSUCHBAR. | |
| 06 | OHNE PERSONEN ZU IDENTIFIZIEREN. | |
| Schluss | SICHT / KEINE SICHT OHNE AUFSICHT. | SYMBOLBILDER, KI-GENERIERT · ERPROBUNGSSTAND |

Zu den Tatsachen (Belege in `docs/research/evidence.md`, Abschnitt „The police helicopter
video“):

- Die Aufnahmen entstanden zwischen 22.14 und 22.43 Uhr über den Ahr-Orten Mayschoß bis Schuld
  (dpa, 5. Oktober 2022) und zeigen unter anderem Menschen, die mit Lampen von Dächern oder
  Fenstern auf sich aufmerksam machen (epd, 4. Oktober 2022).
- Die Videos wurden nach Darstellung der Polizei „nicht ordnungsgemäß verbucht“ und nicht
  weitergegeben; Untersuchungsausschuss und Staatsanwaltschaft gingen bis September 2022 davon
  aus, dass es sie nicht gibt (epd, 4. Oktober 2022).
- **Nicht** behauptet wird, die Bilder hätten die Einsatzleitung nicht erreicht: Dafür gibt es
  in der Recherche keinen Beleg in die eine oder andere Richtung. Die im Auftrag als Beispiel
  genannte Tafel dazu ist deshalb durch Tafel 03 ersetzt.

Jede erzeugte Aufnahme trägt im Schnitt unten links den Hinweis `SYMBOLBILD · KI-GENERIERT`,
weil die erste direkt auf die Datumstafel folgt. Nichts im Film gibt vor, die echte Aufnahme
zu sein.

## Ablauf des ersten Schnitts

| Beginn | Dauer | Inhalt |
| --- | --- | --- |
| 0,00 | 2,40 | Tafel 01 |
| 2,40 | 3,00 | 01 Tal, Dämmerung |
| 5,40 | 3,20 | Tafel 02 |
| 8,60 | 3,20 | 07 Hubschrauber, Nacht |
| 11,80 | 2,80 | Tafel 03 |
| 14,60 | 3,00 | 08 Leerer Leitstand |
| 17,60 | 2,92 | Tafel 04 |
| 20,52 | 3,20 | Tafel 05 — hier setzt der helle Klang ein |
| 23,72 | 1,80 | 04 Tastatur |
| 25,52 | 2,20 | 02 Brücke, Treibgut |
| 27,72 | 2,60 | 03 Lagezentrum |
| 30,32 | 2,32 | Tafel 06 |
| 32,64 | 2,80 | 06 Tal, Morgen |
| 35,44 | 4,20 | Schlusstafel |

## Neu bauen und erweitern

```bash
./build.sh
```

```bash
./build.sh web
```

```bash
SEQ=ablauf-lang.txt OUT=sicht-markenfilm-lang.mp4 ./build.sh
```

Der Ablauf besteht aus Zeilen:

```
card|<kennung>|<sekunden>|<fußzeile oder leer>|<zeile 1>|<zeile 2>
shot|<datei in shots/>|<start s>|<dauer s>
clip|<pfad>|<start s>|<dauer s>|<beschriftung oder leer>
mark|turn
end|<sekunden>
```

**Konsolenaufnahmen einfügen:** in `ablauf-lang.txt` (oder im Feld `SEQUENCE` von `build.sh`)
eine `clip`-Zeile an die gewünschte Stelle setzen. Die Aufnahme darf jede Größe und Bildrate
haben; sie wird auf 1600×900 eingepasst, auf den Grund gestellt und von Eckmarken gefasst, die
Beschriftung steht darunter. Gesamtdauer, Tonbett und Ticks rechnen sich neu. `mark|turn`
sollte vor der Tafel „durchsuchbar“ stehen bleiben; liegt die Stelle später als Sekunde 21,2,
beginnt die Musik entsprechend verzögert. Das Musikstück trägt Filme bis etwa 89 s, darüber
schaltet das Skript von selbst auf den erzeugten Liegeton um.

Andere Maße (Schriftgröße, Zeilenabstand, Einzug der Eckmarken, Korn) stehen als Variablen am
Kopf von `build.sh`. Die Schriftgröße der Tafeln (`FS`) muss durch 4 teilbar bleiben und
`STEP` das 0,75-Fache davon sein, sonst läuft die Aufdeckung nicht mehr im Raster der Zeichen.
Eine andere Sperrung braucht neue Schriftdateien:

```bash
pip install fonttools
```

```bash
python3 tools/track_font.py fonts/JetBrainsMono-Regular.ttf fonts/SichtCard-Regular-t150.ttf 150
```

## Offene Punkte

- Die Aufnahmen sind hochgerechnetes 720p. Auf großer Leinwand wirkt das weicher als echtes
  1080p; das Korn im Schnitt überdeckt es weitgehend. Ein Hochrechnen über Higgsfield (Topaz)
  ist möglich, sein Preis ließ sich nicht vorab abfragen.
- Der Ton wurde nur gemessen, nicht abgehört.
- Nutzungsrechte an den erzeugten Aufnahmen und am Musikstück richten sich nach den
  Bedingungen des Higgsfield-Kontos; vor einer öffentlichen Verwendung prüfen.
- Der Ordner ist rund 125 MB groß (`raw/` 42 MB, `shots/` 52 MB, Schnitt 29 MB). Ob Videos
  ins Repository gehören, ist offen; `work/` ist bereits ausgenommen.
