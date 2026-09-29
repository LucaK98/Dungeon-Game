/**
 * TV screens before the lobby: title, "How to play" (5 slides), story and length.
 * Big text for the sofa; works with mouse, touch and keyboard (arrow keys + Enter).
 */
import { loadNpcWorld } from "./npc-store";
import { STAGE_LABEL, stageOf } from "../dm/npc-world";
import { newRandomStory } from "../dm/stories/random";
import { DIFFICULTIES, DIFFICULTY, type Difficulty } from "../shared/difficulty";
import { musicEnabled, setMusicEnabled } from "../ui/music";
import { play, setSoundEnabled, soundEnabled } from "../ui/sound";
import { planScenes } from "../dm/planner";
import type { Duration, Story } from "../shared/story";
import { spriteCanvas } from "../ui/atlas";
import { h } from "../ui/dom";
import { BUILDINGS, build } from "../shared/homeland";
import { loadSaga, loadVillage, saveVillage } from "./homeland-store";

export interface StartChoice {
  story: Story;
  duration: Duration;
}

const SLIDES: { title: string; text: string; icon: string }[] = [
  { icon: "🏰", title: "Was ist das für ein Spiel?", text: "Ihr erlebt gemeinsam ein Abenteuer als Heldengruppe. Der Fernseher zeigt die Welt, ein Erzähler führt euch durch die Geschichte." },
  { icon: "📱", title: "Wer macht was?", text: "Jede und jeder steuert eine Figur mit dem eigenen Handy. Der Computer rechnet alle Regeln aus. Ihr entscheidet, was eure Helden tun." },
  { icon: "🎲", title: "Was ist der W20?", text: "Ein Würfel mit 20 Seiten. Ob etwas klappt, entscheidet der Wurf plus eure Boni. Jeder Wurf wird auf Handy und Fernseher erklärt." },
  { icon: "🦶", title: "Wer ist wann dran?", text: "Beim Erkunden alle gleichzeitig: Lauft los, schaut euch um, redet mit Leuten. Im Kampf seid ihr der Reihe nach dran und dürft laufen UND eine Aktion machen: angreifen, zaubern oder etwas benutzen." },
  { icon: "✨", title: "Die Welt lebt", text: "Unterwegs passiert etwas: Händler, Fallen, Geheimnisse. Dann erscheint eine Entscheidung auf allen Handys. Fässer, Hebel und Kronleuchter könnt ihr benutzen, schlafende Gegner überraschen – und mit „Freie Aktion“ alles andere versuchen." },
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
  /** Save code of the local save (shown on the continue button). */
  saveCode?: string;
  speech: boolean;
  onSpeech: (on: boolean) => void;
}

export function titleScreen(root: HTMLElement, opts: TitleOptions): Promise<"new" | "continue" | "howto" | "settings" | "cloud" | "village"> {
  return new Promise((resolve) => {
    const newGame = h("button", { class: "tv-btn primary big", type: "button", textContent: "▶ Neues Abenteuer" });
    const howto = h("button", { class: "tv-btn", type: "button", textContent: "❓ Wie spielt man das?" });
    const home = h("button", { class: "tv-btn", type: "button", textContent: "🏘️ Heimatdorf & Heldensaga" });
    const cont = h("button", { class: "tv-btn", type: "button", textContent: `💾 Gespeichertes Spiel fortsetzen${opts.saveCode ? ` (Code ${opts.saveCode})` : ""}`, hidden: !opts.canContinue });
    const cloud = h("button", { class: "tv-btn small", type: "button", textContent: "☁️ Spielstand-Code eingeben" });
    const speech = h("button", { class: "tv-btn small", type: "button" });
    const settings = h("button", { class: "tv-btn small", type: "button", textContent: "⚙️ Einstellungen" });
    const sound = h("button", { class: "tv-btn small", type: "button" });
    const music = h("button", { class: "tv-btn small", type: "button" });
    const renderMusic = () => (music.textContent = musicEnabled() ? "🎼 Musik: an" : "🎼 Musik: aus");
    renderMusic();
    music.addEventListener("click", () => {
      setMusicEnabled(!musicEnabled());
      renderMusic();
    });
    const renderSound = () => (sound.textContent = soundEnabled() ? "🎵 Geräusche: an" : "🔇 Geräusche: aus");
    renderSound();
    sound.addEventListener("click", () => {
      setSoundEnabled(!soundEnabled());
      renderSound();
      play("chime");
    });
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
        h("div", { class: "tv-col" }, newGame, cont, home, howto, cloud),
        h("div", { class: "tv-row" }, speech, sound, music, settings),
        h("p", { class: "credits" }, "5E compatible · enthält Material aus dem SRD 5.1 (CC-BY-4.0) · Grafik: Dungeon Crawl Stone Soup (CC0)"),
      ),
    );
    const done = (v: "new" | "continue" | "howto" | "settings" | "cloud" | "village") => {
      s.close();
      resolve(v);
    };
    newGame.addEventListener("click", () => done("new"));
    howto.addEventListener("click", () => done("howto"));
    home.addEventListener("click", () => done("village"));
    cont.addEventListener("click", () => done("continue"));
    cloud.addEventListener("click", () => done("cloud"));
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
    // A new random adventure every time (quest, place, villain and twist are rolled).
    const random = h(
      "button",
      { class: "story-card random-card", type: "button" },
      h("div", { class: "story-cover random-dice" }, "🎲"),
      h("h2", {}, "Zufallsabenteuer"),
      h("p", { class: "story-sub" }, "ca. 30 Minuten · jedes Mal anders"),
      h("p", {}, "Auftrag, Ort, Schurke und Wendung werden ausgewürfelt. Für Gruppen, die alle Geschichten schon kennen."),
    );
    random.addEventListener("click", () => {
      s.close();
      resolve(newRandomStory());
    });
    const s = screen(root, h("section", { class: "pick" }, h("h1", {}, "Welche Geschichte wollt ihr erleben?"), h("div", { class: "story-grid" }, ...cards, random)));
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

export function pickDifficulty(root: HTMLElement): Promise<Difficulty> {
  return new Promise((resolve) => {
    const cards = DIFFICULTIES.map((d) => {
      const rules = DIFFICULTY[d];
      const b = h(
        "button",
        { class: `duration-card difficulty-card difficulty-${d}`, type: "button" },
        h("div", { class: "difficulty-icon" }, rules.icon),
        h("h2", {}, rules.label),
        d === "normal" ? h("span", { class: "badge" }, "Empfohlen") : null,
        h("p", {}, rules.text),
        h("ul", { class: "difficulty-points" }, ...rules.points.map((p) => h("li", {}, p))),
      );
      b.addEventListener("click", () => {
        s.close();
        resolve(d);
      });
      return b;
    });
    const s = screen(
      root,
      h(
        "section",
        { class: "pick" },
        h("h1", {}, "Wie schwer soll es werden?"),
        h("p", { class: "slide-text" }, "🎲 Gewürfelt wird immer ehrlich wie mit einem echten Würfel – nur die Welt wird leichter oder härter."),
        h("div", { class: "duration-grid difficulty-grid" }, ...cards),
      ),
    );
    // "Normal" is chosen when you just press Enter.
    setTimeout(() => cards[DIFFICULTIES.indexOf("normal")]?.focus(), 0);
  });
}

/** Enter a save code from another device; resolves with the loaded save (or undefined = back). */
export function cloudLoadScreen(root: HTMLElement, load: (code: string) => Promise<unknown | undefined>): Promise<unknown | undefined> {
  return new Promise((resolve) => {
    const input = h("input", { class: "settings-input code-input", type: "text", autocomplete: "off", spellcheck: false, placeholder: "ABCD-2345", maxLength: 9 }) as HTMLInputElement;
    const status = h("p", { class: "settings-status" });
    const go = h("button", { class: "tv-btn primary", type: "button", textContent: "☁️ Laden" });
    const back = h("button", { class: "tv-btn", type: "button", textContent: "← Zurück" });
    const s = screen(
      root,
      h(
        "section",
        { class: "pick" },
        h("h1", {}, "☁️ Spielstand laden"),
        h("p", { class: "slide-text" }, "Gebt den Code ein, den der andere Fernseher oder Laptop beim Speichern angezeigt hat."),
        input,
        h("div", { class: "tv-row" }, go, back),
        status,
      ),
    );
    const finish = (v: unknown | undefined) => {
      s.close();
      resolve(v);
    };
    const tryLoad = async () => {
      go.disabled = true;
      status.textContent = "Suche den Spielstand …";
      const data = await load(input.value);
      go.disabled = false;
      if (data) finish(data);
      else status.textContent = "❌ Kein Spielstand mit diesem Code gefunden (oder keine Internetverbindung).";
    };
    go.addEventListener("click", () => void tryLoad());
    input.addEventListener("keydown", (e) => e.key === "Enter" && void tryLoad());
    back.addEventListener("click", () => finish(undefined));
    setTimeout(() => input.focus(), 50);
  });
}

const KIND_ICON: Record<string, string> = { sieg: "🏆", friedlich: "🕊️", bittersuess: "🥀", scheitern: "💫" };

/** The home village (build with the village's gold) and the saga of past adventures. */
/** Married couples: the partners live in the home village. */
function familySection(): HTMLElement[] {
  const world = loadNpcWorld();
  const minds = Object.values(world.npcs).filter((m) => m.spouse || m.engaged || m.widowOf || m.children?.length);
  if (!minds.length) return [];
  const clock = world.clock ?? 0;
  const line = (m: (typeof minds)[number]) => {
    const tie = m.spouse ? `💍 verheiratet mit ${m.spouse}` : m.engaged ? `💌 verlobt mit ${m.engaged}, die Hochzeit steht bevor` : m.widowOf ? `🕯️ trauert um ${m.widowOf}` : "";
    const kids = (m.children ?? []).map((c) => `${c.name} (${STAGE_LABEL[stageOf(c, clock)]}${c.squire && stageOf(c, clock) === "jugend" ? ", Knappe" : ""})`);
    return h("p", { class: "saga-entry" }, h("strong", {}, m.name), ` – ${[tie, m.expecting?.announced ? "🍼 erwartet ein Kind" : "", kids.length ? `👨‍👩‍👧 Kinder: ${kids.join(", ")}` : ""].filter(Boolean).join(" · ")}`);
  };
  return [h("h2", {}, "💞 Familien im Dorf"), h("div", { class: "saga" }, ...minds.map(line))];
}

export function villageScreen(root: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const s = screen(root);
    const render = () => {
      const v = loadVillage();
      const saga = loadSaga();
      const back = h("button", { class: "tv-btn primary", type: "button", textContent: "◀ Zurück" });
      back.addEventListener("click", () => {
        s.close();
        resolve();
      });
      const cards = BUILDINGS.map((b) => {
        const built = v.built.includes(b.id);
        const btn = h("button", { class: `tv-btn small${built ? "" : v.gold >= b.price ? " primary" : ""}`, type: "button", textContent: built ? "✅ Gebaut" : `Bauen (${b.price} 💰)`, disabled: built || v.gold < b.price });
        btn.addEventListener("click", () => {
          const village = loadVillage();
          if (!build(village, b.id)) {
            saveVillage(village);
            play("chime");
            render();
          }
        });
        return h("div", { class: `building${built ? " built" : ""}` }, h("span", { class: "building-icon" }, b.icon), h("strong", {}, b.name), h("p", {}, b.text), btn);
      });
      const entries = [...saga.entries].reverse().slice(0, 8);
      s.el.replaceChildren(
        h(
          "section",
          { class: "pick village" },
          h("h1", {}, "🏘️ Euer Heimatdorf"),
          h("p", { class: "slide-text" }, `Dorfkasse: 💰 ${v.gold} Gold. Nach jedem Abenteuer bringt ihr Gold nach Hause (mehr, wenn ihr gewinnt). Gebäude helfen euch in allen künftigen Abenteuern.`),
          h("div", { class: "buildings" }, ...cards),
          ...familySection(),
          h("h2", {}, "📜 Eure Heldensaga"),
          entries.length
            ? h(
                "div",
                { class: "saga" },
                ...entries.map((e) =>
                  h(
                    "p",
                    { class: "saga-entry" },
                    `${KIND_ICON[e.kind] ?? "📖"} `,
                    h("strong", {}, e.title),
                    ` – ${e.endingTitle}${e.heroes.length ? ` · ${e.heroes.join(", ")}` : ""}`,
                    e.ally && !e.allyDone ? h("span", { class: "saga-tag good" }, `🤝 ${e.ally.name}`) : "",
                    e.nemesis && !e.nemesisDone ? h("span", { class: "saga-tag bad" }, `🗡️ ${e.nemesis.name}`) : "",
                  ),
                ),
              )
            : h("p", { class: "muted" }, "Noch leer – euer erstes Abenteuer wartet! Freunde, die ihr gewinnt, und Feinde, die entkommen, tauchen später wieder auf."),
          h("div", { class: "tv-row" }, back),
        ),
      );
      queueMicrotask(() => s.el.querySelector<HTMLButtonElement>("button.primary, button")?.focus());
    };
    render();
  });
}
