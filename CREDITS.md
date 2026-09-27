# Credits

## Regelwerk

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.

SRD-Daten im JSON-Format: [5e-bits/5e-database](https://github.com/5e-bits/5e-database) (Code MIT, Inhalt SRD 5.1). Wir verwenden eine reduzierte Teilmenge (`src/data/srd/`), die deutschen Namen und alle Glossar-Texte sind selbst formuliert.

5E compatible. Dieses Spiel ist nicht mit Wizards of the Coast verbunden.

## Grafik

- **Dungeon Crawl Stone Soup Tiles** (CC0) – https://opengameart.org/content/dungeon-crawl-32x32-tiles und https://opengameart.org/content/dungeon-crawl-32x32-tiles-supplemental, als Einzeldateien aus [Snowdrama/CC0-Dungeon-Pack](https://github.com/Snowdrama/CC0-Dungeon-Pack). Projekt: https://github.com/crawl/crawl
  Wir verwenden nur eine Auswahl (`scripts/assets/selection.ts`), zusammengefasst in `public/assets/atlas.png`. Die Herkunft jedes Tiles steht in `public/assets/tileset.json`.
- Eigene Kacheln (Fass, Hebel, Kronleuchter, Geheimnisse, Kessel, Lagerfeuer), gezeichnet von `scripts/assets/draw-custom.ts` – CC0.

## Stimmen

- [Piper](https://github.com/rhasspy/piper) (MIT), Stimmen aus [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices): „thorsten“ und „thorsten_emotional“ (Thorsten Müller, CC0), „kerstin“ (CC0). Werden erst im Browser geladen, nicht mit dem Spiel ausgeliefert.
- [onnxruntime-web](https://github.com/microsoft/onnxruntime) (MIT) und piper-phonemize / [espeak-ng](https://github.com/espeak-ng/espeak-ng) (GPL-3.0), zur Laufzeit von jsDelivr geladen.

## Software

- [Phaser](https://phaser.io) (MIT)
- [Vite](https://vite.dev) (MIT)
- [Vitest](https://vitest.dev) (MIT)
- [supabase-js](https://github.com/supabase/supabase-js) (MIT) und Supabase Realtime
- [PeerJS](https://peerjs.com) (MIT) und der öffentliche PeerJS-Vermittlungsserver
- [node-qrcode](https://github.com/soldair/node-qrcode) (MIT)
- [pngjs](https://github.com/pngjs/pngjs) (MIT, nur für das Import-Skript)
