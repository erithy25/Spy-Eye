# Sicht — Filme: Aufnahmen, Tafeln, Ton

Stand: 18. November 2026. Alles in diesem Ordner lässt sich mit `./build.sh` neu bauen.

## Ergebnis

| Datei | Inhalt |
| --- | --- |
| `sicht-markenfilm-v1.mp4` | Markenfilm, erster Schnitt, 40,2 s, 1920×1080, 25 B/s, H.264/AAC, 29 MB |
| `sicht-brandfilm-en.mp4` | Derselbe Schnitt mit englischen Tafeln, 40,2 s, 29 MB |
| `sicht-markenfilm-lang.mp4` | Langfassung mit drei Ausschnitten aus der Konsole, 66,8 s, 37 MB |
| `sicht-produktfilm.mp4` | Produktfilm aus dem Mitschnitt der Konsole, 136,6 s, 28 MB |
| `sicht-productfilm-en.mp4` | Derselbe Produktfilm mit englischen Tafeln und Einblendungen; die Konsole im Bild bleibt deutsch, 136,6 s, 28 MB |
| `sicht-produktfilm-web.mp4`, `sicht-productfilm-en-web.mp4` | leichte Fassungen des Produktfilms für die Website (1280×720, je 6,9 MB); sie liegen als `site/assets/film/sicht-produktfilm.mp4` und `sicht-productfilm-en.mp4` bei der Seite, die je nach Sprache die passende zeigt |
| `sicht-teaser-hochkant.mp4` | Teaser im Hochformat, 19,5 s, 1080×1920, 7,2 MB |
| `sicht-teaser-vertical-en.mp4` | Derselbe Teaser mit englischen Tafeln, 19,5 s, 7,2 MB |
| `*-web.mp4` | Zu jeder Fassung eine leichte Datei zum Einbetten (1280×720, im Hochformat 720×1280): 2,8 · 2,8 · 4,2 · 6,8 · 0,8 · 0,8 MB |
| `shots/*.mp4` | Neun angeglichene Aufnahmen, je 4,84 s, 1920×1080, Schwarzweiß, ohne Korn, ohne Einblendung, ohne Ton |
| `shots-hochkant/*.mp4` | Fünf angeglichene Aufnahmen im Hochformat, je 4,84 s, 1080×1920 |
| `cards/*.mp4`, `cards/<ablauf>/*.mp4` | Die Tafeln jedes Schnitts als einzelne Clips |
| `audio/bed-elevenlabs.mp3` | Tonbett, 90 s; `audio/bed-lang.mp3` ist dasselbe Stück zweimal hintereinander, 172 s |
| `raw/*.kling.mp4`, `raw-hochkant/*.kling.mp4` | Die Aufnahmen, wie Higgsfield sie geliefert hat (1280×720 und 720×1280, 24 B/s) |
| `raw/verworfen/` | Verworfene Aufnahme (siehe unten) |
| `build.sh` | Schnitt als Skript; der erste Schnitt steht darin, jeder andere in einer Ablaufdatei |
| `ablauf-v1-en.txt`, `ablauf-lang.txt`, `ablauf-produktfilm.txt`, `ablauf-productfilm-en.txt`, `ablauf-teaser-hochkant.txt`, `ablauf-teaser-vertical-en.txt` | Die Abläufe der übrigen Fassungen |
| `fonts/`, `tools/track_font.py` | JetBrains Mono (SIL OFL 1.1) und die daraus abgeleiteten gesperrten Schnitte |

Videos, Aufnahmen, Tafeln und Ton liegen nicht im Repository (`.gitignore`); im Repository
stehen Skript, Abläufe, Schriften und dieses Dokument. Die fertigen Filme werden als Dateien
übergeben (`deliverables/film/`), die leichte Fassung des ersten Schnitts liegt zusätzlich unter
`site/assets/film/sicht-markenfilm.mp4`.

## Guthaben

| | Credits |
| --- | --- |
| Vorher | 454,08 |
| Nachher | 378,50 |
| Verbraucht | 75,58 (zehn Aufnahmen zu je 6,25 · ein Musikstück zu 13,08) |

Für den Hochkant-Teaser kamen fünf Aufnahmen dazu:

| | Credits |
| --- | --- |
| Vor den Hochkant-Aufnahmen | 378,50 |
| Nachher | 347,25 |
| Verbraucht | 31,25 (fünf Aufnahmen zu je 6,25) |

Vier davon (`h1` bis `h4`) stammen aus einem Lauf um 05:09 UTC, der danach abbrach; sie fanden
sich über die Auftragsliste des Kontos wieder und wurden von dort geladen. Die fünfte (`h5`) kam
um 06:13 UTC dazu. Erlaubt waren für den Teaser fünf Erzeugungen und 40 Credits.

Der erste Auftrag erlaubte 260. Die Kostenabfrage vor der Erzeugung (`get_cost`) lieferte für fünf
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

## Aufnahmen im Hochformat

Alle mit `kling3_0`, `mode: std`, `sound: off`, `duration: 5`, `aspect_ratio: 9:16`.
Geliefert in 720×1280; auf 1080×1920 hochgerechnet, entsättigt und leicht gradiert wie die
Aufnahmen im Querformat (`SEQ=ablauf-teaser-hochkant.txt ./build.sh shots`). Jede Aufnahme
wurde vor der Verwendung an Standbildern vom Anfang, aus der Mitte und vom Ende geprüft:
keine Gesichter, keine lesbare Schrift, keine Hoheitszeichen, keine verformten Hände.

| Datei | Auftrag (job_id) | Credits | Im Teaser | Urteil |
| --- | --- | --- | --- | --- |
| `h1-tal-flut` | `05474a65-a71e-4975-9b10-61fcd7facba2` | 6,25 | ja, erstes Bild | stark; überflutete Uferstraße, Kirche, Hang; winzige helle Fahrzeuge auf der Straße, ein Mast auf dem Höhenzug |
| `h2-leitstand` | `15082ec0-d290-4ead-97b9-4c7be29510f6` | 6,25 | ja | gut; hohe Bildschirmwand mit Flutbildern, leere Stühle; winzige unleserliche Scheinbeschriftung auf den Bildschirmen und zwei Aushänge an der Wand, links ein heller Mauervorsprung |
| `h3-drohne` | `030b2141-7faa-421c-bd46-67261d114d2e` | 6,25 | nein, Reserve | stark, ruhig; die rote Positionsleuchte der Drohne verschwindet mit der Entsättigung |
| `h4-tal-morgen` | `36637977-58c0-4bf1-839c-dbd2a861113d` | 6,25 | nein, Reserve | stark; abgestellte Fahrzeuge, keine Schrift |
| `h5-tastatur` | `ac878216-3b13-4d4e-a293-c23c9ba1f7fd` | 6,25 | ja, nur der Anfang | brauchbar; die Hand ist stimmig, auf einigen Tasten stehen unscharfe Scheinzeichen, die mit der Kamerafahrt deutlicher werden; verwendet sind deshalb nur die ersten 1,8 s |

### Prompts im Hochformat

**h1 Tal, Flut** — Black-and-white documentary aerial footage in vertical portrait format.
High-altitude drone view looking along a narrow European river valley at dusk. The river has
burst its banks: streets and gardens of a small town lie under dark, slowly moving water; only
pitched roofs, a church tower and tree crowns stand out above the surface. The flooded valley
runs from the bottom of the frame up into the distance between steep wooded hills; a low
overcast sky fills the top of the frame, the last light reflects on the water. The camera
pushes forward slowly and steadily along the valley. Monochrome, high contrast, fine 35mm film
grain, restrained, photorealistic. No people, no moving vehicles, no text, no signs, no logos.

**h2 Leitstand** — Black-and-white cinematic footage in vertical portrait format of an empty,
dark control room at night with nobody present. A tall wall of screens, stacked in rows from
the middle to the top of the frame, plays grainy black-and-white aerial video of a flooded
landscape, water and rooftops seen from above. In the lower part of the frame a row of empty
office chairs and bare desks is lit faintly by the flickering screens. Very slow push-in toward
the screens. Monochrome, deep blacks, high contrast, slight haze, quiet and still,
photorealistic. No people, no readable text, no letters, no logos, no insignia.

**h3 Drohne** — Black-and-white cinematic footage in vertical portrait format at dawn. A small
quadcopter drone hovers low over wide, calm floodwater, seen from behind and slightly below as
a dark silhouette in the upper third of the frame against a pale misty sky. Its reflection and
long ripples fill the lower part of the frame; mist drifts over the water, half-submerged trees
and fence posts fade into the distance. The drone holds its position with spinning rotors, then
drifts slowly forward while the camera follows gently. Monochrome, high contrast, soft fog,
fine 35mm film grain, photorealistic. No people, no text, no markings or logos on the drone.

**h4 Tal, Morgen** — Black-and-white documentary aerial footage in vertical portrait format.
Wide, almost static high view down a small European river valley at dawn after a flood. The
water has receded into the riverbed, which winds from the bottom of the frame into the
distance; wet streets, rooftops and mud-covered meadows glisten, thin mist lies in the valley,
the first light breaks over wooded hills under a tall pale sky. Very slow, barely perceptible
forward drift of the camera. Calm and quiet. Monochrome, high contrast, fine 35mm film grain,
photorealistic. No people, no vehicles, no text, no signs.

**h5 Tastatur** — Black-and-white macro close-up in vertical portrait format, in a dark room.
One hand rests on a plain matte black keyboard in the centre of the frame, seen from the side
at a low angle; the index finger slowly presses a single key and rests again, calm and
deliberate. The keyboard recedes from the bottom of the frame into soft-focus darkness at the
top; only the faint cool glow of a screen outside the frame lights the fingertips and the edges
of the keys. Very shallow depth of field, slow subtle push-in. Monochrome, deep blacks, high
contrast, fine 35mm film grain, photorealistic. Blank keycaps without letters or symbols, no
logos, no text, no face in frame, no screen in frame, no jewellery.

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
macht Einsatzbilder in Sekunden durchsuchbar“ bei 21,04 s. Zu jeder Tafel kommt ein leiser,
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
| 03 | DIE VIDEOS WERDEN / „NICHT ORDNUNGSGEMÄSS VERBUCHT“. | QUELLEN: DPA, EPD · OKTOBER 2022 |
| 04 | BILDER, DIE KEINER SIEHT, / HELFEN NIEMANDEM. | |
| 05 | SICHT MACHT EINSATZBILDER / IN SEKUNDEN DURCHSUCHBAR. | |
| 06 | OHNE PERSONEN ZU IDENTIFIZIEREN. | |
| Schluss | SICHT / KEINE SICHT OHNE AUFSICHT. | SYMBOLBILDER, KI-GENERIERT · ERPROBUNGSSTAND |

Zu den Tatsachen (Belege in `docs/research/evidence.md`, Abschnitt „The police helicopter
video“):

- Die Aufnahmen entstanden zwischen 22.14 und 22.43 Uhr über den Ahr-Orten Mayschoß bis Schuld
  (dpa, 5. Oktober 2022) und zeigen unter anderem Menschen, die mit Lampen von Dächern oder
  Fenstern auf sich aufmerksam machen (epd, 4. Oktober 2022).
- Tafel 03 gibt die Darstellung der Polizei im Wortlaut wieder: Die Videos seien „nicht
  ordnungsgemäß verbucht“ worden (epd, 4. Oktober 2022). Untersuchungsausschuss und
  Staatsanwaltschaft gingen bis September 2022 davon aus, dass es solche Aufnahmen nicht gibt
  (ebenda). Website, Präsentation, Einseiter und `docs/BRAND.md` führen dieselbe Wendung; die
  frühere Tafel („Die Aufnahmen werden nicht weitergegeben.“) sagte mehr als sie und ist
  ersetzt. Die Tafel hat 50 Zeichen und steht deshalb 3,3 statt 2,8 Sekunden; die
  Anführungszeichen „ “ sind in den gesperrten Schriften enthalten.
- **Nicht** behauptet wird, die Bilder hätten die Einsatzleitung nicht erreicht: Dafür gibt es
  in der Recherche keinen Beleg in die eine oder andere Richtung.

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
| 11,80 | 3,32 | Tafel 03 |
| 15,12 | 3,00 | 08 Leerer Leitstand |
| 18,12 | 2,92 | Tafel 04 |
| 21,04 | 3,20 | Tafel 05 — hier setzt der helle Klang ein |
| 24,24 | 1,80 | 04 Tastatur |
| 26,04 | 2,20 | 02 Brücke, Treibgut |
| 28,24 | 2,60 | 03 Lagezentrum |
| 30,84 | 2,32 | Tafel 06 |
| 33,16 | 2,80 | 06 Tal, Morgen |
| 35,96 | 4,20 | Schlusstafel |

Standzeiten rundet das Skript auf ganze Bilder auf (3,3 s werden 3,32 s). Das Vorschaubild der
Website (`site/assets/film/poster.webp`) zeigt den leeren Leitstand; dasselbe Bild steht im
Film jetzt bei 16,0 statt bei 15,5 Sekunden.

## Englische Fassung

`ablauf-v1-en.txt` ist der erste Schnitt mit englischen Tafeln: dieselben Bilder, dieselbe
Musik, dieselben Standzeiten, also dieselbe Länge (40,16 s). Die Datei setzt Ausgabename,
Einblendung und Schlusstafel selbst (`set|...`-Zeilen), der Aufruf braucht keine weiteren
Angaben:

```bash
SEQ=ablauf-v1-en.txt ./build.sh
```

```bash
SEQ=ablauf-v1-en.txt ./build.sh web
```

| Tafel | Text | Fußzeile |
| --- | --- | --- |
| 01 | AHR VALLEY · 14 JULY 2021 · 22:14 | |
| 02 | A POLICE HELICOPTER FILMS / PEOPLE ON ROOFTOPS. | SOURCES: DPA, EPD · OCTOBER 2022 |
| 03 | THE VIDEOS ARE “NOT PROPERLY FILED”. | SOURCES: DPA, EPD · OCTOBER 2022 |
| 04 | IMAGES NO ONE SEES / HELP NO ONE. | |
| 05 | SICHT MAKES OPERATIONAL FOOTAGE / SEARCHABLE WITHIN SECONDS. | |
| 06 | WITHOUT IDENTIFYING PEOPLE. | |
| Schluss | SICHT / NO SIGHT WITHOUT OVERSIGHT. | SYMBOLIC IMAGES, AI-GENERATED · TRIAL BUILD |

Zum Wortlaut:

- Tafel 03 gibt die Darstellung der Polizei in Übersetzung und in Anführungszeichen wieder,
  so wie die englische Website (dort: the videos were “not properly filed”, mit dem Zusatz
  „Quotation translated from German“) und die englische Präsentation. Ohne Anführungszeichen
  stünde die Aussage als eigene Feststellung da.
- Zeitform wie im Deutschen: Gegenwart. Die Uhrzeit steht ohne „Uhr“, das Datum in britischer
  Schreibweise, beides wie auf der englischen Website.
- „Einsatzbilder“ heißt „operational footage“, die Einblendung auf den Aufnahmen
  `SYMBOLIC IMAGE · AI-GENERATED`, der Leitsatz wie in `docs/BRAND.md`
  („No sight without oversight.“).
- Tafel 03 steht wie im Deutschen 3,3 Sekunden, obwohl der englische Text kürzer ist; so
  bleiben beide Fassungen bildgleich geschnitten.

## Mitschnitt der Konsole: Produktfilm und Langfassung

Beide Filme zeigen Ausschnitte aus einem durchgehenden Mitschnitt der Konsole,
`media/product/take.mp4` (124,56 s, 1920×1080, 25 B/s, H.264, 41 MB; nicht im Repository). Er
entsteht mit einem Playwright-Skript gegen die laufende Vorführung (Übung RHEIN-MOSEL, Uhr
achtfach) als WebM und wird so umgewandelt:

```bash
ffmpeg -i take.webm -an -vf "fps=25,scale=1920:1080:flags=lanczos,format=yuv420p" -c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p -r 25 -movflags +faststart media/product/take.mp4
```

Das Skript schreibt Schnittmarken mit (Sekunden ab Beginn des Mitschnitts). Im jetzigen
Mitschnitt (vom 18. November 2026, nach der Korrektur der rechten Spalte der Lage): Anmeldung
2,9 · Mandat 6,4 · Lage 10,2 · Start der Übung 15,1 · erste Meldung 26,1 · Karte 33,5 ·
Fehlmeldung 49,1 · Wachen 58,6 · Suche 66,5 · Treffer 73,3 · Vorgang 80,4 · Ablehnung 90,7 ·
Verbund 99,9 · Protokoll 106,1 · Wirkung 114,9 · Schluss 120,4 · Ende 124,6. Die Seiten wechseln
bei 67,2 (Suche), 100,6 (Verbund), 107,0 (Protokoll) und 115,8 (Wirkung).

Ausschnitte des Produktfilms (`ablauf-produktfilm.txt`), Start und Dauer in Sekunden des
Mitschnitts:

| Beschriftung | Start | Dauer |
| --- | --- | --- |
| ANMELDUNG · MANDAT: OHNE ZWECK KEINE AUSWERTUNG | 2,4 | 9,0 |
| LAGE · ERSTE MELDUNG: ÜBERFLUTUNG AM MOSELBOGEN | 13,8 | 20,0 |
| LAGE · MELDUNGEN GLEICHER ART WERDEN ZU LAGEN | 36,4 | 12,4 |
| WACHE · VERSION 2, AUSDRÜCKLICH UND IM PROTOKOLL | 49,0 | 17,2 |
| SUCHE · ANTWORTEN DER NACHBARKNOTEN MIT BELEG | 67,4 | 12,8 |
| VORGANG · BILD MIT PRÜFSUMME GESICHERT | 80,2 | 9,6 |
| ANFRAGEPRÜFUNG · GESICHTER UND KENNZEICHEN | 90,8 | 9,2 |
| VERBUND · DREI KNOTEN, KEIN GEMEINSAMER DATENBESTAND | 100,0 | 6,0 |
| PROTOKOLL · KETTE GEPRÜFT | 107,2 | 7,4 |
| WIRKUNG · 13 VON 13 EREIGNISSEN, EINE FEHLMELDUNG | 116,0 | 8,2 |

Ausschnitte der Langfassung (`ablauf-lang.txt`):

| Beschriftung | Start | Dauer |
| --- | --- | --- |
| KONSOLE · SUCHE IN WORTEN · ÜBUNGSDATEN | 68,4 | 8,0 |
| KONSOLE · LAGE · ÜBUNGSDATEN | 37,2 | 7,0 |
| KONSOLE · ANFRAGE ABGELEHNT · ÜBUNGSDATEN | 93,2 | 6,0 |

Nach einem neuen Mitschnitt verschiebt sich der Anfang jedes Ausschnitts um den Versatz der
Marke davor und sein Ende um den Versatz der Marke danach: Die Abschnitte dauern nicht in jedem
Mitschnitt gleich lang. Danach wird jeder Ausschnitt an seinem ersten, mittleren und letzten
Bild geprüft. Die Regeln dafür:

- Kein Ausschnitt beginnt oder endet in einem Seitenwechsel, in einem halb getippten Wort oder
  während sich ein Dialog öffnet. Der Ausschnitt zur Ablehnung in der Langfassung beginnt
  deshalb erst, wenn die Anfrage ausgeschrieben ist und die Ablehnung steht (93,2).
- Ein Ausschnitt, der auf eine Tafel folgt, beginnt erst, nachdem die Seite gewechselt hat, die
  seine Beschriftung nennt (Suche 67,4; Protokoll 107,2; Wirkung 116,0). Sonst steht die
  Beschriftung eine Dreiviertelsekunde über der falschen Seite.
- Was die Beschriftung sagt, ist im Ausschnitt zu sehen. Weicht der Bildschirm ab, wird die
  Beschriftung geändert, nie umgekehrt. Geprüft am jetzigen Mitschnitt: Die erste Meldung ist
  „Überflutung“ an UAS 1 · Moselbogen; sie erscheint im ersten sichtbaren Bild schon mit
  „3 Bilder“, deshalb nennt die Beschriftung die Meldung und nicht mehr die Bildzahl. Der Reiter
  Wirkung zeigt „13 von 13 Ereignissen der Übung erkannt. Fehlmeldungen: 1.“ und bei achtfacher
  Uhr und laufender Aufnahme einen Verzug von 3,7 s im Median.
- Folgen zwei Ausschnitte ohne Tafel aufeinander und schließen sie im Mitschnitt aneinander an,
  dann endet der erste genau dort, wo der zweite beginnt (80,2 und 100,0); nur die
  Beschriftung wechselt.
- Starts liegen auf geraden Zehnteln, damit sie bei 25 Bildern je Sekunde auf ein ganzes Bild
  fallen.
- Der Ausschnitt zum Vorgang endet auf dem Blatt mit dem Vermerk „Im Vorgang … gesichert“,
  bevor es sich schließt.

Im Produktfilm liegt `mark|turn` vor der Tafel „Eine Fehlmeldung. Verworfen. Nachgeschärft.“
bei 47,2 s. Weil der helle Klang des Stücks bei Sekunde 21,2 einsetzt, beginnt die Musik dort
erst bei 26,0 s; bis dahin sind nur die Ticks der Tafeln zu hören.

## Hochkant-Teaser

Für soziale Netze, 19,5 Sekunden, 1080×1920, deutsch und englisch. Drei Bilder, drei Tafeln,
Schlusstafel; er trägt ohne Ton, weil alles Wesentliche auf den Tafeln steht.

```bash
SEQ=ablauf-teaser-hochkant.txt ./build.sh
```

```bash
SEQ=ablauf-teaser-vertical-en.txt ./build.sh
```

| Beginn | Dauer | Inhalt (deutsch · englisch) |
| --- | --- | --- |
| 0,00 | 1,80 | `h1` Tal, Flut |
| 1,80 | 4,40 | AHRTAL · 14. JULI 2021 / EIN POLIZEIHUBSCHRAUBER / FILMT MENSCHEN / AUF DÄCHERN. · AHR VALLEY · 14 JULY 2021 / A POLICE HELICOPTER / FILMS PEOPLE / ON ROOFTOPS. (mit Quellenzeile) |
| 6,20 | 1,60 | `h2` Leitstand |
| 7,80 | 3,32 | DIE VIDEOS WERDEN / „NICHT ORDNUNGSGEMÄSS / VERBUCHT“. · THE VIDEOS ARE / “NOT PROPERLY FILED”. (mit Quellenzeile) |
| 11,12 | 3,20 | SICHT MACHT / EINSATZBILDER / IN SEKUNDEN / DURCHSUCHBAR. · SICHT MAKES / OPERATIONAL FOOTAGE / SEARCHABLE / WITHIN SECONDS. — hier setzt der helle Klang ein |
| 14,32 | 1,60 | `h5` Tastatur |
| 15,92 | 3,60 | Schlusstafel: SICHT / KEINE SICHT OHNE AUFSICHT. · NO SIGHT WITHOUT OVERSIGHT.; darunter SYMBOLBILDER, KI-GENERIERT / ERPROBUNGSSTAND · SYMBOLIC IMAGES, AI-GENERATED / TRIAL BUILD |

- **Wortlaut** wie im Markenfilm, nur anders umbrochen; nichts geht über die Quellen hinaus.
  Datum und Hubschrauber stehen auf einer Tafel, die Uhrzeit entfällt.
- **Format** (`set|FORMAT|hochkant`): Tafeltext 48 statt 36 Pixel, höchstens 25 Zeichen je
  Zeile; Fußzeilen und Einblendungen 28 statt 20 Pixel. Soziale Netze legen oben und unten
  Bedienelemente über das Bild und zeigen Hochformat in der Übersicht teils nur als
  4:5-Ausschnitt. Eckmarken, Text, Quellenzeile und Hinweise stehen deshalb in einem Feld, das
  oben 288 und unten 480 Pixel frei lässt; die Aufnahme füllt das ganze Bild, die Einblendung
  `SYMBOLBILD · KI-GENERIERT` steht unten links in diesem Feld. Passt der Hinweis der
  Schlusstafel nicht in eine Zeile, teilt ihn das Skript am „ · “.
- **Ton**: dasselbe Musikstück, ab Sekunde 10,1 des Stücks, so dass der helle Klang auf die
  dritte Tafel fällt; am Ende über 2,6 Sekunden ausgeblendet. −17,0 LUFS.
- **Bilder**: neu erzeugt (siehe „Aufnahmen im Hochformat“). `h3` und `h4` sind angeglichen
  vorhanden und nicht verwendet.

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

```bash
END_NOTE='BILDSCHIRMAUFNAHME DER KONSOLE · ÜBUNGSDATEN · ERPROBUNGSSTAND' SEQ=ablauf-produktfilm.txt OUT=sicht-produktfilm.mp4 MUSIC=audio/bed-lang.mp3 CLIP_W=1728 CLIP_H=972 ./build.sh
```

Die englische Fassung des Produktfilms hat dieselben Schnitte und dieselbe Länge; ihre
Ablaufdatei setzt Ausgabename, Schlusstafel und Musik selbst. Wer die Schnitte ändert, ändert
sie in beiden Dateien:

```bash
CLIP_W=1728 CLIP_H=972 SEQ=ablauf-productfilm-en.txt ./build.sh
```

Die leichte Fassung entsteht jeweils mit denselben Angaben und dem Wort `web` am Ende. Läuft
nebenher anderes auf dem Rechner, begrenzt `THREADS=2 nice -n 10 ./build.sh` ffmpeg auf zwei
Rechenfäden; immer nur einen Schnitt zur selben Zeit bauen, die Zwischendateien in `work/`
teilen sich alle.

Der Ablauf besteht aus Zeilen:

```
card|<kennung>|<sekunden>|<fußzeile oder leer>|<zeile 1>|<zeile 2>
shot|<datei in shots/>|<start s>|<dauer s>
clip|<pfad>|<start s>|<dauer s>|<beschriftung oder leer>
mark|turn
end|<sekunden>
set|<NAME>|<wert>
```

`set` gibt es nur in Ablaufdateien: `OUT`, `FORMAT` (`quer` oder `hochkant`), `SHOT_LABEL`,
`END_LINE`, `END_NOTE`, `MUSIC`, `MUSIC_TURN`. Eine gleichnamige Umgebungsvariable hat Vorrang.

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
- Der Ton wurde nur gemessen, nicht abgehört. Das gilt für alle sechs Filme.
- Im Produktfilm beginnt die Musik erst bei 26,0 s (siehe oben). Wer sie von Anfang an will,
  setzt `MUSIC_TURN` auf einen späteren Anschlag des hellen Klangs; das ist nicht ausprobiert.
- Der Mitschnitt läuft mit achtfacher Uhr, während der Rechner zugleich das Bild aufzeichnet.
  Die Tabelle im Reiter Wirkung zeigt deshalb für zwei Ereignisse einen Verzug von rund 20 s
  Übungszeit (2,5 s am Rechner); die Messung in Echtzeit ohne Aufzeichnung steht in
  `docs/EVALUATION.md`.
- Der Teaser wurde an Standbildern geprüft, nicht auf einem Telefon und nicht in den Netzen
  selbst. Die Freiräume oben und unten sind Erfahrungswerte, keine nachgeschlagenen Vorgaben
  der Plattformen.
- Nutzungsrechte an den erzeugten Aufnahmen und am Musikstück richten sich nach den
  Bedingungen des Higgsfield-Kontos; vor einer öffentlichen Verwendung prüfen.
- Der Ordner ist mit allen Fassungen mehrere hundert MB groß. Videos, Aufnahmen, Tafeln und
  Ton sind vom Repository ausgenommen; wer neu baut, braucht `raw/`, `raw-hochkant/`, `audio/`
  und für Produktfilm und Langfassung `media/product/take.mp4`.
