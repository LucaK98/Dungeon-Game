import "./style.css";
import { defaultNet, parseRoute } from "./shared/route";

const app = document.querySelector<HTMLDivElement>("#app")!;
let teardown: (() => void) | undefined;

async function render(): Promise<void> {
  teardown?.();
  teardown = undefined;
  app.replaceChildren();

  const route = parseRoute(location.hash, defaultNet(location.hostname));
  switch (route.view) {
    case "tv": {
      // Phaser is only needed on the board, so phones never download it.
      const { startTv } = await import("./tv/boot");
      teardown = startTv(app, route);
      break;
    }
    case "play": {
      const { startPlay } = await import("./play/boot");
      teardown = startPlay(app, route);
      break;
    }
    case "home":
      renderHome();
      break;
  }
}

function renderHome(): void {
  app.innerHTML = `
    <main class="home">
      <h1>Couch-Dungeon</h1>
      <p>Ein Fantasy-Abenteuer für 1–6 Spieler. Der Fernseher ist das Spielbrett, eure Handys sind die Controller.</p>
      <a class="big-button" href="#/tv">📺 Spielbrett öffnen<small>Auf dem Fernseher oder Laptop</small></a>
      <a class="big-button" href="#/play">📱 Mitspielen<small>Auf dem Handy – oder einfach den QR-Code am Fernseher scannen</small></a>
    </main>`;
}

window.addEventListener("hashchange", () => void render());
void render();
