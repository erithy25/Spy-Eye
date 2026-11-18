# Stückliste

Stand: 18. November 2026 · Fassung 0.5.0. Diese Unterlage nennt, woraus Sicht besteht: jedes Paket, jedes
Modell, die Schrift und die Daten, jeweils mit Fassung, Herkunft und Lizenz. Sie wird aus der
Sperrdatei der Paketverwaltung erzeugt (`pnpm sbom`) und liegt maschinenlesbar als
[`docs/stueckliste/sicht.cdx.json`](stueckliste/sicht.cdx.json) im Format CycloneDX 1.5 bei, mit
der Prüfsumme jedes Pakets. Ein Test hält die Liste an der Sperrdatei fest: Ändert sich ein Paket,
ohne dass die Liste neu erzeugt wird, scheitert `pnpm test`.

## 1. Was ausgeliefert wird

| Teil | Anzahl | Bemerkung |
| --- | --- | --- |
| Pakete, die auf jeder Plattform laufen | 117 | Knoten und Konsole |
| Binärpakete je Plattform | 26 | eingerichtet werden nur die der eigenen Plattform |
| Modelle | 3 | zwei werden beim ersten Start geladen, eines liegt bei |
| Schrift | 1 | drei Schnitte |
| Daten | 3 | Karte, Höhenlinien, Übungsaufnahmen |

Nicht in der Liste stehen die Werkzeuge, mit denen gebaut und geprüft wird (TypeScript, Vite, tsx);
sie laufen nicht im Knoten und sind nicht Teil der Auslieferung.

## 2. Lizenzen der Pakete

| Lizenz | Pakete | Bemerkung |
| --- | --- | --- |
| MIT | 82 |  |
| Apache-2.0 | 18 |  |
| BSD-3-Clause | 15 |  |
| LGPL-3.0-or-later | 10 | libvips, die Bildbibliothek hinter sharp; eigene Datei, unverändert geladen |
| BlueOak-1.0.0 | 6 | freizügige Lizenz |
| ISC | 6 |  |
| Apache-2.0 AND LGPL-3.0-or-later | 3 | sharp für Windows; das Paket enthält libvips |
| (MIT OR CC0-1.0) | 1 | wahlweise |
| 0BSD | 1 |  |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 | sharp als WebAssembly, enthält libvips; nur für Plattformen ohne Binärpaket |

Keines der Pakete steht unter GPL oder AGPL. Die Bildbibliothek libvips steht unter der LGPL; unter
Linux liegt sie als eigene Datei (`libvips-cpp.so`) neben der Anbindung und wird unverändert geladen.
Welche Hinweise und Lizenztexte einer Weitergabe von Sicht beizulegen sind, gehört in die rechtliche
Prüfung (Abschnitt 8).

## 3. Direkt eingebundene Pakete

| Paket | Fassung | Lizenz | Teil | Wozu |
| --- | --- | --- | --- | --- |
| `@fastify/multipart` | 10.1.9 | MIT | Knoten | Annahme hochgeladener Aufnahmen |
| `@fastify/static` | 10.1.11 | MIT | Knoten | Auslieferung der Konsole |
| `@huggingface/transformers` | 4.3.2 | Apache-2.0 | Knoten | Vorverarbeitung und Textzerlegung für die Modelle |
| `fastify` | 5.12.8 | MIT | Knoten | Webserver des Knotens |
| `onnxruntime-node` | 1.30.0 | MIT | Knoten | Ausführung der Modelle auf dem Prozessor |
| `react` | 19.3.1 | MIT | Konsole | Oberfläche der Konsole |
| `react-dom` | 19.3.1 | MIT | Konsole | Oberfläche der Konsole |
| `sharp` | 0.35.5 | Apache-2.0 | Knoten | Bilder lesen, verkleinern, verpixeln |

Alle übrigen Pakete kommen über diese acht herein; sie stehen in Abschnitt 7.

## 4. Modelle, Schrift, Daten

| Bestandteil | Herkunft | Lizenz | Lieferung | Prüfsumme (SHA-256, Anfang) |
| --- | --- | --- | --- | --- |
| SigLIP 2 base patch32-256 (ONNX) | Google; ONNX-Fassung der onnx-community | Apache-2.0 | wird beim ersten Start geladen | `0ddb7507cfcb54c2` vision_model.onnx; `3f81492720954103` text_model_fp16.onnx |
| YuNet face detection 2023mar | OpenCV Zoo | MIT | wird beim ersten Start geladen | `8f2383e4dd3cfbb4` face_detection_yunet_2023mar.onnx |
| Gefahrenmodell (Zweitmeinung) | Sicht; trainiert auf AIDERv2 | eigene Gewichte; Trainingsdaten CC-BY-4.0 | liegt im Repository | `44dfe4ae22f5b964` hazard-head.siglip2-base-patch32-256-onnx.json |
| JetBrains Mono (Regular, Medium, Bold) | JetBrains | OFL-1.1 | liegt im Repository | `f1a7a03672cdd494` JetBrainsMono-Regular.woff2; `fe1c9099e3ea4123` JetBrainsMono-Medium.woff2; `08863c7964612257` JetBrainsMono-Bold.woff2 |
| Kartenkacheln Mittelrhein (Zoom 5 bis 14) | OpenStreetMap-Mitwirkende über OpenFreeMap; Schema OpenMapTiles | ODbL-1.0 (Daten); CC-BY-4.0 (Schema) | liegt im Repository | `a2485b8e4772c746` manifest.json |
| Höhenlinien, abgeleitet aus Mapzen Terrain Tiles | Mapzen und die dort genannten Quellen | siehe Quellenliste der Terrain Tiles | liegt im Repository, in den Kartenkacheln | nicht erfasst |
| Übungsaufnahmen (45 Stück) | Mixkit | Mixkit Stock Video Free License | werden mit pnpm exercise:fetch geladen, nicht mitgeliefert | nicht erfasst |

Die vollständigen Prüfsummen stehen in der maschinenlesbaren Liste. Die Modellgewichte ändern sich
im Betrieb nicht; eine abweichende Prüfsumme heißt, dass eine andere Datei geladen wurde.

## 5. Was der Betreiber mitbringt

| Voraussetzung | Lizenz | Bemerkung |
| --- | --- | --- |
| Node.js ab 20.11 | MIT | Laufzeit des Knotens |
| ffmpeg | LGPL-2.1-or-later oder GPL, je nach Ausgabe | zerlegt Aufnahmen in Bilder; wird als eigenes Programm aufgerufen, nicht eingebunden |

## 6. Abgleich mit bekannten Schwachstellen

Abgeglichen am 18. November 2026 mit der Datenbank der Paketverwaltung (`pnpm audit`, GitHub Advisory
Database). Ausgelieferte Pakete: kein bekannter Befund.
Werkzeuge zum Bauen und Prüfen: ein bekannter Befund. Diese Pakete laufen nicht im Knoten.

- `picomatch`, Einstufung hoch: picomatch vulnerable to ReDoS through single-branch repeated extglobs (GHSA-fc5q-39xc-vjpf)

Der Abgleich ist eine Momentaufnahme. Im Betrieb gehört er in einen regelmäßigen Lauf, und jeder
neue Befund in eine Bewertung, ob der Knoten betroffen ist.

## 7. Alle Pakete

| Paket | Fassung | Lizenz | Plattform |
| --- | --- | --- | --- |
| `@emnapi/runtime` | 1.11.3 | MIT | alle |
| `@fastify/accept-negotiator` | 2.1.2 | MIT | alle |
| `@fastify/ajv-compiler` | 4.0.8 | MIT | alle |
| `@fastify/busboy` | 3.2.6 | MIT | alle |
| `@fastify/deepmerge` | 3.2.4 | MIT | alle |
| `@fastify/error` | 4.2.1 | MIT | alle |
| `@fastify/fast-json-stringify-compiler` | 5.2.0 | MIT | alle |
| `@fastify/forwarded` | 3.1.2 | MIT | alle |
| `@fastify/merge-json-schemas` | 0.2.2 | MIT | alle |
| `@fastify/multipart` | 10.1.9 | MIT | alle |
| `@fastify/proxy-addr` | 5.1.3 | MIT | alle |
| `@fastify/send` | 4.2.1 | MIT | alle |
| `@fastify/static` | 10.1.11 | MIT | alle |
| `@huggingface/jinja` | 0.5.13 | MIT | alle |
| `@huggingface/tokenizers` | 0.2.0 | Apache-2.0 | alle |
| `@huggingface/transformers` | 4.3.2 | Apache-2.0 | alle |
| `@img/colour` | 1.1.0 | MIT | alle |
| `@img/sharp-darwin-arm64` | 0.35.5 | Apache-2.0 | darwin · arm64 |
| `@img/sharp-darwin-x64` | 0.35.5 | Apache-2.0 | darwin · x64 |
| `@img/sharp-freebsd-wasm32` | 0.35.5 | Apache-2.0 | freebsd |
| `@img/sharp-libvips-darwin-arm64` | 1.3.4 | LGPL-3.0-or-later | darwin · arm64 |
| `@img/sharp-libvips-darwin-x64` | 1.3.4 | LGPL-3.0-or-later | darwin · x64 |
| `@img/sharp-libvips-linux-arm` | 1.3.4 | LGPL-3.0-or-later | linux · arm |
| `@img/sharp-libvips-linux-arm64` | 1.3.4 | LGPL-3.0-or-later | linux · arm64 |
| `@img/sharp-libvips-linux-ppc64` | 1.3.4 | LGPL-3.0-or-later | linux · ppc64 |
| `@img/sharp-libvips-linux-riscv64` | 1.3.4 | LGPL-3.0-or-later | linux · riscv64 |
| `@img/sharp-libvips-linux-s390x` | 1.3.4 | LGPL-3.0-or-later | linux · s390x |
| `@img/sharp-libvips-linux-x64` | 1.3.4 | LGPL-3.0-or-later | linux · x64 |
| `@img/sharp-libvips-linuxmusl-arm64` | 1.3.4 | LGPL-3.0-or-later | linux · arm64 |
| `@img/sharp-libvips-linuxmusl-x64` | 1.3.4 | LGPL-3.0-or-later | linux · x64 |
| `@img/sharp-linux-arm` | 0.35.5 | Apache-2.0 | linux · arm |
| `@img/sharp-linux-arm64` | 0.35.5 | Apache-2.0 | linux · arm64 |
| `@img/sharp-linux-ppc64` | 0.35.5 | Apache-2.0 | linux · ppc64 |
| `@img/sharp-linux-riscv64` | 0.35.5 | Apache-2.0 | linux · riscv64 |
| `@img/sharp-linux-s390x` | 0.35.5 | Apache-2.0 | linux · s390x |
| `@img/sharp-linux-x64` | 0.35.5 | Apache-2.0 | linux · x64 |
| `@img/sharp-linuxmusl-arm64` | 0.35.5 | Apache-2.0 | linux · arm64 |
| `@img/sharp-linuxmusl-x64` | 0.35.5 | Apache-2.0 | linux · x64 |
| `@img/sharp-wasm32` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | alle |
| `@img/sharp-webcontainers-wasm32` | 0.35.5 | Apache-2.0 | wasm32 |
| `@img/sharp-win32-arm64` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | win32 · arm64 |
| `@img/sharp-win32-ia32` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | win32 · ia32 |
| `@img/sharp-win32-x64` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | win32 · x64 |
| `@isaacs/nonrecursive-glob-match` | 1.1.0 | BlueOak-1.0.0 | alle |
| `@lukeed/ms` | 2.0.2 | MIT | alle |
| `@pinojs/redact` | 0.4.0 | MIT | alle |
| `@protobufjs/aspromise` | 1.1.2 | BSD-3-Clause | alle |
| `@protobufjs/base64` | 1.1.2 | BSD-3-Clause | alle |
| `@protobufjs/codegen` | 2.0.5 | BSD-3-Clause | alle |
| `@protobufjs/eventemitter` | 1.1.1 | BSD-3-Clause | alle |
| `@protobufjs/fetch` | 1.1.1 | BSD-3-Clause | alle |
| `@protobufjs/float` | 1.0.2 | BSD-3-Clause | alle |
| `@protobufjs/path` | 1.1.2 | BSD-3-Clause | alle |
| `@protobufjs/pool` | 1.1.0 | BSD-3-Clause | alle |
| `@protobufjs/utf8` | 1.1.2 | BSD-3-Clause | alle |
| `@types/node` | 22.20.5 | MIT | alle |
| `abstract-logging` | 2.0.1 | MIT | alle |
| `adm-zip` | 0.6.1 | MIT | alle |
| `ajv` | 8.20.0 | MIT | alle |
| `ajv-formats` | 3.0.1 | MIT | alle |
| `atomic-sleep` | 1.0.0 | MIT | alle |
| `avvio` | 9.3.1 | MIT | alle |
| `balanced-match` | 4.0.4 | MIT | alle |
| `brace-expansion` | 5.0.13 | MIT | alle |
| `content-disposition` | 3.0.0 | MIT | alle |
| `cookie` | 2.0.2 | MIT | alle |
| `define-data-property` | 1.1.4 | MIT | alle |
| `define-properties` | 1.2.1 | MIT | alle |
| `depd` | 2.0.0 | MIT | alle |
| `dequal` | 2.0.3 | MIT | alle |
| `detect-libc` | 2.1.2 | Apache-2.0 | alle |
| `es-define-property` | 1.0.1 | MIT | alle |
| `es-errors` | 1.3.0 | MIT | alle |
| `escape-html` | 1.0.3 | MIT | alle |
| `escape-string-regexp` | 4.0.0 | MIT | alle |
| `fast-decode-uri-component` | 1.0.1 | MIT | alle |
| `fast-deep-equal` | 3.1.3 | MIT | alle |
| `fast-json-stringify` | 7.3.6 | MIT | alle |
| `fast-querystring` | 1.1.2 | MIT | alle |
| `fast-uri` | 3.1.9 | BSD-3-Clause | alle |
| `fast-uri` | 4.2.3 | BSD-3-Clause | alle |
| `fastify` | 5.12.8 | MIT | alle |
| `fastify-plugin` | 6.0.1 | MIT | alle |
| `fastq` | 1.20.3 | ISC | alle |
| `find-my-way` | 9.10.1 | MIT | alle |
| `flatbuffers` | 25.9.23 | Apache-2.0 | alle |
| `glob` | 14.0.6 | BlueOak-1.0.0 | alle |
| `global-agent` | 4.1.7 | BSD-3-Clause | alle |
| `globalthis` | 1.0.4 | MIT | alle |
| `gopd` | 1.2.0 | MIT | alle |
| `guid-typescript` | 1.0.9 | ISC | alle |
| `has-property-descriptors` | 1.0.2 | MIT | alle |
| `http-errors` | 2.0.1 | MIT | alle |
| `inherits` | 2.0.4 | ISC | alle |
| `ipaddr.js` | 2.5.0 | MIT | alle |
| `json-schema-ref-resolver` | 3.0.1 | MIT | alle |
| `json-schema-traverse` | 1.0.0 | MIT | alle |
| `light-my-request` | 6.8.1 | BSD-3-Clause | alle |
| `long` | 5.3.2 | Apache-2.0 | alle |
| `lru-cache` | 11.5.3 | BlueOak-1.0.0 | alle |
| `matcher` | 4.0.0 | MIT | alle |
| `mime` | 3.0.0 | MIT | alle |
| `minimatch` | 11.0.9 | BlueOak-1.0.0 | alle |
| `minipass` | 7.1.3 | BlueOak-1.0.0 | alle |
| `object-keys` | 1.1.1 | MIT | alle |
| `on-exit-leak-free` | 2.1.2 | MIT | alle |
| `onnxruntime-common` | 1.30.0 | MIT | alle |
| `onnxruntime-common` | 1.31.0-dev.20260911-2a43ec07e | MIT | alle |
| `onnxruntime-node` | 1.30.0 | MIT | win32/darwin/linux |
| `onnxruntime-web` | 1.31.0-dev.20260914-8d85527a0 | MIT | alle |
| `path-scurry` | 3.0.0 | BlueOak-1.0.0 | alle |
| `pino` | 10.4.0 | MIT | alle |
| `pino-abstract-transport` | 3.0.0 | MIT | alle |
| `pino-std-serializers` | 7.1.0 | MIT | alle |
| `platform` | 1.3.6 | MIT | alle |
| `process-warning` | 5.1.1 | MIT | alle |
| `protobufjs` | 7.6.6 | BSD-3-Clause | alle |
| `quick-format-unescaped` | 4.0.4 | MIT | alle |
| `react` | 19.3.1 | MIT | alle |
| `react-dom` | 19.3.1 | MIT | alle |
| `real-require` | 1.0.0 | MIT | alle |
| `require-from-string` | 2.0.2 | MIT | alle |
| `ret` | 0.5.1 | MIT | alle |
| `reusify` | 1.1.0 | MIT | alle |
| `rfdc` | 1.4.1 | MIT | alle |
| `safe-regex2` | 5.1.2 | MIT | alle |
| `safe-stable-stringify` | 2.5.0 | MIT | alle |
| `scheduler` | 0.28.0 | MIT | alle |
| `secure-json-parse` | 4.1.1 | BSD-3-Clause | alle |
| `semver` | 7.8.6 | ISC | alle |
| `serialize-error` | 8.1.0 | MIT | alle |
| `set-cookie-parser` | 3.2.3 | MIT | alle |
| `setprototypeof` | 1.2.0 | ISC | alle |
| `sharp` | 0.35.5 | Apache-2.0 | alle |
| `sonic-boom` | 4.2.1 | MIT | alle |
| `split2` | 4.2.0 | ISC | alle |
| `statuses` | 2.0.2 | MIT | alle |
| `thread-stream` | 4.2.1 | MIT | alle |
| `toad-cache` | 3.7.4 | MIT | alle |
| `toidentifier` | 1.0.1 | MIT | alle |
| `tslib` | 2.9.1 | 0BSD | alle |
| `type-fest` | 0.20.2 | (MIT OR CC0-1.0) | alle |
| `undici-types` | 6.21.0 | MIT | alle |

## 8. Was diese Liste nicht leistet

- Sie ist keine rechtliche Prüfung. Ob die Lizenzen zum vorgesehenen Vertrieb passen, entscheidet
  ein Jurist; die Liste gibt ihm die Grundlage.
- Die Binärpakete von onnxruntime und sharp enthalten weitere Bibliotheken. Sie stehen in den
  Hinweisdateien dieser Pakete, nicht einzeln hier.
- ffmpeg bringt der Betreiber mit. Unter welcher Lizenz es steht, hängt von der gewählten Ausgabe ab.
- Die Prüfsummen der Pakete stammen aus der Sperrdatei. Sie belegen, dass eingerichtet wird, was
  beim Erstellen der Sperrdatei vorlag, nicht, dass dieser Stand frei von Fehlern ist.
- Für Binärpakete der Plattformen, auf denen die Liste nicht erzeugt wurde, stammt die Lizenzangabe
  aus der Auskunft der Paketverwaltung (festgehalten in `tools/stueckliste/lizenzen.json`), nicht aus
  einer eingerichteten Datei.
