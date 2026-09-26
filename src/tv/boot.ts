import type { Route } from "../shared/route";
import { h } from "../ui/dom";
import { GameHost } from "./host";
import { renderLobby } from "./lobby-view";

export function startTv(root: HTMLElement, route: Extract<Route, { view: "tv" }>): () => void {
  document.body.classList.add("is-tv");
  let stopView: (() => void) | undefined;
  let host: GameHost | undefined;
  let closed = false;

  const showBoard = async () => {
    stopView?.();
    const { startBoard } = await import("./board");
    stopView = startBoard(root, host!);
  };

  void GameHost.start(route.net).then((started) => {
    if (closed) {
      started.transport.close();
      return;
    }
    host = started;
    if (route.demo) {
      // Test mode: four pregenerated heroes, straight to the board.
      host.useDemoParty();
      void showBoard();
      return;
    }
    if (host.lobby.phase === "playing") void showBoard();
    else
      stopView = renderLobby(root, host, () => {
        host!.startGame();
        void showBoard();
      });
  }).catch((err: unknown) => {
    root.append(h("p", { class: "error" }, `Das Spielbrett konnte nicht starten: ${String(err)}`));
  });

  return () => {
    closed = true;
    stopView?.();
    host?.transport.close();
    document.body.classList.remove("is-tv");
  };
}
