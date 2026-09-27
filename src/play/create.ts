/**
 * Character creation on the phone: name → class → people → figure → colour → ready.
 * Every change is sent to the TV right away so the figure appears there live.
 */
import { loadBook, type HeroLegacy } from "../shared/herobook";
import { GLOSSAR } from "../data/help/glossar";
import { BEGINNER_CLASSES, PLAYABLE_CLASSES } from "../engine/creatures";
import { SRD } from "../engine/data";
import { nameOf } from "../engine/names";
import { baseOptions, defaultLook, DOLL_OPTIONS, type DollLook, withAutoParts } from "../shared/doll";
import { cleanName, NAME_MAX_LENGTH, PLAYER_COLORS, type CharacterProfile, type LobbyState } from "../shared/lobby";
import { NAME_IDEAS } from "../shared/names";
import { dollCanvas, drawDoll, loadAtlas } from "../ui/atlas";
import { h } from "../ui/dom";
import { helpButton, openHelp } from "./help";

export interface Draft {
  step: number;
  name: string;
  classId: string;
  raceId: string;
  look: DollLook;
  color: string;
  ready: boolean;
  /** Picked from the hero book: level, gold and equipment come along. */
  legacy?: HeroLegacy;
}

const DRAFT_KEY = "couch-dungeon.draft";
const STEPS = ["Name", "Klasse", "Volk", "Aussehen", "Farbe", "Fertig"] as const;

/** Short facts per class, in beginner words. */
const CLASS_FACTS: Record<string, string[]> = {
  fighter: ["❤️ viele Trefferpunkte", "🛡️ schwere Rüstung", "⚔️ keine Zauber"],
  paladin: ["❤️ viele Trefferpunkte", "🛡️ schwere Rüstung", "✨ heilt und segnet"],
  cleric: ["❤️ mittel", "🛡️ Rüstung und Schild", "✨ heilt die Gruppe"],
  rogue: ["❤️ mittel", "🏹 Bogen und Rapier", "🤫 schleicht und trickst"],
  wizard: ["❤️ wenig Trefferpunkte", "🧥 keine Rüstung", "🔥 starke Zauber"],
};

export function loadDraft(): Draft | undefined {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : undefined;
  } catch {
    return undefined;
  }
}

function saveDraft(d: Draft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    // ignore
  }
}

export function newDraft(): Draft {
  return { step: 0, name: "", classId: "", raceId: "", look: defaultLook("fighter", "human"), color: "", ready: false };
}

export function draftFromProfile(p: CharacterProfile, ready: boolean): Draft {
  return { step: ready ? 5 : 3, name: p.name, classId: p.classId, raceId: p.raceId, look: p.look, color: p.color, ready, ...(p.legacy ? { legacy: p.legacy } : {}) };
}

export function profileOf(d: Draft): CharacterProfile | null {
  if (!cleanName(d.name) || !d.classId || !d.raceId) return null;
  return { name: cleanName(d.name), classId: d.classId, raceId: d.raceId, look: withAutoParts(d.look), color: d.color, ...(d.legacy ? { legacy: d.legacy } : {}) };
}

function cycle<T>(list: T[], current: T, dir: 1 | -1): T {
  const i = list.indexOf(current);
  return list[(i + dir + list.length) % list.length]!;
}

export interface CreateView {
  element: HTMLElement;
  /** The TV sent a new lobby state (colours taken by others, corrected profile). */
  update(lobby: LobbyState, myId: string): void;
}

export function createCharacterView(initial: Draft, send: (d: Draft) => void): CreateView {
  let draft = initial;
  let lobby: LobbyState | undefined;
  let myId = "";
  const root = h("main", { class: "play create" });

  const commit = (patch: Partial<Draft>, rerender = true) => {
    draft = { ...draft, ...patch };
    saveDraft(draft);
    send(draft);
    if (rerender) render();
  };

  const takenColors = () => lobby?.players.filter((p) => p.id !== myId && p.profile).map((p) => p.profile!.color) ?? [];

  function nav(canGoOn: boolean, nextLabel = "Weiter →"): HTMLElement {
    const back = h("button", { class: "btn secondary", type: "button", textContent: "← Zurück", disabled: draft.step === 0 });
    back.addEventListener("click", () => commit({ step: draft.step - 1 }));
    const next = h("button", { class: "btn primary", type: "button", textContent: nextLabel, disabled: !canGoOn });
    next.addEventListener("click", () => commit({ step: draft.step + 1 }));
    return h("nav", { class: "wizard-nav" }, back, next);
  }

  function header(title: string, lead?: string): HTMLElement {
    const dots = STEPS.map((s, i) => h("span", { class: `dot${i === draft.step ? " on" : i < draft.step ? " done" : ""}`, title: s }));
    const help = helpButton({ view: () => undefined, setBeginnerMode: () => undefined });
    return h("header", { class: "wizard-head" }, h("div", { class: "top-row" }, h("div", { class: "dots" }, ...dots), help), h("h1", {}, title), lead ? h("p", { class: "lead" }, lead) : null);
  }

  function stepName(): HTMLElement[] {
    const input = h("input", { class: "text-input", type: "text", value: draft.name, maxLength: NAME_MAX_LENGTH, placeholder: "z. B. Brunhild", autocomplete: "off" });
    const next = nav(!!cleanName(draft.name));
    input.addEventListener("input", () => {
      draft = { ...draft, name: input.value };
      saveDraft(draft);
      (next.querySelector(".primary") as HTMLButtonElement).disabled = !cleanName(input.value);
    });
    input.addEventListener("change", () => commit({ name: input.value }, false));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && cleanName(input.value)) commit({ name: input.value, step: 1 });
    });
    const dice = h("button", { class: "btn secondary", type: "button", textContent: "🎲 Vorschlag" });
    dice.addEventListener("click", () => commit({ name: NAME_IDEAS[Math.floor(Math.random() * NAME_IDEAS.length)]! }));
    const book = loadBook();
    // Heroes from earlier adventures: tap to play them again, with level and equipment.
    const bookSection = book.length
      ? h(
          "section",
          { class: "herobook" },
          h("h2", {}, "📖 Dein Heldenbuch"),
          h("p", { class: "lead" }, "Spiel mit einem bekannten Helden weiter – Stufe, Gold und Ausrüstung kommen mit."),
          ...book.map((saved) => {
            const p = saved.profile;
            const l = saved.legacy;
            const b = h(
              "button",
              { class: "choice herobook-entry", type: "button", style: `--player:${p.color}` },
              dollCanvas(p.look, 2, "doll"),
              h(
                "span",
                { class: "herobook-text" },
                h("strong", {}, p.name),
                h("span", {}, `${nameOf("classes", p.classId)} · Stufe ${l.level} · 💰 ${l.gold}${l.gear.owned.length ? ` · ✨ ${l.gear.owned.length}` : ""}`),
                h("span", { class: "muted" }, l.stories.length ? `Erlebt: ${l.stories.slice(-2).join(", ")}` : ""),
              ),
            );
            b.addEventListener("click", () => commit({ name: p.name, classId: p.classId, raceId: p.raceId, look: p.look, color: p.color, legacy: l, step: 4 }));
            return b;
          }),
          h("p", { class: "muted" }, "… oder oben einen neuen Namen eingeben."),
        )
      : null;
    if (!book.length) queueMicrotask(() => input.focus());
    return [header("Wie heißt deine Figur?", "Deine Figur ist der Held, den du im Spiel steuerst."), h("div", { class: "field" }, input, dice), next, ...(bookSection ? [bookSection] : [])];
  }

  function stepClass(): HTMLElement[] {
    const race = draft.raceId || "human";
    const cards = [...PLAYABLE_CLASSES]
      .sort((a, b) => Number(BEGINNER_CLASSES.includes(b)) - Number(BEGINNER_CLASSES.includes(a)))
      .map((id) => {
        const card = h(
          "button",
          { class: `choice${draft.classId === id ? " selected" : ""}`, type: "button" },
          dollCanvas(defaultLook(id, race), 3, "choice-figure"),
          h(
            "div",
            { class: "choice-text" },
            h("strong", {}, nameOf("classes", id)),
            BEGINNER_CLASSES.includes(id) ? h("span", { class: "badge" }, "Empfohlen für Einsteiger") : null,
            h("span", { class: "choice-kurz" }, GLOSSAR[`klasse:${id}`]?.kurz ?? ""),
            h("span", { class: "facts" }, (CLASS_FACTS[id] ?? []).join(" · ")),
          ),
        );
        const info = h("span", { class: "info", role: "button", ariaLabel: "Mehr erfahren", textContent: "ℹ️" });
        info.addEventListener("click", (e) => {
          e.stopPropagation();
          openHelp(`klasse:${id}`, true);
        });
        card.append(info);
        card.dataset.help = `klasse:${id}`;
        card.addEventListener("click", () => {
          const look = defaultLook(id, race, draft.look.base.endsWith("_2") ? 2 : 1);
          // Another class is another hero: the book's level and gear stay with the old one.
          commit({ classId: id, look: { ...look, hair: draft.look.hair, beard: draft.look.beard } as DollLook, legacy: id === draft.classId ? draft.legacy : undefined });
        });
        return card;
      });
    return [header("Wähle deine Klasse", "Die Klasse ist der „Beruf“ deiner Figur. Unsicher? Nimm Kämpfer oder Ritter."), h("div", { class: "choices" }, ...cards), nav(!!draft.classId)];
  }

  function stepRace(): HTMLElement[] {
    const cards = SRD.races.map((r) => {
      const card = h(
        "button",
        { class: `choice${draft.raceId === r.id ? " selected" : ""}`, type: "button" },
        dollCanvas(defaultLook(draft.classId || "fighter", r.id), 3, "choice-figure"),
        h("div", { class: "choice-text" }, h("strong", {}, nameOf("races", r.id)), h("span", { class: "choice-kurz" }, GLOSSAR[`volk:${r.id}`]?.kurz ?? "")),
      );
      const info = h("span", { class: "info", role: "button", ariaLabel: "Mehr erfahren", textContent: "ℹ️" });
      info.addEventListener("click", (e) => {
        e.stopPropagation();
        openHelp(`volk:${r.id}`, true);
      });
      card.append(info);
      card.dataset.help = `volk:${r.id}`;
      card.addEventListener("click", () => {
        const variant = draft.look.base.endsWith("_2") ? 2 : 1;
        const look = defaultLook(draft.classId || "fighter", r.id, variant);
        commit({ raceId: r.id, look, legacy: r.id === draft.raceId ? draft.legacy : undefined });
      });
      return card;
    });
    return [header("Wähle dein Volk", "Jedes Volk hat kleine Vorteile. Eine falsche Wahl gibt es nicht."), h("div", { class: "choices" }, ...cards), nav(!!draft.raceId)];
  }

  function stepLook(): HTMLElement[] {
    const preview = h("canvas", { class: "look-preview" });
    void loadAtlas().then((atlas) => drawDoll(preview, atlas, draft.look, 6));
    const rows: HTMLElement[] = [];
    const addRow = (label: string, options: { id: string | null; label: string }[], get: () => string | null, set: (id: string | null) => void) => {
      const current = options.find((o) => o.id === get()) ?? options[0]!;
      const value = h("span", { class: "picker-value" }, current.label);
      const move = (dir: 1 | -1) => {
        const next = cycle(options, options.find((o) => o.id === get()) ?? options[0]!, dir);
        set(next.id);
        value.textContent = next.label;
        void loadAtlas().then((atlas) => drawDoll(preview, atlas, draft.look, 6));
      };
      const prev = h("button", { class: "picker-btn", type: "button", textContent: "◀", ariaLabel: `${label} zurück` });
      const nxt = h("button", { class: "picker-btn", type: "button", textContent: "▶", ariaLabel: `${label} weiter` });
      prev.addEventListener("click", () => move(-1));
      nxt.addEventListener("click", () => move(1));
      rows.push(h("div", { class: "picker" }, h("span", { class: "picker-label" }, label), prev, value, nxt));
    };
    const setPart = (layer: keyof DollLook) => (id: string | null) => {
      const look = { ...draft.look };
      if (id) (look as Record<string, string>)[layer] = id;
      else delete (look as Record<string, string | undefined>)[layer];
      commit({ look: withAutoParts(look as DollLook) }, false);
    };
    addRow("Figur", baseOptions(draft.raceId), () => draft.look.base, (id) => commit({ look: { ...draft.look, base: id! } }, false));
    addRow("Haare", DOLL_OPTIONS.hair, () => draft.look.hair ?? null, setPart("hair"));
    addRow("Bart", DOLL_OPTIONS.beard, () => draft.look.beard ?? null, setPart("beard"));
    addRow("Kleidung", DOLL_OPTIONS.body, () => draft.look.body ?? null, setPart("body"));
    addRow("Waffe", DOLL_OPTIONS.weapon, () => draft.look.weapon ?? null, setPart("weapon"));
    addRow("Schild", DOLL_OPTIONS.shield, () => draft.look.shield ?? null, setPart("shield"));
    addRow("Umhang", DOLL_OPTIONS.cloak, () => draft.look.cloak ?? null, setPart("cloak"));
    addRow("Kopf", DOLL_OPTIONS.head, () => draft.look.head ?? null, setPart("head"));

    const random = h("button", { class: "btn secondary", type: "button", textContent: "🎲 Zufällig" });
    random.addEventListener("click", () => {
      const pick = <T,>(l: T[]) => l[Math.floor(Math.random() * l.length)]!;
      const look: Record<string, string> = { base: pick(baseOptions(draft.raceId)).id };
      for (const layer of ["hair", "beard", "body", "cloak", "head"] as const) {
        const id = pick(DOLL_OPTIONS[layer]).id;
        if (id) look[layer] = id;
      }
      commit({ look: withAutoParts({ ...draft.look, ...look, hair: look.hair, beard: look.beard, cloak: look.cloak, head: look.head } as DollLook) });
    });
    const reset = h("button", { class: "btn secondary", type: "button", textContent: "↺ Passend zur Klasse" });
    reset.addEventListener("click", () => commit({ look: defaultLook(draft.classId, draft.raceId, draft.look.base.endsWith("_2") ? 2 : 1) }));
    return [
      header("Bau deine Figur", "So sieht dein Held auf dem Fernseher aus. Das Aussehen ändert nichts an den Regeln."),
      h("div", { class: "look" }, preview, h("div", { class: "row" }, random, reset), ...rows),
      nav(true),
    ];
  }

  function stepColor(): HTMLElement[] {
    const taken = takenColors();
    if (!draft.color || taken.includes(draft.color)) {
      const free = PLAYER_COLORS.find((c) => !taken.includes(c.id));
      if (free) draft = { ...draft, color: free.id };
    }
    const swatches = PLAYER_COLORS.map((c) => {
      const b = h("button", {
        class: `swatch${draft.color === c.id ? " selected" : ""}`,
        type: "button",
        style: `--swatch:${c.id}`,
        disabled: taken.includes(c.id),
        title: taken.includes(c.id) ? `${c.label} (schon vergeben)` : c.label,
      }, h("span", {}, c.label));
      b.addEventListener("click", () => commit({ color: c.id }));
      return b;
    });
    return [header("Wähle deine Farbe", "An dieser Farbe erkennst du deine Figur auf dem Fernseher."), h("div", { class: "swatches" }, ...swatches), nav(!!draft.color)];
  }

  function stepReady(): HTMLElement[] {
    const summary = h(
      "div",
      { class: "summary", style: `--player:${draft.color}` },
      dollCanvas(draft.look, 5, "summary-figure"),
      h("strong", {}, cleanName(draft.name)),
      h("span", {}, `${nameOf("classes", draft.classId)} · ${nameOf("races", draft.raceId)}${draft.legacy ? ` · Stufe ${draft.legacy.level}` : ""}`),
      draft.legacy ? h("span", { class: "muted" }, `📖 Aus dem Heldenbuch: 💰 ${draft.legacy.gold} Gold${draft.legacy.gear.owned.length ? ` · ✨ ${draft.legacy.gear.owned.length} Ausrüstung` : ""}`) : null,
    );
    if (draft.ready) {
      const change = h("button", { class: "btn secondary", type: "button", textContent: "✏️ Doch noch ändern" });
      change.addEventListener("click", () => commit({ ready: false, step: 1 }));
      return [header("Du bist bereit!", "Wenn alle bereit sind, startet das Abenteuer am Fernseher."), summary, h("p", { class: "waiting" }, "⏳ Warte auf die anderen …"), change];
    }
    const ready = h("button", { class: "btn primary big", type: "button", textContent: "✅ Bereit!" });
    ready.addEventListener("click", () => commit({ ready: true }));
    const back = h("button", { class: "btn secondary", type: "button", textContent: "← Zurück" });
    back.addEventListener("click", () => commit({ step: draft.step - 1 }));
    return [header("Alles fertig?", "So sieht deine Figur aus. Tippe auf „Bereit“, wenn es losgehen kann."), summary, ready, back];
  }

  function render(): void {
    const steps = [stepName, stepClass, stepRace, stepLook, stepColor, stepReady];
    // Never show a step whose prerequisites are missing (e.g. after a reload).
    if (draft.step > 0 && !cleanName(draft.name)) draft.step = 0;
    else if (draft.step > 1 && !draft.classId) draft.step = 1;
    else if (draft.step > 2 && !draft.raceId) draft.step = 2;
    root.replaceChildren(...steps[Math.min(draft.step, steps.length - 1)]!());
    window.scrollTo(0, 0);
  }

  render();
  return {
    element: root,
    update(next, id) {
      lobby = next;
      myId = id;
      const mine = next.players.find((p) => p.id === id);
      // The TV may correct our colour; adopt it without losing local typing.
      if (mine?.profile && mine.profile.color !== draft.color && draft.color) {
        draft = { ...draft, color: mine.profile.color };
        saveDraft(draft);
      }
      if (draft.step === 4) render();
    },
  };
}
