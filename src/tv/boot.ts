import { getStory, STORIES } from "../dm/stories";
import type { Route } from "../shared/route";
import type { Duration, Story } from "../shared/story";
import { h } from "../ui/dom";
import { startBoard, type BoardOptions } from "./board";
import { GameHost } from "./host";
import { renderLobby } from "./lobby-view";
import { isSaveGame, readSave } from "./save";
import { cloudLoad, formatCode, newCloudId } from "../net/cloud-save";
import { setSpeechEnabled, speechEnabled } from "./speech";
import { settingsScreen } from "./settings";
import { cloudLoadScreen, howToPlay, pickDuration, pickStory, titleScreen } from "./start-screens";

export function startTv(root: HTMLElement, route: Extract<Route, { view: "tv" }>): () => void {
  document.body.classList.add("is-tv");
  let stopView: (() => void) | undefined;
  let host: GameHost | undefined;
  let closed = false;

  const clear = () => {
    stopView?.();
    stopView = undefined;
  };

  const play = (story: Story | undefined, duration: Duration | undefined, resume?: BoardOptions["resume"], cloud?: BoardOptions["cloud"]) => {
    clear();
    stopView = startBoard(root, host!, {
      demo: route.demo,
      ...(cloud ? { cloud } : {}),
      ...(story && duration ? { story: { story, duration } } : {}),
      ...(resume ? { resume } : {}),
      onExit: () => {
        host!.backToLobby();
        void menu();
      },
    });
  };

  const lobby = (story: Story, duration: Duration) => {
    clear();
    host!.setStory({ id: story.id, title: story.title, duration });
    stopView = renderLobby(root, host!, () => {
      host!.startGame();
      play(story, duration);
    });
  };

  async function menu(): Promise<void> {
    clear();
    for (;;) {
      const save = readSave();
      const choice = await titleScreen(root, { canContinue: !!save, ...(save?.cloud ? { saveCode: formatCode(save.cloud.code) } : {}), speech: speechEnabled(), onSpeech: setSpeechEnabled });
      if (closed) return;
      if (choice === "settings") {
        await settingsScreen(root);
        continue;
      }
      if (closed) return;
      if (choice === "howto") {
        await howToPlay(root);
        continue;
      }
      if (choice === "cloud") {
        const data = await cloudLoadScreen(root, cloudLoad);
        if (closed) return;
        const story = isSaveGame(data) ? getStory(data.state.storyId) : undefined;
        if (!isSaveGame(data) || !story) continue;
        host!.setStory({ id: story.id, title: story.title, duration: data.state.duration });
        host!.restorePlayers(data.players);
        // Another device: this game goes on under a new code.
        play(story, data.state.duration, { state: data.state, heroes: data.heroes }, newCloudId());
        return;
      }
      if (choice === "continue" && save) {
        const story = getStory(save.state.storyId);
        if (story) {
          host!.setStory({ id: story.id, title: story.title, duration: save.state.duration });
          host!.restorePlayers(save.players);
          play(story, save.state.duration, { state: save.state, heroes: save.heroes }, save.cloud);
          return;
        }
      }
      const story = await pickStory(root, STORIES);
      const duration = await pickDuration(root, story);
      lobby(story, duration);
      return;
    }
  }

  void GameHost.start(route.net)
    .then((started) => {
      if (closed) {
        started.transport.close();
        return;
      }
      host = started;
      if (route.demo) {
        // Test mode: four pregenerated heroes, straight to a random dungeon.
        host.useDemoParty();
        play(undefined, undefined);
        return;
      }
      // After a TV reload in the middle of the lobby, go straight back to it.
      const story = host.lobby.story ? getStory(host.lobby.story.id) : undefined;
      if (story && host.lobby.phase === "lobby" && host.lobby.players.length) lobby(story, host.lobby.story!.duration);
      else void menu();
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      const retry = h("button", { class: "tv-btn primary", type: "button", textContent: "🔄 Nochmal versuchen" });
      retry.addEventListener("click", () => location.reload());
      const offline = h("a", { class: "tv-btn", href: "#/tv?net=local", textContent: "💻 Ohne Handys testen (nur dieser Computer)" });
      offline.addEventListener("click", () => setTimeout(() => location.reload()));
      root.append(
        h("main", { class: "tv-screen" }, h("section", { class: "pick" }, h("h1", {}, "Das Spielbrett konnte nicht starten"), h("p", { class: "slide-text" }, msg), h("div", { class: "tv-row" }, retry, offline))),
      );
    });

  return () => {
    closed = true;
    clear();
    host?.transport.close();
    document.body.classList.remove("is-tv");
  };
}
