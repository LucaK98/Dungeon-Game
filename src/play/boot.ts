import type { Route } from "../shared/route";

export function startPlay(root: HTMLElement, route: Extract<Route, { view: "play" }>): () => void {
  const main = document.createElement("main");
  main.className = "play";

  const title = document.createElement("h1");
  title.textContent = "Mitspielen";
  const info = document.createElement("p");
  info.textContent = route.room
    ? `Raum ${route.room} gefunden. Das Beitreten kommt im nächsten Schritt.`
    : "Scanne den QR-Code am Fernseher, um einem Spiel beizutreten.";

  main.append(title, info);
  root.append(main);
  return () => main.remove();
}
