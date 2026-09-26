import { createTransport, type GameTransport } from "../net";
import type { LobbyState } from "../shared/lobby";
import { isValidRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from "../shared/room";
import type { Route } from "../shared/route";
import { h } from "../ui/dom";
import { createCharacterView, draftFromProfile, loadDraft, newDraft, profileOf, type CreateView } from "./create";
import { newPlayerId, playerId } from "./identity";

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
      if (isValidRoomCode(input.value)) location.hash = `#/play?room=${input.value}${route.net === "local" ? "" : `&net=${route.net}`}`;
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

  function renderLobby(): void {
    if (!transport || !lobby) return;
    const me = transport.player!.id;
    if (lobby.phase === "playing") {
      createView = undefined;
      show(h("main", { class: "play" }, h("h1", {}, "Das Abenteuer beginnt!"), h("p", {}, "Schau auf den Fernseher. Die Steuerung für deine Figur erscheint hier gleich.")));
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
      } else if (e.type === "join_rejected") {
        t.close();
        show(h("main", { class: "play" }, h("h1", {}, "Beitreten nicht möglich"), h("p", { class: "error" }, e.reason)));
      }
    });
    t.onConnection?.((connected) => (banner.hidden = connected));
    try {
      await t.joinRoom(room, { id: playerId(), name: loadDraft()?.name ?? "" });
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
