# Couch-Dungeon

Fantasy-Rollenspiel für 1–6 Spieler an einem Tisch. Der Fernseher (oder Laptop) ist das Spielbrett, die Handys sind die Controller. Gemacht für komplette Rollenspiel-Anfänger.

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

Zum Testen am Rechner: 1 Tab mit `#/tv`, 2–6 Tabs mit `#/play` in der Handy-Ansicht der DevTools.

Ablauf am Fernseher: Titel → (Wie spielt man das?) → Geschichte → Spieldauer → Lobby → Abenteuer → „Was wirklich geschah“.

Mit `?net=local|peer|supabase` wird die Verbindungsart gewählt. Standard: `local` auf `localhost` (mehrere Tabs auf einem Rechner), sonst `peer`.

### Mit echten Handys spielen (`peer`)

1. Das Spiel auf GitHub Pages öffnen (siehe „Veröffentlichen“) und am Fernseher `#/tv` aufrufen.
2. Handys scannen den QR-Code. Alle Geräte brauchen Internet: Der kostenlose PeerJS-Server stellt nur den Kontakt her, danach reden Fernseher und Handys direkt miteinander (WebRTC). Ein Konto ist nicht nötig.
3. Bricht die Verbindung ab, verbindet sich das Handy von selbst neu.

**Wenn ein Handy hängt:** Browser/Tab einfach schließen und das Spiel neu öffnen (QR-Code oder gleiche Adresse). Das Handy bekommt seinen Platz und seine Figur zurück – auch mitten im Kampf, auch wenn gerade ein Wurf offen ist. Hat das Handy seine Daten verloren (privater Tab, anderer Browser, anderes Handy), zeigt es „Wer bist du?“ mit allen Helden, deren Handy gerade fehlt – antippen, weiter geht's. Das alte Fenster zeigt dann „Das Spiel ist woanders offen“.

Testmodus ohne Handys: `#/tv?demo` startet direkt mit vier Beispiel-Helden. Auf dem Spielbrett baut **R** einen neuen Zufalls-Dungeon, **F** startet einen Demo-Kampf gegen drei Goblins (die Helden kämpfen dann von selbst).

### KI-Spielleitung (optional, kostenlos)

Ohne KI erzählt das Drehbuch. Mit KI erzählt die Spielleitung frei, spielt die Nebenfiguren, reagiert auf **Freie Aktionen** (z. B. „Ich biete der Wache ein Goldstück an“), verlangt dafür passende Proben und wählt am Ende den Ausklang. Regeln, Zahlen, Kämpfe und die Geschichte selbst bleiben im Code.

1. Kostenlosen Schlüssel in [Google AI Studio](https://aistudio.google.com) erstellen.
2. Am Fernseher: **⚙️ Einstellungen → Gemini** → Schlüssel einfügen → **Verbindung testen** → Speichern.
3. Modell und Ausweich-Modell sind frei wählbar (Standard `gemini-flash-latest`, bei Limit `gemini-flash-lite-latest`), weil Google die Gratis-Modelle regelmäßig wechselt. „Verbindung testen“ füllt die Liste mit den Modellen, die der Schlüssel nutzen darf.

Sicherheit: Der Schlüssel liegt **nur im Browser-Speicher des Fernsehers/Laptops**, wird nie an die Handys geschickt und gehört nie ins Repo. Er geht nur an Google, im Header `x-goog-api-key`. Es gibt keine Formatprüfung (Schlüssel dürfen mit `AQ.` oder `AIza` beginnen). Nur auf eigenen Geräten verwenden.

Sparsam: höchstens ein KI-Aufruf pro Spieleraktion, Bewegung und normale Angriffe laufen ohne KI. Der Zähler „KI-Aufrufe heute“ steht in den Einstellungen. Bei Limit (429), Zeitüberschreitung oder kaputter Antwort erzählt automatisch das Drehbuch weiter („Der Spielleiter macht kurz Pause“); das Spiel stoppt nie. Jede KI-Antwort wird geprüft: Sie darf nur Hinweise der ausgewürfelten Wahrheit verraten, nur erlaubte Merker setzen und nur passende Enden wählen.

**DM-Labor:** `#/dm-lab` schickt denselben Spielmoment an alle eingerichteten Modelle (plus Drehbuch) und zeigt die Antworten nebeneinander.

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
