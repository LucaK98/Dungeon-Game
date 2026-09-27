/**
 * "Put the game on your home screen": installable as an app (full screen, no browser bar).
 * Android/Chrome offers a real install button, iPhones need Share → "Zum Home-Bildschirm".
 */
import { h } from "./dom";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPrompt | undefined;
const DISMISSED = "couch-dungeon.install-tip";

/** Call once at start: registers the service worker and catches the browser's install offer. */
export function setupInstall(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
  });
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Not installable then, the game works anyway.
    });
  }
}

export function isInstalled(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** A small card with the tip (or nothing if installed already or waved away). */
export function installTip(): HTMLElement | null {
  if (isInstalled()) return null;
  try {
    if (localStorage.getItem(DISMISSED)) return null;
  } catch {
    // no storage: show it
  }
  const close = h("button", { class: "install-close", type: "button", attrs: { "aria-label": "Tipp ausblenden" } }, "✕");
  const how = deferred
    ? h("button", { class: "btn primary", type: "button", textContent: "📲 Jetzt installieren" })
    : h(
        "p",
        { class: "muted small" },
        isIos() ? "Tippe unten auf „Teilen“ ⬆️ und dann auf „Zum Home-Bildschirm“." : "Im Browser-Menü ⋮ auf „Zum Startbildschirm hinzufügen“ tippen.",
      );
  const card = h(
    "div",
    { class: "install-tip" },
    close,
    h("strong", {}, "📲 Couch-Dungeon als App"),
    h("p", { class: "small" }, "Auf den Startbildschirm legen: Vollbild ohne Browserleiste, startet schneller."),
    how,
  );
  const hide = () => {
    card.remove();
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      // ignore
    }
  };
  close.addEventListener("click", hide);
  if (deferred && how instanceof HTMLButtonElement) {
    how.addEventListener("click", () => {
      const d = deferred!;
      deferred = undefined;
      void d.prompt().then(() => d.userChoice).then((c) => c.outcome === "accepted" && hide());
    });
  }
  return card;
}
