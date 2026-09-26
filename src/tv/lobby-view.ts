/**
 * TV lobby: big room code, QR code and the players with their figures.
 * Plain DOM (sharp text from 3 m away); the Phaser board starts with the game.
 */
import QRCode from "qrcode";
import { nameOf } from "../engine/names";
import { MAX_PLAYERS, type LobbyPlayer, type LobbyState } from "../shared/lobby";
import { dollCanvas } from "../ui/atlas";
import { h } from "../ui/dom";
import type { GameHost } from "./host";

function playerCard(p: LobbyPlayer | undefined, index: number): HTMLElement {
  if (!p) {
    return h("div", { class: "tv-slot empty" }, h("div", { class: "tv-slot-figure placeholder" }, "?"), h("div", { class: "tv-slot-name" }, `Platz ${index + 1} frei`));
  }
  const prof = p.profile;
  const status = !p.connected ? "📵 Verbindung weg …" : p.ready ? "✅ Bereit" : prof ? "✏️ baut die Figur …" : "📱 wählt noch …";
  return h(
    "div",
    { class: `tv-slot${p.ready ? " ready" : ""}${p.connected ? "" : " offline"}`, style: prof ? `--player:${prof.color}` : "" },
    prof ? dollCanvas(prof.look, 4, "tv-slot-figure") : h("div", { class: "tv-slot-figure placeholder" }, "…"),
    h("div", { class: "tv-slot-name" }, prof?.name ?? "Neuer Spieler"),
    prof ? h("div", { class: "tv-slot-class" }, `${nameOf("classes", prof.classId)} · ${nameOf("races", prof.raceId)}`) : null,
    h("div", { class: "tv-slot-status" }, status),
  );
}

export function renderLobby(root: HTMLElement, host: GameHost, onStart: () => void): () => void {
  const qr = h("img", { class: "tv-qr", alt: "QR-Code zum Beitreten" });
  const url = host.joinUrl();
  void QRCode.toDataURL(url, { margin: 1, scale: 12, errorCorrectionLevel: "M" }).then((data) => (qr.src = data));

  const slots = h("div", { class: "tv-slots" });
  const hint = h("p", { class: "tv-hint" });
  const start = h("button", { class: "tv-start", type: "button", textContent: "▶ Abenteuer starten" });
  start.addEventListener("click", () => {
    if (host.canStart()) onStart();
  });

  const screen = h(
    "main",
    { class: "tv-lobby" },
    h(
      "section",
      { class: "tv-join" },
      h("h1", {}, "Couch-Dungeon"),
      h("p", { class: "tv-lead" }, "Scannt den Code mit dem Handy, um mitzuspielen:"),
      qr,
      h("div", { class: "tv-code-label" }, "oder Code eingeben:"),
      h("div", { class: "tv-code" }, host.lobby.room),
      h("div", { class: "tv-url" }, url),
    ),
    h(
      "section",
      { class: "tv-players" },
      host.lobby.story ? h("p", { class: "tv-story" }, `📖 ${host.lobby.story.title} · ${{ kurz: "Kurz", mittel: "Mittel", lang: "Lang" }[host.lobby.story.duration]}`) : null,
      h("h2", {}, "Eure Heldengruppe"),
      slots,
      hint,
      start,
    ),
  );
  root.append(screen);

  const update = (lobby: LobbyState) => {
    slots.replaceChildren(...Array.from({ length: MAX_PLAYERS }, (_, i) => playerCard(lobby.players[i], i)));
    const active = lobby.players.filter((p) => p.connected);
    const waiting = active.filter((p) => !p.ready).length;
    hint.textContent =
      active.length === 0
        ? `Noch niemand da. 1 bis ${MAX_PLAYERS} Leute können mitspielen.`
        : waiting > 0
          ? `Warte auf ${waiting} ${waiting === 1 ? "Spieler" : "Spieler"} …`
          : "Alle bereit! Los geht's.";
    start.disabled = !host.canStart();
    if (!start.disabled) start.focus();
  };
  const off = host.onChange(update);
  return () => {
    off();
    screen.remove();
  };
}
