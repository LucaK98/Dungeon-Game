# Couch-Dungeon

Fantasy-Rollenspiel für 1–4 Spieler an einem Tisch. Der Fernseher (oder Laptop) ist das Spielbrett, die Handys sind die Controller. Gemacht für komplette Rollenspiel-Anfänger.

Kompatibel mit den Regeln der 5. Edition (SRD 5.1). Den kompletten Projektplan findest du in [`CLAUDE.md`](CLAUDE.md).

## Starten

Voraussetzung: [Node.js](https://nodejs.org) 22 (oder 20.19+).

```bash
npm install
npm run dev
```

Dann im Browser öffnen:

| Adresse | Wofür |
|---|---|
| `http://localhost:5173/#/tv` | Spielbrett (Fernseher/Laptop) |
| `http://localhost:5173/#/play?room=ABCD` | Controller (Handy) |

Zum Testen am Rechner: 1 Tab mit `#/tv`, 2–4 Tabs mit `#/play` in der Handy-Ansicht der DevTools.

Mit `?net=local|peer|supabase` wird die Verbindungsart gewählt (Standard: `local`).

Testmodus ohne Handys: `#/tv?demo` startet direkt mit vier Beispiel-Helden. Auf dem Spielbrett baut **R** einen neuen Zufalls-Dungeon, **F** startet einen Demo-Kampf gegen drei Goblins (die Helden kämpfen dann von selbst).

## Befehle

| Befehl | Was passiert |
|---|---|
| `npm run dev` | Entwicklungsserver mit Live-Reload |
| `npm run build` | Typprüfung und fertiger Build in `dist/` |
| `npm run preview` | Den Build lokal ansehen |
| `npm test` | Tests (Vitest) |
| `npm run simulate` | Simulierter Kampf in der Konsole mit allen Würfen erklärt (`-- --seed 7 --level 3 --enemies ogre,wolf`) |
| `npm run import:assets` | Grafiken aus dem DCSS-Tileset neu zusammenstellen (schreibt `public/assets/`) |
| `npm run import:srd` | SRD-Daten neu aus `5e-bits/5e-database` laden (schreibt `src/data/srd/`) |

## Veröffentlichen

Jeder Push auf `main` baut das Spiel und stellt es über GitHub Pages bereit (`.github/workflows/deploy.yml`). Einmalig nötig: In den Repo-Einstellungen unter **Settings → Pages → Source** „GitHub Actions“ auswählen.

## Ordner

```
src/
  main.ts      Routing (#/tv, #/play)
  shared/      Typen, Events, Transport- & DM-Interfaces
  net/         Verbindungen (lokal, PeerJS, …)
  engine/      Regel-Engine (ohne UI, getestet)
  dm/          Spielleiter (geskriptet, später KI) und Geschichten
  data/        SRD-Daten, Übersetzungen, Raum-Module, Glossar
  tv/          Spielbrett (Phaser)
  play/        Handy-Oberfläche
public/assets/ Grafiken
scripts/       Import-Skripte
```

## Lizenzen

Siehe [`CREDITS.md`](CREDITS.md).
