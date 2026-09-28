/**
 * The help system on the phone: "?" button, tip mode, glossary sheet, search,
 * "What can I do now?", tappable terms and one-time hint bubbles.
 */
import { allowMotion, loadPrefs, savePrefs, type PhonePrefs } from "./prefs";
import { GLOSSAR, glossarEntry, searchGlossar } from "../data/help/glossar";
import { h } from "../ui/dom";
import type { ExplainedLine, PlayerView } from "../shared/view";

// ---------------------------------------------------------------- bottom sheet

let openSheetEl: HTMLElement | undefined;

export function closeSheet(): void {
  openSheetEl?.remove();
  openSheetEl = undefined;
}

export function showSheet(title: string, ...content: (Node | string | null)[]): HTMLElement {
  closeSheet();
  const close = h("button", { class: "sheet-close", type: "button", textContent: "✕", ariaLabel: "Schließen" });
  close.addEventListener("click", closeSheet);
  const panel = h("div", { class: "sheet", role: "dialog" }, h("div", { class: "sheet-head" }, h("h2", {}, title), close), ...content);
  const backdrop = h("div", { class: "sheet-backdrop" }, panel);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeSheet();
  });
  document.body.append(backdrop);
  openSheetEl = backdrop;
  return panel;
}

/** Glossary entry: short text first, "Mehr" shows the long explanation. */
export function openHelp(key: string, expanded = false): void {
  const e = glossarEntry(key);
  if (!e) return;
  const more = h("div", { class: "help-more", hidden: !expanded }, h("p", {}, e.lang), e.beispiel ? h("p", { class: "help-example" }, `Beispiel: ${e.beispiel}`) : null);
  const moreBtn = h("button", { class: "btn secondary", type: "button", textContent: "Mehr erfahren", hidden: expanded });
  moreBtn.addEventListener("click", () => {
    more.hidden = false;
    moreBtn.hidden = true;
  });
  const links = (e.siehe_auch ?? [])
    .filter((k) => GLOSSAR[k])
    .map((k) => {
      const b = h("button", { class: "chip", type: "button", textContent: GLOSSAR[k]!.titel });
      b.addEventListener("click", () => openHelp(k, true));
      return b;
    });
  showSheet(e.titel, h("p", { class: "help-short" }, e.kurz), moreBtn, more, links.length ? h("div", { class: "chips" }, h("span", { class: "chips-label" }, "Siehe auch:"), ...links) : null);
}

/** Several entries (tapping a roll line). */
export function openHelpList(keys: string[]): void {
  const valid = [...new Set(keys)].filter((k) => GLOSSAR[k]);
  if (valid.length === 1) return openHelp(valid[0]!, true);
  if (!valid.length) return;
  const items = valid.map((k) => {
    const e = GLOSSAR[k]!;
    const b = h("button", { class: "help-item", type: "button" }, h("strong", {}, e.titel), h("span", {}, e.kurz));
    b.addEventListener("click", () => openHelp(k, true));
    return b;
  });
  showSheet("Was bedeutet das?", h("div", { class: "help-list" }, ...items));
}

// ---------------------------------------------------------------- tappable terms

/** Words in texts that point to a glossary entry. */
const ALIASES: Record<string, string[]> = {
  ruestungsklasse: ["RK", "Rüstungsklasse"],
  uebungsbonus: ["Übung", "Übungsbonus"],
  schwierigkeitsgrad: ["SG"],
  trefferpunkte: ["Trefferpunkte", "TP"],
  w20: ["🎲"],
  kritischer_treffer: ["Kritischer Treffer", "kritischen Treffer"],
  vorteil: ["Vorteil"],
  nachteil: ["Nachteil"],
  todesrettungswurf: ["Todesrettungswürfe", "Todesrettungswurf"],
  rettungswurf: ["Rettungswurf"],
  angriffswurf: ["greift"],
  gelegenheitsangriff: ["Gelegenheitsangriff"],
  konzentration: ["Konzentration"],
  resistenz: ["Resistenz"],
  immunitaet: ["immun"],
  schaden: ["Schaden"],
};

function aliasesFor(key: string): string[] {
  const own = ALIASES[key] ?? [];
  const title = GLOSSAR[key]?.titel.replace(/\s*\(.*\)\s*$/, "");
  return title ? [...own, title] : own;
}

/** A line of text where known terms are underlined and tappable; tapping elsewhere lists all terms. */
export function explainedLine(line: ExplainedLine, className = "line"): HTMLElement {
  const el = h("p", { class: className });
  type Hit = { start: number; end: number; key: string };
  const hits: Hit[] = [];
  for (const key of line.glossarKeys) {
    for (const alias of aliasesFor(key)) {
      const at = line.text.indexOf(alias);
      if (at >= 0 && !hits.some((x) => at < x.end && at + alias.length > x.start)) {
        hits.push({ start: at, end: at + alias.length, key });
        break;
      }
    }
  }
  hits.sort((a, b) => a.start - b.start);
  let pos = 0;
  for (const hit of hits) {
    el.append(line.text.slice(pos, hit.start));
    el.append(term(line.text.slice(hit.start, hit.end), hit.key));
    pos = hit.end;
  }
  el.append(line.text.slice(pos));
  if (line.glossarKeys.some((k) => GLOSSAR[k])) {
    el.classList.add("has-help");
    el.addEventListener("click", () => openHelpList(line.glossarKeys));
  }
  return el;
}

export function term(label: string, key: string): HTMLElement {
  const el = h("span", { class: "term", dataset: { help: key } }, label);
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    openHelp(key);
  });
  return el;
}

// ---------------------------------------------------------------- tip mode

let tipMode = false;

function setTipMode(on: boolean): void {
  tipMode = on;
  document.body.classList.toggle("tip-mode", on);
}

document.addEventListener(
  "click",
  (e) => {
    if (!tipMode) return;
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-help]");
    e.preventDefault();
    e.stopPropagation();
    setTipMode(false);
    if (target?.dataset.help) openHelp(target.dataset.help);
  },
  true,
);

// ---------------------------------------------------------------- "?" menu

export interface HelpContext {
  view(): PlayerView | undefined;
  setBeginnerMode(on: boolean): void;
  /** "Frag den Spielleiter" (only in a running game). */
  askRules?(question: string): void;
  /** This phone's settings changed (redraw). */
  onPrefs?(): void;
}

/** The game master's answer to a rules question. */
export function showRulesAnswer(question: string, answer: string): void {
  showSheet("🧙 Der Spielleiter antwortet", h("p", { class: "lead" }, `„${question}“`), h("p", { class: "help-short" }, answer));
}

function askSheet(ask: (q: string) => void): void {
  const input = h("textarea", { class: "text-input", rows: 3, placeholder: "z. B. Kann ich zweimal angreifen? Was bringt Deckung?" }) as HTMLTextAreaElement;
  const go = h("button", { class: "btn primary big", type: "button", textContent: "Fragen" });
  const wait = h("p", { class: "lead" });
  go.addEventListener("click", () => {
    const q = input.value.trim();
    if (!q) return;
    go.disabled = true;
    wait.textContent = "Der Spielleiter blättert im Regelbuch …";
    ask(q);
  });
  showSheet("🧙 Frag den Spielleiter", h("p", { class: "lead" }, "Stell eine Regelfrage. Die Antwort bekommst nur du."), input, go, wait);
  queueMicrotask(() => input.focus());
}

export function helpButton(ctx: HelpContext): HTMLElement {
  const btn = h("button", { class: "help-btn", type: "button", textContent: "?", ariaLabel: "Hilfe" });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (tipMode) {
      setTipMode(false);
      return;
    }
    openMenu(ctx);
  });
  return btn;
}

function openMenu(ctx: HelpContext): void {
  const tip = h("button", { class: "btn primary", type: "button", textContent: "👆 Etwas antippen, um es zu erklären" });
  tip.addEventListener("click", () => {
    closeSheet();
    setTipMode(true);
  });
  const what = h("button", { class: "btn secondary", type: "button", textContent: "💡 Was kann ich jetzt tun?" });
  what.addEventListener("click", () => {
    const view = ctx.view();
    showSheet("Was kann ich jetzt tun?", ...whatCanIDo(view).map((t) => h("p", { class: "help-short" }, t)));
  });
  const search = h("input", { class: "text-input", type: "search", placeholder: "Begriff suchen, z. B. Rüstung" });
  const results = h("div", { class: "help-list" });
  search.addEventListener("input", () => {
    results.replaceChildren(
      ...searchGlossar(search.value, 12).map(({ key, entry }) => {
        const b = h("button", { class: "help-item", type: "button" }, h("strong", {}, entry.titel), h("span", {}, entry.kurz));
        b.addEventListener("click", () => openHelp(key, true));
        return b;
      }),
    );
    if (search.value.trim() && !results.childElementCount) results.append(h("p", { class: "lead" }, "Nichts gefunden. Versuch ein anderes Wort."));
  });
  const view = ctx.view();
  const beginner = h("label", { class: "toggle" }, h("input", { type: "checkbox", checked: view?.beginnerMode ?? true }), h("span", {}, "Anfängermodus: Tipps und Empfehlungen zeigen"));
  beginner.querySelector("input")!.addEventListener("change", (e) => ctx.setBeginnerMode((e.target as HTMLInputElement).checked));
  const askBtn = ctx.askRules ? h("button", { class: "btn secondary", type: "button", textContent: "🧙 Frag den Spielleiter" }) : null;
  askBtn?.addEventListener("click", () => askSheet((q) => ctx.askRules!(q)));
  const how = h("button", { class: "btn secondary", type: "button", textContent: "📖 Wie spielt man das?" });
  how.addEventListener("click", () => showSheet("Wie spielt man das?", ...HOW_TO_PLAY.map((t) => h("p", { class: "help-short" }, t))));
  // This phone: simpler screen, ending the turn by itself, rolling by shaking.
  const prefs = loadPrefs();
  const toggle = (key: keyof PhonePrefs, text: string, before?: () => Promise<boolean>) => {
    const el = h("label", { class: "toggle" }, h("input", { type: "checkbox", checked: prefs[key] }), h("span", {}, text));
    const box = el.querySelector("input")!;
    box.addEventListener("change", async () => {
      if (box.checked && before && !(await before())) box.checked = false;
      prefs[key] = box.checked;
      savePrefs(prefs);
      ctx.onPrefs?.();
    });
    return el;
  };
  const phone = ctx.onPrefs
    ? [
        h("h3", { class: "prefs-title" }, "📱 Dieses Handy"),
        toggle("simple", "Einfache Ansicht: nur die wichtigsten Aktionen (alles andere hinter „Alle Aktionen“)"),
        toggle("autoEnd", "Zug nach meiner Aktion automatisch beenden"),
        toggle("shake", "Würfeln durch Schütteln", allowMotion),
        toggle("autoClose", "Würfelergebnis schließt sich nach ein paar Sekunden selbst"),
      ]
    : [];
  showSheet("Hilfe", tip, what, askBtn, how, h("div", { class: "field" }, search, results), beginner, ...phone);
  queueMicrotask(() => search.blur());
}

const HOW_TO_PLAY = [
  "Ihr seid eine Gruppe von Helden. Jede und jeder steuert eine Figur mit dem Handy, der Fernseher zeigt die Welt.",
  "Ihr seid der Reihe nach dran. In deinem Zug darfst du laufen und eine Aktion machen, z. B. angreifen, zaubern oder dich umsehen.",
  "Ob etwas klappt, entscheidet der 20-seitige Würfel plus deine Boni. Das Spiel rechnet alles aus und erklärt jeden Wurf.",
  "Unterstrichene Wörter kannst du antippen. Und über das ? oben rechts lässt sich alles erklären.",
];

/** 2–4 sentences about the current situation. */
export function whatCanIDo(view: PlayerView | undefined): string[] {
  if (!view) return ["Das Spiel startet gleich. Schau auf den Fernseher."];
  if (!view.turn.mine) {
    return [
      `Gerade ist ${view.turn.activeName} dran.`,
      "Schau auf den Fernseher und überlegt gemeinsam, was sinnvoll ist. Wenn du dran bist, vibriert dein Handy.",
    ];
  }
  if (view.pendingRoll) return [`Du würfelst gerade: ${view.pendingRoll.title}.`, "Tippe auf den Würfel!"];
  const out: string[] = [];
  const fields = Math.floor(view.turn.movementLeftFt / 5);
  const parts: string[] = [];
  if (fields > 0) parts.push(`dich bis zu ${fields} ${fields === 1 ? "Feld" : "Felder"} bewegen`);
  if (view.turn.actions > 0) parts.push("eine Aktion machen, z. B. angreifen oder zaubern");
  out.push(parts.length ? `Du bist dran. Du kannst ${parts.join(" UND ")}.` : "Du hast in diesem Zug alles gemacht. Tippe auf „Zug beenden“.");
  const enemies = view.minimap.creatures.filter((c) => c.enemy && !c.down);
  if (enemies.length) {
    const weak = [...enemies].sort((a, b) => a.health - b.health)[0]!;
    const attack = view.choices.find((c) => c.group === "attack" && c.enabled);
    out.push(attack ? `${attack.targets?.length ?? 0} Gegner sind in Reichweite deiner Waffe.` : "Die Gegner sind noch zu weit weg. Lauf näher heran oder nutze eine Fernkampfwaffe oder einen Zauber.");
    if (weak.health < 0.5) out.push(`Tipp: ${weak.name} hat nur noch wenig Leben.`);
  } else {
    out.push("Kein Gegner in Sicht. Erkunde die Gegend: Tippe auf der Karte auf ein helles Feld. Mit „Umsehen“ findest du versteckte Fallen.");
  }
  const rec = view.choices.find((c) => c.recommended);
  if (rec && view.beginnerMode) out.push(`Empfehlung: ${rec.label}.`);
  return out.slice(0, 4);
}

// ---------------------------------------------------------------- hint bubbles

export type HintId = "first_turn" | "first_roll" | "first_enemy" | "first_damage" | "first_spell" | "first_down" | "first_fight" | "first_prop" | "first_cover" | "first_rough" | "first_fire";

const HINTS: Record<HintId, { title: string; text: string; key: string }> = {
  first_prop: {
    title: "Hier kannst du etwas benutzen!",
    text: "Neben dir steht etwas, mit dem man etwas machen kann: Tische umwerfen, Kisten aufbrechen, Kräuter sammeln, Krüge werfen … Schau unter „Umgebung“.",
    key: "zerschlagen",
  },
  first_cover: {
    title: "Deckung nutzen!",
    text: "Stell dich hinter einen Tisch, eine Kiste, eine Säule oder in einen Busch: Fernangriffe von der anderen Seite treffen dich schlechter (+2 RK). Auf dem Fernseher zeigt ein 🛡️, wer gerade in Deckung steht.",
    key: "deckung",
  },
  first_rough: {
    title: "Schwieriges Gelände",
    text: "Gestreifte Felder auf deiner Karte (Gebüsch, Geröll, Netze, Wasser …) kosten doppelte Bewegung. Manchmal lohnt sich der Umweg.",
    key: "schwieriges_gelaende",
  },
  first_fire: {
    title: "Feuer!",
    text: "Feuer breitet sich auf Brennbares aus und macht 1W6 Schaden, wenn man hineinläuft oder darin steht. Gegner meiden es – ihr könnt ihnen damit den Weg versperren!",
    key: "feuer",
  },
  first_turn: {
    title: "Du bist zum ersten Mal dran!",
    text: "In deinem Zug kannst du laufen (tippe auf ein helles Feld der Karte) UND eine Aktion machen, z. B. „Umsehen“. Wenn du fertig bist, tippe auf „Zug beenden“.",
    key: "zug",
  },
  first_roll: {
    title: "Dein erster Wurf",
    text: "Tippe auf den Würfel. Das Spiel zählt deine Boni dazu und vergleicht mit der Zielzahl. Tippe danach auf die Rechnung, um jeden Teil erklärt zu bekommen.",
    key: "w20",
  },
  first_enemy: {
    title: "Gegner in Sicht!",
    text: "Gegner haben auf deiner Karte einen roten Rand. Um mit einer Nahkampfwaffe anzugreifen, musst du direkt neben dem Gegner stehen. Bögen und viele Zauber reichen weiter.",
    key: "nahkampf",
  },
  first_damage: {
    title: "Autsch!",
    text: "Du hast Trefferpunkte verloren. Fällst du auf 0, wirst du bewusstlos, aber Freunde können dich mit Heilung oder einem Heiltrank wieder aufwecken.",
    key: "trefferpunkte",
  },
  first_spell: {
    title: "Zaubern",
    text: "Zaubertricks kannst du immer wirken. Größere Zauber verbrauchen einen Zauberplatz. Die kommen erst nach einer langen Rast zurück, also gut einteilen!",
    key: "zauberplaetze",
  },
  first_fight: {
    title: "Erster Kampf! So funktioniert eine Runde",
    text: "Alle haben Initiative gewürfelt, die Reihenfolge siehst du oben und am Fernseher. Wer dran ist, darf sich bewegen UND eine Aktion machen, meistens angreifen. Danach sind die anderen dran, auch die Gegner.",
    key: "initiative",
  },
  first_down: {
    title: "Du bist bewusstlos",
    text: "Keine Panik! Zu Beginn deines Zuges würfelst du einen Todesrettungswurf: ab 10 ist es gut. Deine Freunde können dich heilen, dann stehst du sofort wieder auf.",
    key: "todesrettungswurf",
  },
};

function seenHints(playerId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(`couch-dungeon.hints.${playerId}`) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** Shows a hint once per player (beginner mode only). */
export function maybeHint(playerId: string, id: HintId, beginner: boolean, host: HTMLElement): void {
  if (!beginner) return;
  const seen = seenHints(playerId);
  if (seen.has(id) || host.querySelector(".hint")) return;
  seen.add(id);
  try {
    localStorage.setItem(`couch-dungeon.hints.${playerId}`, JSON.stringify([...seen]));
  } catch {
    // ignore
  }
  const hint = HINTS[id];
  const ok = h("button", { class: "btn primary small", type: "button", textContent: "Verstanden" });
  const more = h("button", { class: "btn secondary small", type: "button", textContent: "Mehr dazu" });
  // One calm line at a time; the next tip comes once this one is gone.
  const bubble = h("div", { class: "hint compact", role: "status" }, h("div", { class: "hint-text" }, h("strong", {}, `💡 ${hint.title} `), h("span", {}, hint.text)), h("div", { class: "row" }, more, ok));
  ok.addEventListener("click", () => bubble.remove());
  more.addEventListener("click", () => {
    bubble.remove();
    openHelp(hint.key, true);
  });
  host.prepend(bubble);
}
