import { createTransport, type GameTransport } from "../net";
import { nameOf } from "../engine/names";
import type { PlayerAction, SeatOffer } from "../shared/events";
import type { LobbyState } from "../shared/lobby";
import { isValidRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from "../shared/room";
import type { Route } from "../shared/route";
import { h } from "../ui/dom";
import { createController, type Controller } from "./controller";
import { createCharacterView, draftFromProfile, loadDraft, newDraft, profileOf, type CreateView } from "./create";
import { idFromThisTab, newPlayerId, playerId } from "./identity";

export function startPlay(root: HTMLElement, route: Extract<Route, { view: "play" }>): () => void {
  document.body.classList.add("is-phone");
  const shell = h("div", { class: "phone" });
  const banner = h("div", { class: "offline-banner", hidden: true }, "📵 Verbindung zum Fernseher weg … ich versuche es weiter.");
  const content = h("div", { class: "phone-content" });
  shell.append(banner, content);
  root.append(shell);

  let transport: GameTransport | undefined;
  let createView: CreateView | undefined;
  let lobby: LobbyState | undefined;
  let controller: Controller | undefined;
  let choosingSeat = false;

  const show = (...nodes: Node[]) => content.replaceChildren(...nodes);

  function askForCode(error?: string): void {
    const input = h("input", {
      class: "text-input code-input",
      type: "text",
      maxLength: ROOM_CODE_LENGTH,
      placeholder: "ABCD",
      autocomplete: "off",
      attrs: { autocapitalize: "characters", inputmode: "text" },
    });
    const go = h("button", { class: "btn primary big", type: "button", textContent: "Beitreten", disabled: true });
    input.addEventListener("input", () => {
      input.value = normalizeRoomCode(input.value);
      go.disabled = !isValidRoomCode(input.value);
    });
    const submit = () => {
      if (isValidRoomCode(input.value)) location.hash = `#/play?room=${input.value}&net=${route.net}`;
    };
    go.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    show(
      h(
        "main",
        { class: "play" },
        h("h1", {}, "Mitspielen"),
        h("p", {}, "Gib den Code ein, der auf dem Fernseher steht. Noch einfacher: Scanne den QR-Code mit der Kamera."),
        error ? h("p", { class: "error" }, error) : null,
        input,
        go,
      ),
    );
    queueMicrotask(() => input.focus());
  }

  /** The game runs already and this phone is unknown (lost its ID): let it take over an offline hero. */
  function showSeatOffer(t: GameTransport, seats: SeatOffer[]): void {
    const buttons = seats.map((s) => {
      const b = h("button", { class: "btn seat-btn", type: "button" }, h("span", { class: "seat-dot", style: `background:${s.color}` }), `${s.name} (${nameOf("classes", s.classId)})`);
      b.addEventListener("click", () => {
        buttons.forEach((x) => (x.disabled = true));
        t.send({ type: "take_seat", seatId: s.id });
      });
      return b;
    });
    show(
      h(
        "main",
        { class: "play" },
        h("h1", {}, "Wer bist du?"),
        h("p", {}, "Das Abenteuer läuft schon. Diese Helden warten auf ihr Handy – tippe auf deine Figur, dann geht es für dich weiter."),
        h("div", { class: "seat-list" }, ...buttons),
      ),
    );
  }

  function renderLobby(): void {
    if (!transport || !lobby) return;
    const me = transport.player!.id;
    if (lobby.phase === "playing") {
      createView = undefined;
      if (choosingSeat) return;
      if (!controller) {
        const t = transport;
        controller = createController(
          () => t.player!.id,
          (action) => t.send({ type: "player_action", action }),
        );
        show(h("main", { class: "play" }, h("h1", {}, "Das Abenteuer beginnt!"), h("p", {}, "Schau auf den Fernseher. Deine Steuerung erscheint gleich.")));
      }
      return;
    }
    if (!createView) {
      const mine = lobby.players.find((p) => p.id === me);
      const draft = mine?.profile ? draftFromProfile(mine.profile, mine.ready) : (loadDraft() ?? newDraft());
      createView = createCharacterView(draft, (d) => transport?.send({ type: "lobby_profile", profile: profileOf(d), ready: d.ready }));
      show(createView.element);
    }
    createView.update(lobby, me);
  }

  async function connect(room: string): Promise<void> {
    show(h("main", { class: "play" }, h("h1", {}, "Verbinde …"), h("p", {}, `Suche das Spiel ${room} …`)));
    const t = createTransport(route.net, newPlayerId);
    transport = t;
    t.onEvent((e) => {
      if (e.type === "lobby_state") {
        lobby = e.lobby;
        renderLobby();
      } else if (e.type === "seat_offer") {
        choosingSeat = true;
        showSeatOffer(t, e.seats);
      } else if (e.type === "state_update") {
        choosingSeat = false;
        // Test hook for browser play-throughs (dev server only, not in the published build).
        if (import.meta.env.DEV) {
          (window as unknown as { __couchPhone?: unknown }).__couchPhone = {
            view: e.state,
            send: (action: PlayerAction) => t.send({ type: "player_action", action }),
          };
        }
        if (!controller) {
          lobby = lobby ? { ...lobby, phase: "playing" } : lobby;
          renderLobby();
        }
        if (controller && content.firstChild !== controller.element) show(controller.element);
        controller?.setView(e.state);
      } else if (e.type === "request_roll") {
        controller?.requestRoll(e.prompt);
      } else if (e.type === "roll_result") {
        controller?.rollResult(e.result);
      } else if (e.type === "suggestions") {
        controller?.suggestions(e.ideas);
      } else if (e.type === "action_error") {
        controller?.error(e.reason);
      } else if (e.type === "join_rejected") {
        t.close();
        show(h("main", { class: "play" }, h("h1", {}, "Beitreten nicht möglich"), h("p", { class: "error" }, e.reason)));
      }
    });
    t.onConnection?.((connected) => (banner.hidden = connected));
    t.onReplaced?.(() => {
      const again = h("button", { class: "btn primary", type: "button", textContent: "Hier weiterspielen" });
      again.addEventListener("click", () => location.reload());
      show(h("main", { class: "play" }, h("h1", {}, "Das Spiel ist woanders offen"), h("p", {}, "Du hast das Spiel in einem anderen Fenster oder Tab neu geöffnet. Dort geht es weiter – deine Figur ist nicht verloren."), again));
    });
    try {
      // Same tab (reload) or a real phone: this is our seat, take it back even if the TV still sees the old page.
      // Several tabs on one computer (local testing) instead get their own seats.
      const claim = idFromThisTab() || route.net !== "local";
      await t.joinRoom(room, { id: playerId(), name: loadDraft()?.name ?? "" }, { claim });
      // Tell the TV what we already have; it answers with the lobby state.
      const draft = loadDraft();
      t.send({ type: "lobby_profile", profile: draft ? profileOf(draft) : null, ready: draft?.ready ?? false });
    } catch (err) {
      t.close();
      transport = undefined;
      askForCode(err instanceof Error ? err.message : String(err));
    }
  }

  if (route.room && isValidRoomCode(route.room)) void connect(route.room);
  else askForCode(route.room ? "Dieser Code sieht nicht richtig aus." : undefined);

  const onUnload = () => transport?.close();
  window.addEventListener("pagehide", onUnload);
  return () => {
    window.removeEventListener("pagehide", onUnload);
    transport?.close();
    shell.remove();
    document.body.classList.remove("is-phone");
  };
}
