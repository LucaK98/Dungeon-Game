/**
 * TV screens before the lobby: title, "How to play" (5 slides), story and length.
 * Big text for the sofa; works with mouse, touch and keyboard (arrow keys + Enter).
 */
import { planScenes } from "../dm/planner";
import type { Duration, Story } from "../shared/story";
import { spriteCanvas } from "../ui/atlas";
import { h } from "../ui/dom";

export interface StartChoice {
  story: Story;
  duration: Duration;
}

const SLIDES: { title: string; text: string; icon: string }[] = [
  { icon: "🏰", title: "Was ist das für ein Spiel?", text: "Ihr erlebt gemeinsam ein Abenteuer als Heldengruppe. Der Fernseher zeigt die Welt, ein Erzähler führt euch durch die Geschichte." },
  { icon: "📱", title: "Wer macht was?", text: "Jede und jeder steuert eine Figur mit dem eigenen Handy. Der Computer rechnet alle Regeln aus. Ihr entscheidet, was eure Helden tun." },
  { icon: "🎲", title: "Was ist der W20?", text: "Ein Würfel mit 20 Seiten. Ob etwas klappt, entscheidet der Wurf plus eure Boni. Jeder Wurf wird auf Handy und Fernseher erklärt." },
  { icon: "🦶", title: "Wie läuft ein Zug?", text: "Ihr seid der Reihe nach dran. In deinem Zug darfst du laufen UND eine Aktion machen: angreifen, zaubern, dich umsehen oder etwas benutzen." },
  { icon: "🏆", title: "Gewonnen oder verloren?", text: "Ihr gewinnt zusammen – oder verliert zusammen. Fällt ein Held, können die anderen ihn wieder aufwecken. Und es gibt immer eine zweite Chance." },
];

/** Keyboard/remote support: arrows move the focus between buttons, Enter clicks. */
function arrowKeys(root: HTMLElement): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    const buttons = [...root.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    if (!buttons.length) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const dir = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
    buttons[(i + dir + buttons.length) % buttons.length]!.focus();
    e.preventDefault();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

function screen(root: HTMLElement, ...children: Node[]): { el: HTMLElement; close: () => void } {
  const el = h("main", { class: "tv-screen" }, ...children);
  root.append(el);
  const off = arrowKeys(el);
  queueMicrotask(() => el.querySelector<HTMLButtonElement>("button.primary, button")?.focus());
  return {
    el,
    close: () => {
      off();
      el.remove();
    },
  };
}

export function howToPlay(root: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const icon = h("div", { class: "slide-icon" });
    const title = h("h1", {});
    const text = h("p", { class: "slide-text" });
    const dots = h("div", { class: "slide-dots" });
    const back = h("button", { class: "tv-btn", type: "button", textContent: "◀ Zurück" });
    const next = h("button", { class: "tv-btn primary", type: "button" });
    const s = screen(root, h("section", { class: "slide" }, icon, title, text, dots, h("div", { class: "tv-row" }, back, next)));
    const render = () => {
      const slide = SLIDES[i]!;
      icon.textContent = slide.icon;
      title.textContent = slide.title;
      text.textContent = slide.text;
      dots.replaceChildren(...SLIDES.map((_, k) => h("span", { class: `dot${k === i ? " on" : ""}` })));
      back.disabled = i === 0;
      next.textContent = i === SLIDES.length - 1 ? "Los geht's! ▶" : "Weiter ▶";
      next.focus();
    };
    back.addEventListener("click", () => {
      i = Math.max(0, i - 1);
      render();
    });
    next.addEventListener("click", () => {
      if (i === SLIDES.length - 1) {
        s.close();
        resolve();
      } else {
        i++;
        render();
      }
    });
    render();
  });
}

export interface TitleOptions {
  canContinue: boolean;
  speech: boolean;
  onSpeech: (on: boolean) => void;
}

export function titleScreen(root: HTMLElement, opts: TitleOptions): Promise<"new" | "continue" | "howto" | "settings"> {
  return new Promise((resolve) => {
    const newGame = h("button", { class: "tv-btn primary big", type: "button", textContent: "▶ Neues Abenteuer" });
    const howto = h("button", { class: "tv-btn", type: "button", textContent: "❓ Wie spielt man das?" });
    const cont = h("button", { class: "tv-btn", type: "button", textContent: "💾 Gespeichertes Spiel fortsetzen", hidden: !opts.canContinue });
    const speech = h("button", { class: "tv-btn small", type: "button" });
    const settings = h("button", { class: "tv-btn small", type: "button", textContent: "⚙️ Einstellungen" });
    let speechOn = opts.speech;
    const renderSpeech = () => (speech.textContent = speechOn ? "🔊 Vorlesen: an" : "🔈 Vorlesen: aus");
    renderSpeech();
    speech.addEventListener("click", () => {
      speechOn = !speechOn;
      opts.onSpeech(speechOn);
      renderSpeech();
    });
    const art = h("div", { class: "title-art" }, spriteCanvas("monster.red-dragon-wyrmling", 8, "title-dragon"));
    const s = screen(
      root,
      h(
        "section",
        { class: "title" },
        art,
        h("h1", { class: "title-name" }, "Couch-Dungeon"),
        h("p", { class: "title-sub" }, "Ein Abenteuer für 1–6 Helden · Fernseher + Handys"),
        h("div", { class: "tv-col" }, newGame, howto, cont),
        h("div", { class: "tv-row" }, speech, settings),
        h("p", { class: "credits" }, "5E compatible · enthält Material aus dem SRD 5.1 (CC-BY-4.0) · Grafik: Dungeon Crawl Stone Soup (CC0)"),
      ),
    );
    const done = (v: "new" | "continue" | "howto" | "settings") => {
      s.close();
      resolve(v);
    };
    newGame.addEventListener("click", () => done("new"));
    howto.addEventListener("click", () => done("howto"));
    cont.addEventListener("click", () => done("continue"));
    settings.addEventListener("click", () => done("settings"));
  });
}

export function pickStory(root: HTMLElement, stories: Story[]): Promise<Story> {
  return new Promise((resolve) => {
    const cards = stories.map((story) => {
      const b = h(
        "button",
        { class: "story-card", type: "button" },
        h("div", { class: "story-cover" }, ...story.cover.map((f) => spriteCanvas(f, 4, "cover-tile"))),
        h("h2", {}, story.title),
        h("p", { class: "story-sub" }, story.subtitle),
        story.recommended ? h("span", { class: "badge" }, "Empfohlen für Einsteiger") : null,
        h("p", {}, story.description),
      );
      b.addEventListener("click", () => {
        s.close();
        resolve(story);
      });
      return b;
    });
    const soon = h("div", { class: "story-card soon" }, h("h2", {}, "Weitere Geschichten"), h("p", {}, "„Der Rattenfänger von Hammelstein“ und „Walpurgisnacht am Brocken“ folgen bald."));
    const s = screen(root, h("section", { class: "pick" }, h("h1", {}, "Welche Geschichte wollt ihr erleben?"), h("div", { class: "story-grid" }, ...cards, stories.length < 3 ? soon : "")));
  });
}

const DURATION_INFO: Record<Duration, { label: string; time: string; text: string }> = {
  kurz: { label: "Kurz", time: "ca. 45 Minuten", text: "Nur das Wichtigste: wenige Räume, zwei Kämpfe und der Endgegner." },
  mittel: { label: "Mittel", time: "ca. 90 Minuten", text: "Mit einigen Nebenschauplätzen und mehr Kämpfen." },
  lang: { label: "Lang", time: "ca. 2,5–3 Stunden", text: "Alles, was die Geschichte hergibt – mit Speicherpunkt zur Halbzeit." },
};

export function pickDuration(root: HTMLElement, story: Story): Promise<Duration> {
  return new Promise((resolve) => {
    const cards = (["kurz", "mittel", "lang"] as Duration[]).map((d) => {
      const scenes = planScenes(story, d).length;
      const b = h(
        "button",
        { class: "duration-card", type: "button" },
        h("h2", {}, DURATION_INFO[d].label),
        h("p", { class: "duration-min" }, DURATION_INFO[d].time),
        h("p", {}, DURATION_INFO[d].text),
        h("p", { class: "muted" }, `${scenes} Szenen`),
      );
      b.addEventListener("click", () => {
        s.close();
        resolve(d);
      });
      return b;
    });
    const s = screen(root, h("section", { class: "pick" }, h("h1", {}, `${story.title}: Wie lange wollt ihr spielen?`), h("div", { class: "duration-grid" }, ...cards)));
  });
}
