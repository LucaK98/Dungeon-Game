# Projekt: Couch-Dungeon (Arbeitstitel)

Fantasy-Rollenspiel für 1–6 Spieler an einem Tisch.
- **Fernseher/Laptop** = Spielbrett (Karte, Figuren, Erzähltext, QR-Code zum Beitreten)
- **Handys** = persönliche Controller (Charakter, Aktionen, Würfel)
- **Dungeon Master** = zuerst ein geskripteter Erzähler, später eine KI

Sprache der Oberfläche und Texte: **Deutsch**.

**Zielgruppe: komplette Anfänger.** Niemand am Tisch hat je ein Pen-&-Paper-Rollenspiel gespielt. Das Spiel muss sich selbst erklären: Jeder Fachbegriff ist antippbar, jeder Wurf wird aufgeschlüsselt, und das erste Abenteuer ist ein Tutorial. Details im Abschnitt **„Hilfe-System (?)“**.

---

## Reihenfolge – WICHTIG

Das Projekt ist in zwei Teile getrennt:

- **Teil A (jetzt):** Alles, was **ohne externe Accounts** geht. Keine Supabase. Multiplayer läuft lokal über Browser-Tabs und danach über PeerJS (kostenloser öffentlicher Vermittlungsserver, kein Account). Die KI kommt als letzte Phase (A8) mit einem kostenlosen Gemini-Key dazu, den ich selbst auf dem TV eintrage.
- **Teil B (später, daheim):** Supabase, KI-Aufrufe auf den Server verlagern, Persistenz.

Deshalb müssen **Netzwerk und Dungeon Master von Anfang an hinter Interfaces** liegen (siehe Architektur). Teil B tauscht nur Implementierungen aus, die Spiellogik bleibt unverändert.

---

## Quellen (geprüft)

Alle Quellen sind frei nutzbar. Bevorzugt von **GitHub** laden, weil andere Seiten in der Sandbox evtl. blockiert sind.

### Regelwerk
| Quelle | Inhalt | Lizenz |
|---|---|---|
| SRD 5.1 (Wizards of the Coast) | Offizielles Grundregelwerk 5e (2014) | CC-BY-4.0 |
| https://github.com/5e-bits/5e-database | SRD als JSON (`src/2014/en/`: Klassen, Monster, Zauber, Ausrüstung, Regeln) | Code MIT, Inhalt SRD |

- Wir nutzen **SRD 5.1 (2014)**, weil die JSON-Daten dafür vollständig sind.
- Nur eine **Teilmenge** übernehmen (siehe Phase A1) und ins Deutsche übersetzen.
- Pflicht-Attribution in `CREDITS.md` und im Spiel (Credits-Bildschirm):
  > This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.
- **Nicht verwenden:** den Namen „Dungeons & Dragons“/„D&D“, Logos, Monster und Namen außerhalb des SRD (z. B. Beholder, Mind Flayer). Erlaubt ist die Formulierung „5E compatible“.

### Grafik
| Quelle | Inhalt | Lizenz | Bezug |
|---|---|---|---|
| **Dungeon Crawl Stone Soup Tiles** – https://github.com/Snowdrama/CC0-Dungeon-Pack | 6000+ Tiles à 32×32: Böden, Wände, Türen, Monster, Items, Zaubereffekte, **Charakter-Baukasten** (Grundfigur + Haare + Rüstung + Waffe als Überlagerung) | CC0 | GitHub → **Hauptquelle** |
| Kenney „Tiny Dungeon“ – https://kenney.nl/assets/tiny-dungeon | 130+ Tiles 16×16, sehr sauberer Stil | CC0 | manuell (optional) |
| „Tiny Creatures“ – https://clintbellanger.itch.io/tiny-creatures | 100+ Monster passend zu Tiny Dungeon | CC0 | manuell (optional) |
| 0x72 „DungeonTileset II“ – https://0x72.itch.io/dungeontileset-ii | 16×16, animierte Helden und Monster, sehr beliebt | CC0 | manuell (optional, späteres Grafik-Upgrade) |

- **Start mit DCSS**, weil alles von GitHub kommt und der Charakter-Baukasten perfekt zur Charaktererstellung am Handy passt.
- Die Grafik-Schicht so bauen, dass ein Tileset austauschbar ist (Mapping-Datei `tileset.json`: logischer Name → Datei/Frame).
- Pixel-Art immer mit `pixelArt: true` / Nearest-Neighbor skalieren, ganzzahlige Skalierung auf dem TV.

---

## Tech-Stack

| Bereich | Wahl |
|---|---|
| Build | Vite + TypeScript (strict) |
| Spielbrett (TV) | Phaser 3 |
| Handy-UI | Plain TS + CSS, mobile-first |
| Tests | Vitest |
| Multiplayer Teil A | `BroadcastChannel` (lokal, Tabs) → **PeerJS** (echte Geräte) |
| Multiplayer Teil B | Supabase Realtime |
| QR-Code | `qrcode` (npm) |
| Sprachausgabe | Web Speech API (`speechSynthesis`) |
| Hosting | GitHub Pages via GitHub Action |

## Routing
Hash-Routing (GitHub Pages):
- `/#/tv` → Host/Spielbrett
- `/#/play?room=ABCD` → Handy

---

## Architektur

### Grundsätze
1. **TV-Client ist autoritativ.** Er führt die Regel-Engine aus, validiert jede Aktion und verteilt den Zustand.
2. **Der DM erzählt, der Code rechnet.** Würfel, HP, Bewegung, Initiative, Schaden immer im Code.
3. **Würfeln:** Handy löst aus und animiert, Ergebnis erzeugt der Host.
4. **Keine Secrets im Frontend** – niemals.

### Interfaces (von Anfang an)

```ts
// src/shared/transport.ts
interface Transport {
  createRoom(): Promise<RoomCode>;                 // nur TV
  joinRoom(code: RoomCode, player: PlayerInfo): Promise<void>; // nur Handy
  send(event: GameEvent, to?: PlayerId): void;
  onEvent(handler: (e: GameEvent, from: PlayerId | "host") => void): void;
  onPresence(handler: (players: PlayerInfo[]) => void): void;
}
// Implementierungen: LocalTransport (A2), PeerTransport (A7), SupabaseTransport (B1)
// Auswahl per URL-Parameter ?net=local|peer|supabase

// src/shared/dm.ts
interface DungeonMaster {
  respond(ctx: DmContext, action: PlayerAction): Promise<DmResponse>;
}
// Implementierungen: ScriptedDM (A6), AiDM mit Gemini (A8)
```

### DmResponse (gilt für ScriptedDM und später AiDM)
```json
{
  "narration": "Die Tür knarrt. Dahinter riecht es nach nassem Fell ...",
  "npc_say": { "name": "Wirtin Hilde", "text": "..." },
  "request_roll": { "playerId": "p2", "ability": "WIS", "skill": "perception", "dc": 13 },
  "spawn": [{ "monster": "wolf", "count": 2, "zone": "north" }],
  "reveal_room": "room_03",
  "next": "await_roll | await_action | start_combat | end_scene"
}
```
Der Host validiert jede Anweisung (Monster existiert? SG zwischen 5 und 25? Raum existiert?).

### Events (zentral in `src/shared/events.ts`)
- `player_action` (Handy → Host)
- `state_update` (Host → alle)
- `request_roll` (Host → ein Handy)
- `roll_result` (Host → alle)
- `narration` (Host → alle)
- `clue_found` (Host → alle), `secret_message` (Host → ein Handy)

---

## Hilfe-System (?)

Das Hilfe-System ist ein Kernfeature, keine Politur. Es wächst mit jeder Phase mit.

### 1. Glossar (Datenbasis)
- `src/data/help/glossar.de.json`: jeder Begriff, der im Spiel vorkommt
- Pro Eintrag:
  - `kurz`: 1 Satz, Alltagssprache
  - `lang`: 3–6 Sätze mit Beispiel aus dem Spiel
  - `beispiel`: optional eine konkrete Rechnung
  - `siehe_auch`: verwandte Begriffe
- Beispiel:
  ```json
  "ruestungsklasse": {
    "titel": "Rüstungsklasse (RK)",
    "kurz": "Wie schwer du zu treffen bist.",
    "lang": "Greift dich ein Gegner an, würfelt er einen W20 und addiert seinen Angriffsbonus. Ist das Ergebnis mindestens so hoch wie deine RK, trifft er. Rüstung und Schild erhöhen deine RK, ein hoher Geschicklichkeitswert auch.",
    "beispiel": "Goblin würfelt 11 + 4 = 15. Deine RK ist 16 → verfehlt.",
    "siehe_auch": ["angriffswurf", "w20", "geschicklichkeit"]
  }
  ```
- Mindestens abdecken: alle 6 Attribute, Modifikator, W4–W20, Probe, Schwierigkeitsgrad (SG), Rettungswurf, Angriffswurf, RK, Trefferpunkte, Initiative, Zug/Runde, Bewegung, Aktion/Bonusaktion/Reaktion, Vorteil/Nachteil, kritischer Treffer, Übungsbonus, Zauberplätze, Bewusstlos/Todesrettungswurf, Zustände (vergiftet, liegend …), jede Klasse, jedes Volk, jeder Zauber, jede Waffe, jedes Monster
- Texte selbst formulieren (einfaches Deutsch), nicht aus dem SRD kopieren
- Die Texte sollen eine Anfängergruppe ansprechen: locker, freundlich, keine Rollenspiel-Fachsprache ohne Erklärung

### 2. „?“ auf dem Handy
- Fester **?-Button** oben rechts auf jedem Handy-Bildschirm
- **Tipp-Modus:** ? antippen → alle erklärbaren Elemente leuchten auf → Element antippen → Erklärung als Bottom-Sheet (erst `kurz`, „Mehr“ klappt `lang` + `beispiel` auf, Links zu `siehe_auch`)
- Zusätzlich sind Fachbegriffe im Fließtext unterstrichen und direkt antippbar
- **Suche:** im ?-Menü ein Suchfeld über das ganze Glossar
- **„Was kann ich jetzt tun?“:** zeigt, je nach Situation, in 2–4 Sätzen die aktuellen Möglichkeiten (z. B. „Du bist dran. Du kannst dich bis zu 6 Felder bewegen UND eine Aktion machen, z. B. angreifen. Tipp: Der Goblin neben dir hat nur noch wenig Leben.“)

### 3. Würfe erklären
- Jedes Würfelergebnis wird aufgeschlüsselt, auf Handy und TV:
  „🎲 14 + 3 (Stärke) + 2 (Übung) = **19** gegen RK 15 → **Treffer!**“
- Antippen der Zeile öffnet die passenden Glossar-Einträge

### 4. Anfängermodus (Standard: an)
- Empfohlene Aktion auf dem Handy dezent hervorheben
- Kurze Hinweis-Blasen beim ersten Auftreten einer Mechanik („Erster Kampf! So funktioniert eine Runde …“), jede nur einmal pro Spieler
- In den Einstellungen abschaltbar

### 5. Einstieg & Tutorial
- TV-Startbildschirm: Button **„Wie spielt man das?“** → 60-Sekunden-Erklärung in 5 Folien (Was ist das Spiel? Wer macht was? Was ist der W20? Wie läuft ein Zug? Gewonnen/verloren?)
- Das erste Abenteuer (A6) beginnt mit einer **Tutorial-Szene**, die jede Grundmechanik einmal in Ruhe einführt: bewegen → Probe → einfacher Kampf gegen 1 Ratte → Gegenstand benutzen
- Die Charaktererstellung erklärt jede Klasse in einem Satz („Kämpfer: hält viel aus, gut für Einsteiger“) und empfiehlt Einsteigerklassen

### 6. Regelfragen an den Spielleiter (Teil B)
- Im ?-Menü: **„Frag den Spielleiter“**, eine freie Frage wie „Kann ich auch zwei Mal angreifen?“
- In Teil A: Stichwortsuche im Glossar
- In Teil B: Die KI beantwortet die Frage anhand von Glossar + aktuellem Spielstand, getrennt von der Erzählung und nur an den fragenden Spieler

---

## Geschichten & Spieldauer

### Die drei Geschichten
Alle drei basieren auf **gemeinfreien deutschen Sagen und Märchen** und werden frei nacherzählt. Keine Inhalte aus veröffentlichten Rollenspiel-Abenteuern, Romanen oder Filmen übernehmen.

| # | Titel | Vorlage | Stil | Für wen |
|---|---|---|---|---|
| 1 | **Der Drache vom Drachenfels** | Drachenfels-Sage (Siebengebirge), Sankt-Georg-Legende, Ritterepen | Klassische Ritter-Queste: Burg, Oger, Drache. Enthält das Tutorial | Erste Runde, Einsteiger |
| 2 | **Der Rattenfänger von Hammelstein** | Sage vom Rattenfänger von Hameln | Stadt-Abenteuer, Kobolde, Gespräch statt Kampf möglich | Zweite Runde |
| 3 | **Walpurgisnacht am Brocken** | Harzer Hexensagen, Wilde Jagd | Rätsel und Grusel, Spuren sammeln, Gespräche | Wenn die Gruppe die Regeln kann |

**1 – Der Drache vom Drachenfels** (Ritter-Abenteuer, Hauptgeschichte)
- Stimmung: klassisches Hochmittelalter. Banner, Burgen, Turniere, Eide, Schwerter, ein Drache, der das Land verwüstet.
- Auftakt: Die Helden werden auf **Burg Rheineck** von König Ortwin zu Rittern seines Ordens geschlagen (Tutorial: bewegen, reden, erste Probe beim Ritterschlag-Schwur). Kurz darauf fliegt ein Drache über die Burg und verschleppt die Prinzessin Adelheid zum Drachenfels.
- Ablauf:
  1. **Burghof & Turnierplatz:** Übungskampf gegen Strohpuppen und einen Knappen (Tutorial: Kampf), Ausrüstung beim Schmied
  2. **Die Brücke am Wolfsbach:** Ein **Oger** verlangt Brückenzoll. Kämpfen, überlisten oder mit einem Fass Bier bestechen
  3. **Das verbrannte Dorf:** Überlebende helfen, Hinweise auf die Schwachstelle des Drachen sammeln (eine Schuppe fehlt an seiner Brust)
  4. **Der Einsiedler im Wald:** gibt die **Drachenlanze** (magische Waffe, einmal pro Kampf doppelter Schaden gegen Drachen) nach einer Prüfung
  5. **Kobolde im Drachenfels:** Die Diener des Drachen verteidigen die Stollen, Fallen im Berg
  6. **Der Hort des Drachen:** Endkampf gegen den **jungen Roten Drachen**, die Prinzessin befreien
- Optionale Szenen (für Mittel/Lang): Ritterturnier mit Tjost gegen einen schwarzen Ritter, Räuberbande im Wald, Oger-Höhle mit Oger-Mutter, Nebenquest für den Schmied
- Finale Entscheidung: den Drachenschatz dem König bringen oder an das verbrannte Dorf verteilen (beeinflusst das Ende)
- Wichtige Mechaniken: alle Grundlagen, Reden statt Kämpfen (Oger), magischer Gegenstand, großer Bosskampf mit Feuerodem (Rettungswurf)
- **Neue Klasse für diese Geschichte:** **Ritter** = Paladin aus dem SRD (heilige Kraft, schwere Rüstung, Handauflegen). Im Spiel „Ritter“ nennen, im Glossar erklären

- **Mögliche Wahrheiten (eine wird geheim ausgewürfelt, siehe „Spannung & Twists“):**
  - **A – Der Verräter:** König Ortwin hat dem Drachen einst ein Ei gestohlen, um mit einem gezähmten Drachen Kriege zu gewinnen. Der Drache will nur sein Junges zurück. Das Ei liegt versteckt in der Schatzkammer der Burg. Plötzlich stellt sich die Frage: Kampf oder Frieden?
  - **B – Die Prinzessin:** Adelheid wurde nicht entführt, sie ist freiwillig gegangen. Sie ist eine Drachenblütige und will der Heirat mit dem grausamen Grafen Rotbart entkommen. Rotbart reitet der Gruppe später mit Söldnern hinterher.
  - **C – Der Fluch:** Der Drache ist der verfluchte Bruder des Königs, Prinz Konrad. Der Einsiedler kennt den Gegenfluch, verlangt aber einen hohen Preis. Wer den Drachen tötet, tötet den Prinzen.
  - **D – Der schwarze Ritter:** Hinter allem steckt der Hofmagier Morgrim, der den Drachen mit einem Amulett steuert, um den Thron zu übernehmen. Der „schwarze Ritter“ aus dem Turnier ist sein Handlanger und reitet scheinbar freundlich mit der Gruppe mit.
- **Feste Überraschungen (unabhängig von der Wahrheit):** Der Oger an der Brücke ist nicht böse, sondern hungrig und vertrieben vom Drachen. Wer ihn verschont, kann ihn als Verbündeten im Endkampf rufen. Außerdem gibt es einen Überfall auf dem Rückweg, falls die Gruppe es „zu leicht“ hatte.

**2 – Der Rattenfänger von Hammelstein**
- Das Städtchen Hammelstein leidet unter einer Rattenplage. Ein fremder Pfeifer lockt die Ratten fort, der Bürgermeister verweigert den Lohn, und in der nächsten Nacht verschwinden die Kinder, einer Melodie folgend, in den Berg.
- Ablauf: Marktplatz → Kampf gegen Riesenratten im Keller → Spuren und Zeugen → Stollen im Berg → Kobolde als Diener des Pfeifers → Halle des Pfeifers
- Endgegner: der Pfeifer (verfluchter Barde). Alternative Lösung: Seine Flöte zerbrechen oder den Bürgermeister zwingen, den Lohn doch zu zahlen
- Wichtige Mechaniken: Rattenschwärme, eine Musik-Probe (Charisma), Gespräch statt Kampf möglich
- **Mögliche Wahrheiten:** (A) Der Bürgermeister hat die Ratten selbst herbeigezaubert, um Land billig aufzukaufen, und der Pfeifer ist der Gute. (B) Die Kinder sind nicht gefangen, sie werden im Berg vor einer kommenden Seuche versteckt. (C) Der Pfeifer ist ein Feenwesen und will nur den versprochenen Lohn, notfalls ein Kind der Gruppe als Ersatz. (D) Klassisch: Der Pfeifer ist der Böse, aber einer der Stadträte hilft ihm heimlich

**3 – Walpurgisnacht am Brocken**
- In einem Harzdorf verschwinden Menschen vor der Walpurgisnacht, nachts heulen Wölfe, und alle verdächtigen die Kräuterfrau am Waldrand.
- Ablauf: Dorf mit mehreren Verdächtigen (Gespräche, Spuren sammeln) → Wald bei Nacht, Werwolf-Angriff → Die Kräuterfrau ist unschuldig und hilft → Hexentanzplatz auf dem Brocken → Enthüllung der wahren Hexe (wird pro Partie ausgewürfelt, siehe unten)
- Endgegner: Grüne Vettel mit Werwolf-Diener; die Wilde Jagd als Geisterschar im Finale
- Wichtige Mechaniken: Hinweise sammeln (Hinweisliste am Handy), Gespräche mit Proben, Nacht und Sicht (Licht wird wichtig)
- **Mögliche Wahrheiten (Verdächtige werden neu gemischt):**
  - Die Rolle „wahre Hexe“ wird bei jedem Spiel geheim einem von 4 Dorfbewohnern zugewiesen (Frau des Dorfvorstehers, Pfarrer, Wirt, das stille Mädchen). Die Kräuterfrau ist immer der offensichtliche Verdacht und nie die Täterin
  - Auch der Werwolf ist ein Dorfbewohner (geheim, anderer als die Hexe) und kann tagsüber mit der Gruppe reden

### Spannung & Twists
Die Geschichten sollen **überraschen**. Niemand am Tisch soll schon wissen, wie es ausgeht, auch nicht bei der zweiten Runde.

**1. Geheime Wahrheit pro Partie**
- Jede Geschichte hat 3–4 **mögliche Wahrheiten** (siehe oben). Beim Start würfelt der Host geheim eine aus. Dadurch spielt sich dieselbe Geschichte jedes Mal anders
- Die Wahrheit liegt nur im Host-Zustand (`secret`), wird **nie** an Handys gesendet und nie auf dem TV angezeigt, bis sie enthüllt ist
- Jede Wahrheit hat eigene **Hinweise** (3–5 Stück), die in Szenen verteilt werden. Hinweise sind zuerst doppeldeutig, dann immer klarer. Gefundene Hinweise landen in einer **Hinweisliste am Handy**
- Es gibt auch **falsche Fährten**, die zu einer anderen Wahrheit passen würden
- Nach dem Spiel: Bildschirm „Was wirklich geschah“ mit allen Hinweisen, die man gefunden oder verpasst hat

**2. Was die KI entscheidet (A8)**
Die KI ist Spielleiterin, nicht nur Erzählerin. Sie bekommt die geheime Wahrheit, die Hinweise und den Spielverlauf und darf entscheiden:
- **Wann** ein Twist enthüllt wird (Richtwert: der große Twist etwa bei 60–75 % der Spielzeit, nie vor dem zweiten Akt)
- **Wie** NPCs reagieren: Vertrauen, Misstrauen, Lügen, Verrat, Bestechlichkeit. NPCs haben geheime Ziele (im Story-JSON)
- **Improvisierte Ereignisse**, wenn es langweilig wird: Hinterhalt, ein NPC taucht wieder auf, ein Unwetter, ein Verbündeter wechselt die Seite (Auswahl aus einer Ereignisliste im Story-JSON oder frei, aber vom Code validiert)
- **Konsequenzen** früherer Entscheidungen: Wer den Oger verschont hat, bekommt Hilfe; wer das Dorf ignoriert hat, bekommt dort später keine Hilfe
- **Das Ende**: Es gibt mehrere Enden je Geschichte (Sieg, bittersüß, friedliche Lösung, Scheitern mit zweiter Chance). Die KI wählt passend zum Verlauf
- Die KI darf **keine** Regelwerte ändern, keine Monster erfinden, die es nicht gibt, und keine Hinweise auf eine Wahrheit geben, die nicht ausgewürfelt wurde. Der Host prüft das

`DmResponse` erweitern um:
```json
"reveal_clue": "clue_ei_schatzkammer",
"reveal_twist": false,
"npc_attitude": { "npc": "schwarzer_ritter", "change": -2 },
"trigger_event": "hinterhalt_waldweg",
"choose_ending": null
```

**3. Ohne KI (ScriptedDM)**
- Geheime Wahrheit, Hinweise und Enden funktionieren genauso, nur mit festen Regeln statt KI-Entscheidungen (Twist bei festem Szenen-Index, Ereignis bei Zeitüberschuss, Ende nach einfacher Entscheidungstabelle)

**4. Spannung erzeugen, Regeln für den Erzähler (auch im KI-Prompt)**
- Kurze, bildhafte Sätze. Jede Szene endet mit einer offenen Frage oder Gefahr (Cliffhanger)
- Nicht alles erklären: Geheimnisse andeuten, Spieler selbst kombinieren lassen
- NPCs mit eigener Stimme und eigenen Zielen, nicht nur Auftraggeber
- Gewinnen soll sich verdient anfühlen: Endkampf eher knapp, Tod eines Helden möglich, aber mit Rettungschance (Todesrettungswürfe, Heiltrank, Verbündeter)
- Jeder Spieler bekommt pro Akt mindestens einen Moment im Rampenlicht (die KI bekommt die Info, wer zuletzt wenig dran war)

**5. Geheimnisse einzelner Spieler (optional, ab A8)**
- Die KI kann einem einzelnen Spieler eine **geheime Nachricht** aufs Handy schicken („Du erkennst das Wappen des schwarzen Ritters. Es gehört zu der Familie, die deinen Vater verraten hat.“). Ob er das den anderen erzählt, entscheidet er selbst
- Neues Event: `secret_message` (Host → ein Handy)

### Spieldauer-Einstellung
Auswahl beim Start auf dem TV, zusammen mit der Geschichte:

| Stufe | Dauer (Richtwert) | Umfang |
|---|---|---|
| **Kurz** | ca. 45 Min | nur Pflicht-Szenen, 3–4 Dungeon-Räume, 2 Kämpfe + Endgegner |
| **Mittel** | ca. 90 Min | + einige optionale Szenen, 5–7 Räume, 3–4 Kämpfe |
| **Lang** | ca. 2,5–3 Std | alle Szenen, 8–12 Räume, Nebenquest, Rastpause mit Speicherpunkt |

Umsetzung:
- **Geschichten-Format** (`src/dm/stories/<id>.json`): Akte → Szenen. Jede Szene hat `pflicht: true|false`, `dauer_min`, `mindestDauer` (`kurz|mittel|lang`), Ziel, Ort/Raum-Module, NPCs, Begegnungen, Hinweise, Übergänge
- Beim Start stellt ein **Planer** anhand der gewählten Dauer die Szenenliste zusammen und skaliert Dungeon-Größe und Anzahl der Kämpfe
- **Begegnungen skalieren** auch mit der Spielerzahl (1–6, auf Wunsch des Nutzers von 4 erhöht) nach den SRD-Richtwerten für Schwierigkeit
- **Tempo-Wächter:** Der Host misst die echte Spielzeit. Läuft die Gruppe hinter dem Plan, werden optionale Szenen übersprungen; ist sie schneller, kommen welche dazu. Die KI (A8) bekommt im Kontext `zeit_bisher`, `zeit_ziel`, `verbleibende_szenen` und die Anweisung, das Tempo entsprechend zu steuern
- Dezente **Fortschrittsanzeige** auf dem TV („Kapitel 2 von 3“), keine Uhr, die Druck macht
- „Lang“ bietet nach der Hälfte einen Speicherpunkt an (in Teil A im `localStorage` des TV)

---

## TEIL A – ohne Accounts

Jede Phase endet lauffähig, mit Commit und kurzer Zusammenfassung. **Danach auf mein OK warten.**
Testen: 1 Tab `/#/tv`, 2–4 Tabs `/#/play` in DevTools-Mobile-Emulation.
**Beim Testen kein KI-Guthaben verbrauchen:** Vitest, ferngesteuerte Browser (Playwright, `navigator.webdriver`) und Adressen mit `noai` (z. B. `/#/tv?noai`) haben keine KI – das Spiel läuft auf dem Drehbuch, die Stimme ist die kostenlose Browser-Stimme (`aiBlocked()` in `src/dm/ai/provider.ts`). Nie echte Schlüssel in Tests oder Skripte schreiben.

### A0 – Setup
- Vite + TS + Phaser + Vitest, Ordnerstruktur (unten)
- GitHub Action für Deploy auf GitHub Pages (`base` korrekt setzen)
- README mit Start-Anleitung
- **Fertig, wenn:** `npm run dev` läuft und `npm run build` fehlerfrei ist.

### A1 – Regelwerk & Engine
- Skript `scripts/import-srd.ts`: lädt die benötigten JSON-Dateien aus `5e-bits/5e-database` (`src/2014/en/`) und schreibt eine **reduzierte** Fassung nach `src/data/srd/`
- Teilmenge:
  - **Klassen:** Kämpfer, Ritter (= SRD-Paladin), Magier, Schurke, Kleriker (Stufe 1–3)
  - **Völker:** Mensch, Elf, Zwerg, Halbling
  - **Zauber:** ca. 10 (z. B. Feuerpfeil, Magisches Geschoss, Heilende Hand, Schlaf, Segnen)
  - **Monster:** alle, die die drei Geschichten brauchen (siehe „Geschichten & Spieldauer“), z. B. Oger, junger Roter Drache, Kobold, Wolf, Bandit, Banditenhauptmann, Ritter (als NPC/Gegner), Riesenratte, Rattenschwarm, Goblin, Skelett, Zombie, Ghul, Geist, Werwolf, Grüne Vettel. **Vor dem Import prüfen, dass jedes Monster wirklich im SRD 5.1 enthalten ist**; fehlende durch passende SRD-Monster ersetzen
  - **Ausrüstung:** Standardwaffen und -rüstungen der vier Klassen, Heiltrank
- Deutsche Übersetzung der Teilmenge in `src/data/i18n/de.json`
- Regel-Engine in `src/engine/` (rein, ohne UI-Abhängigkeit):
  - Attribute, Modifikatoren, Übungsbonus, Rettungswürfe, Fertigkeitsproben
  - Angriff gegen RK, Schaden, kritische Treffer, Vor-/Nachteil
  - HP, Bewusstlosigkeit, Todesrettungswürfe (vereinfacht)
  - Initiative, Rundenablauf, Bewegung in Feldern (1 Feld = 1,5 m)
  - vorgefertigte Start-Charaktere pro Klasse
- Seedbarer Zufallsgenerator (für Tests)
- Jede Engine-Berechnung liefert neben dem Ergebnis eine **Aufschlüsselung** (`breakdown: {label, value, glossarKey}[]`), damit das Hilfe-System Würfe erklären kann
- **Glossar** (`glossar.de.json`) für alle Begriffe und Inhalte dieser Phase anlegen
- **Fertig, wenn:** Vitest-Suite grün ist, ein simulierter Kampf in der Konsole mit lesbaren Aufschlüsselungen durchläuft und ein Test sicherstellt, dass jeder in den Daten vorkommende Begriff einen Glossar-Eintrag hat.

### A2 – Lokaler Multiplayer & Lobby
- `LocalTransport` über `BroadcastChannel`
- TV: Raum-Code (4 Zeichen, ohne 0/O/1/I) + großer QR-Code auf die Join-URL
- Handy: Name eingeben, Klasse und Volk wählen, **Figur zusammenbauen** (DCSS-Baukasten: Grundfigur, Haare, Rüstung, Waffe; Live-Vorschau), Farbe wählen, „Bereit“
- TV zeigt beigetretene Spieler mit ihren Figuren live an
- **Fertig, wenn:** 4 Tabs beitreten können und ein Reload den Spieler wieder richtig zuordnet (Player-ID in `localStorage`).

### A3 – Grafik & Spielbrett
- Skript `scripts/import-assets.ts`: holt `Snowdrama/CC0-Dungeon-Pack` (Git-Submodule oder Download) und kopiert **nur benötigte** Tiles nach `public/assets/`, erzeugt einen Texture-Atlas + `tileset.json`
- Vorher die Ordnerstruktur des Packs inspizieren und die passenden Tiles auswählen (Böden, Wände, Türen, Truhen, Fackeln, Monster aus A1, Charakter-Teile)
- Phaser-Szene: Raster-Karte, Kamera passend zu 16:9, ganzzahlige Skalierung
- **Raum-Module:** 15–25 handgebaute Räume als JSON (Tags: `start`, `corridor`, `treasure`, `trap`, `boss`) mit Anschlusspunkten; ein Generator setzt daraus einen Dungeon zusammen. Zuerst die Module für Geschichte 1: Burghof, Thronsaal, Turnierplatz, Brücke, Waldweg, verbranntes Dorf, Höhlenstollen, Drachenhort
- Die DCSS-Tiles haben Burgmauern, Rasen, Wasser, Brücken, Ritterrüstungen, Oger und Drachen: gezielt danach suchen
- **Nebel des Krieges:** Räume erst beim Betreten sichtbar
- **Licht:** Sichtradius um Figuren, flackernde Fackeln (Phaser Light2D oder Overlay-Maske)
- **Fertig, wenn:** Ein zufälliger Dungeon mit Figuren ansprechend auf dem TV aussieht.

### A4 – Handy-Controller & Würfel
- Tabs: **Aktion** | **Charakter** | **Inventar**
- Aktionsleiste: Bewegen, Angreifen, Zauber, Gegenstand, Freie Aktion (Texteingabe, in Teil A nur für ScriptedDM-Schlüsselwörter)
- Bewegung per Tippen auf eine Mini-Karte des aktuellen Raums
- Würfelanimation (d4–d20), Vibration bei eigenem Zug
- Nur der aktive Spieler hat freigeschaltete Aktionen, die anderen sehen „X ist dran“
- Große Buttons, Hochformat, kein Zoom nötig
- **Hilfe-System einbauen:** ?-Button mit Tipp-Modus, Suche, „Was kann ich jetzt tun?“, antippbare Fachbegriffe, Wurf-Aufschlüsselung, Anfängermodus
- Charaktererstellung (aus A2) mit Einsteiger-Erklärungen und Empfehlungen ergänzen
- **Fertig, wenn:** Alle reihum ziehen und würfeln können und jedes Element auf dem Handy über ? erklärt wird.

### A5 – Kampf
- Initiative-Leiste am TV-Rand mit Porträts
- Angriffe, Zauber, Schadenszahlen, Trefferanimationen, Tod von Gegnern
- Gegner-Verhalten per Code (auf nächsten Spieler zugehen, angreifen, bei wenig HP fliehen)
- Großes Würfelergebnis auf dem TV einblenden, mit Aufschlüsselung („14 + 3 + 2 = 19 gegen RK 15 → Treffer“)
- Einmalige Hinweis-Blasen beim ersten Kampf, erster Bewusstlosigkeit, erstem Zauber
- **Fertig, wenn:** Ein Kampf gegen 3 Goblins komplett spielbar ist und jemand ohne Vorwissen jeden Wurf nachvollziehen kann.

### A6 – Geschichten, Dauer & geskripteter Dungeon Master
- `ScriptedDM` implementiert `DungeonMaster` und liefert `DmResponse`
- Geschichten-Format, Planer und Tempo-Wächter umsetzen (siehe „Geschichten & Spieldauer“)
- **Geheime Wahrheit, Hinweise, falsche Fährten, mehrere Enden** und die Seite „Was wirklich geschah“ umsetzen (siehe „Spannung & Twists“); Hinweisliste im Handy-Tab ergänzen
- Test: Für jede Wahrheit gibt es genug Hinweise, und kein Hinweis verrät eine nicht ausgewürfelte Wahrheit
- **Geschichte 1 „Der Drache vom Drachenfels“** vollständig als JSON; sie beginnt mit der **Tutorial-Szene** (siehe Hilfe-System, Punkt 5); der Erzähler erklärt dabei jede neue Mechanik kurz in der Geschichte
- TV-Startbildschirm: **„Wie spielt man das?“** (5 Folien), Auswahl von Geschichte (mit Titelbild aus Tiles, Kurzbeschreibung, „Empfohlen für Einsteiger“) und Spieldauer
- Erzähltext auf dem TV im Textfeld mit Schreibmaschinen-Effekt, optional vorgelesen per `speechSynthesis` (deutsche Stimme, abschaltbar)
- **Fertig, wenn:** Geschichte 1 in allen drei Spieldauern von Anfang bis Ende durchspielbar ist und der Tempo-Wächter bei „Kurz“ tatsächlich optionale Szenen weglässt.

### A7 – Echte Geräte über PeerJS + Deploy
- `PeerTransport` mit PeerJS (TV = Host-Peer, Peer-ID aus Raum-Code abgeleitet; Handys verbinden sich direkt)
- Verbindungsabbrüche erkennen, automatischer Reconnect
- Deploy auf GitHub Pages, QR-Code zeigt auf die Pages-URL
- **Fertig, wenn:** Mit Fernseher/Laptop + echten Handys im selben WLAN über die Pages-URL gespielt werden kann.

### A8 – KI-Dungeon-Master mit Gratis-Key
Ziel: KI-DM **ohne Backend und ohne Kosten**, über den kostenlosen Gemini-Tarif (Google AI Studio).

- **Hybrid, nicht „voll KI“:** Das Abenteuer aus A6 bleibt das Gerüst (Szenen, Ziel, Endgegner). Die KI erzählt frei, spielt NPCs, reagiert auf freie Aktionen, setzt Proben und wählt Raum-Module. Regeln und Zahlen bleiben im Code.
- **Die KI ist Spielleiterin:** Sie trifft alle Entscheidungen aus „Spannung & Twists“, Punkt 2 (Twist-Zeitpunkt, NPC-Verhalten, Ereignisse, Konsequenzen, Ende, geheime Nachrichten). Der System-Prompt enthält die Erzählregeln aus Punkt 4 und die geheime Wahrheit mit der klaren Anweisung, sie nur über Hinweise schrittweise zu enthüllen
- `AiDM` implementiert `DungeonMaster`, **anbieterunabhängig** über einen Adapter:
  ```ts
  interface LlmProvider { complete(req: LlmRequest): Promise<DmResponse> }
  // GeminiProvider (Standard), GroqProvider (Ersatz), ClaudeProvider (später, bezahlt)
  ```
- **Key-Format (Hinweis vom Nutzer):** Gemini-Keys können mit `AQ.` beginnen. **Keine Formatprüfung auf `AIza`** einbauen, der Key wird im Header `x-goog-api-key` gesendet (nicht als URL-Parameter).
- **Key-Handling (Bring your own key):**
  - Einstellungsseite auf dem TV: Anbieter wählen, API-Key einfügen, „Verbindung testen“
  - Key nur im `localStorage` des TV-Geräts, **nie im Repo, nie an Handys schicken**
  - Aufruf direkt aus dem Browser des TV (Gemini unterstützt das)
  - Hinweis in der UI: „Nur auf eigenen Geräten verwenden“
  - **Key-Format:** Google vergibt neue Keys im Format `AQ.…` (ältere: `AIza…`). Keine Präfix-Prüfung einbauen; Key per HTTP-Header `x-goog-api-key` senden, nicht als URL-Parameter
- **Mit den Gratis-Limits haushalten:**
  - Nur **ein** KI-Aufruf pro Spieleraktion, keine Aufrufe für Dinge, die der Code allein kann (Bewegung, Standardangriffe im Kampf)
  - Kampfrunden erzählt der Code mit Textbausteinen; die KI nur bei Kampfbeginn, -ende und besonderen Aktionen
  - Kleiner Kontext: Story-Zusammenfassung + aktueller Raum + Gruppe (Ziel < 3.000 Tokens pro Aufruf)
  - Zähler „KI-Aufrufe heute“ in den TV-Einstellungen
  - Bei Fehler 429 (Limit) oder Timeout: automatisch Fallback auf `ScriptedDM` mit Hinweis „Der Spielleiter macht kurz Pause“, Spiel läuft weiter
- **JSON-Zuverlässigkeit:** Strukturierte Ausgabe (JSON-Schema) des Anbieters nutzen, Antwort validieren (z. B. mit `zod`), bei ungültiger Antwort einmal neu fragen, dann Fallback
- **Qualität prüfen:** Testseite `/#/dm-lab`, auf der man denselben Spielstand an verschiedene Anbieter schickt und die Antworten nebeneinander sieht (Stil auf Deutsch, Tempo, JSON-Fehler)
- Gemini-Modell: das aktuelle kostenlose **Flash**-Modell (Flash-Lite als Ausweichmodell bei Limit); Modellname nicht fest einbauen, sondern in den Einstellungen wählbar, weil Google die Gratis-Modelle regelmäßig wechselt. Vor der Umsetzung in der offiziellen Gemini-API-Doku prüfen, welche Modelle und welches JSON-Schema-Format aktuell gelten
- **Fertig, wenn:** Eine Szene mit freien Aktionen von der KI geleitet wird und ein Limit-Fehler das Spiel nicht stoppt.

### A9 – Geschichten 2 & 3
- **„Der Rattenfänger von Hammelstein“** und **„Walpurgisnacht am Brocken“** vollständig als JSON im selben Format wie Geschichte 1 (siehe „Geschichten & Spieldauer“)
- Neue Mechaniken: Schwärme, Hinweisliste auf dem Handy, Nachtsicht/Dunkelheit
- Neue Raum-Module passend zum Thema (Stadtgassen, Bergstollen, Harzwald, Hexentanzplatz)
- Glossar um alle neuen Begriffe ergänzen
- Jede Geschichte muss **auch ohne KI** (nur `ScriptedDM`) komplett spielbar sein; mit KI wird sie freier und lebendiger
- **Fertig, wenn:** Alle drei Geschichten in allen drei Spieldauern durchspielbar sind.

---

## TEIL B – daheim (braucht Accounts)

### B1 – Supabase als Transport
- Projekt anlegen, Anonymous Sign-in aktivieren
- `SupabaseTransport`: Kanal `room:{CODE}`, Presence + Broadcast
- Tabellen:
  ```
  rooms        (id, code unique, host_user_id, status, created_at)
  players      (id, room_id, user_id, name, class, sheet jsonb)
  game_states  (room_id pk, state jsonb, version int, updated_at)
  event_log    (id, room_id, type, payload jsonb, created_at)
  ```
- RLS: nur Raummitglieder lesen, nur der Host schreibt `game_states`
- `.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (+ `.env.example`), als GitHub-Secrets für den Build
- **Fertig, wenn:** `?net=supabase` genauso funktioniert wie PeerJS.

### B2 – KI-DM auf den Server verlagern
- Edge Function `dm` übernimmt die `LlmProvider`-Aufrufe aus A8, Key als Supabase-Secret statt im Browser
- Anbieter per Secret wählbar: Gemini (gratis) oder Claude (`claude-haiku-4-5`, bezahlt, falls Gemini qualitativ nicht reicht)
- Rate-Limit pro Raum, Timeout, bei Fehler Fallback auf `ScriptedDM`
- Kontext klein halten: Zusammenfassung der Geschichte + aktueller Raum + Gruppe
- Die KI wählt Raum-Module aus A3 statt Karten frei zu erfinden
- Freie Aktionen am Handy jetzt voll nutzbar (optional Spracheingabe)
- **„Frag den Spielleiter“** im ?-Menü: eigener Modus der Edge Function für Regelfragen, bekommt Glossar-Auszug + Spielstand, antwortet kurz und nur an den fragenden Spieler
- **Fertig, wenn:** Eine Szene komplett von der KI geleitet wird.

### B3 – Persistenz & Politur
- Spielstand speichern/fortsetzen, Reconnect über Supabase
- Level-Aufstieg, Beute, Inventar-Verwaltung
- Musik und Soundeffekte (CC0), Partikel, Kamerafahrten
- Optionales Grafik-Upgrade auf 0x72 DungeonTileset II über `tileset.json`

---

## Was ich manuell erledigen muss
- [ ] Leeres GitHub-Repo anlegen und in Claude Code verbinden (Teil A)
- [ ] In den Repo-Einstellungen GitHub Pages auf „GitHub Actions“ stellen (A7)
- [ ] Optional: Kenney-/0x72-Packs herunterladen und in `raw-assets/` hochladen
- [ ] Für A8: kostenlosen Gemini-API-Key in Google AI Studio erstellen (aistudio.google.com, kein Guthaben nötig) und auf dem TV in den Einstellungen einfügen
- [ ] Daheim: Supabase-Projekt anlegen (Teil B); Claude-Guthaben nur, falls Gemini qualitativ nicht reicht

---

## Ordnerstruktur
```
src/
  main.ts            # Routing tv/play, Auswahl von Transport
  shared/            # Typen, Events, Transport- & DM-Interfaces
  net/               # LocalTransport, PeerTransport, SupabaseTransport
  engine/            # Regel-Engine (rein, getestet)
  dm/                # ScriptedDM, AiDM, LlmProvider (Gemini …)
  dm/stories/        # drachenfels.json, rattenfaenger.json, walpurgis.json
  data/srd/          # reduzierte SRD-Daten
  data/i18n/         # deutsche Texte
  data/rooms/        # Raum-Module
  tv/                # Phaser-Szenen, Host-Logik
  play/              # Handy-UI
public/assets/       # ausgewählte Tiles, Atlas, tileset.json
scripts/             # import-srd.ts, import-assets.ts
supabase/            # erst in Teil B
CREDITS.md
```

## Arbeitsregeln für Claude Code
- Phasen der Reihe nach, nach jeder Phase zusammenfassen und auf mein OK warten.
- Nichts aus Teil B vorziehen. Keine Supabase-Abhängigkeit in Teil A.
- Alle Typen und Events zentral in `src/shared/`.
- Engine ohne UI-Abhängigkeiten, mit Vitest getestet.
- Nur Assets mit geprüfter Lizenz verwenden und jede Quelle in `CREDITS.md` eintragen.
- **Jeder neue Begriff im Spiel braucht einen Glossar-Eintrag.** Jede Berechnung liefert eine Aufschlüsselung. Beides wird per Test geprüft.
- Bei jeder UI-Entscheidung fragen: Versteht das jemand, der noch nie ein Rollenspiel gespielt hat?
- Keine Secrets committen.
- TV-Ansicht für 16:9, Text aus 3 m lesbar. Handy-Ansicht mobile-first.
