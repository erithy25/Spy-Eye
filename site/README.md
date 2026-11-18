# Sicht — Website

Statische Seite ohne Framework und ohne Build-Schritt. Deutsch ist die Fassung in `index.html`,
Englisch steht in `i18n.js`. Die Seite lädt nichts von außen: Schrift, Kartendaten und Skripte
liegen in diesem Ordner.

## Ansehen

`index.html` im Browser öffnen genügt. Wer lieber über einen lokalen Server geht:

```bash
python3 -m http.server 4321 --directory site
```

Dann <http://127.0.0.1:4321/>. Englisch direkt: `?lang=en`.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html` | Aufbau und deutscher Text |
| `i18n.js` | englischer Text (Schlüssel = `data-i18n`), Beschriftungen der Karte |
| `styles.css` | Gestaltung nach `docs/BRAND.md` |
| `main.js` | Sprachumschaltung, Bildrahmen, Menü, Karte im Kopfbereich |
| `assets/map/hero.js` | Kartendaten des Kopfbereichs, erzeugt aus den Kacheln der Konsole |
| `assets/fonts/` | JetBrains Mono (SIL OFL 1.1, Lizenztext in `OFL.txt`) |
| `assets/screens/` | Bildschirmaufnahmen der Konsole, siehe unten |
| `tools/build-hero-map.mjs` | erzeugt `assets/map/hero.js` neu |

## Bildschirmaufnahmen

Sieben PNG-Dateien im Seitenverhältnis 16 : 10 (vorgesehen: 2880 × 1800, dunkle Oberfläche):

```
assets/screens/lage.png
assets/screens/suche.png
assets/screens/wachen.png
assets/screens/vorgaenge.png
assets/screens/verbund.png
assets/screens/protokoll.png
assets/screens/wirkung.png
```

Solange eine Datei fehlt, zeigt ihr Rahmen eine Passmarke und den Namen des Reiters; die
Konsole des Browsers meldet dafür je Datei einen 404. Sobald die Datei da ist, erscheint das
Bild ohne weitere Änderung. Bilder werden oben links ausgerichtet und auf den Rahmen
zugeschnitten.

## Kontakt

Der Aufruf „Vorführung anfragen“ erscheint erst, wenn am `<body>` ein Ziel eingetragen ist:

```html
<body data-contact="name@beispiel.de">
```

Erlaubt sind eine E-Mail-Adresse oder eine Adresse, die mit `https://` beginnt. Ohne Eintrag
wird der Aufruf nicht gezeigt.

## Karte neu erzeugen

Die Kartendaten stammen aus `apps/web/public/map` (Zoomstufe 12 um Koblenz, dazu die
Nebenstraßen der Stufe 13):

```bash
node site/tools/build-hero-map.mjs
```

Kartendaten © OpenStreetMap-Mitwirkende (ODbL), Schema OpenMapTiles, Höhendaten Mapzen.

## Was die Seite behauptet

Nur, was in `docs/BRAND.md` als belegt steht. Die drei Belege im Abschnitt „Problem“ sind an
den verlinkten Quellen wörtlich nachgeprüft. Die Seite ist mit `noindex` ausgezeichnet, weil
der Name noch nicht geprüft ist.
