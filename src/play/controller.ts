/**
 * The phone as game controller: turn status, map, actions, character sheet and inventory.
 */
import { getGear } from "../data/gear";
import type { Recap } from "../shared/recap";
import type { Reward } from "../shared/reward";
import { BADGES, badgeById } from "../shared/achievements";
import { play } from "../ui/sound";
import { shareRecap } from "../ui/recap-image";
import { abilityMod, saveParts, skillParts, sumParts } from "../engine/core";
import { SRD } from "../engine/data";
import { abilityName, nameOf } from "../engine/names";
import { armorClass } from "../engine/combat";
import { EMOTES, type PlayerAction } from "../shared/events";
import type { Creature } from "../shared/game";
import { ABILITIES } from "../shared/rules";
import type { ActionChoice, ActionGroup, CampView, MiniCreature, PlayerView, RollOutcome, RollPrompt } from "../shared/view";
import { matchFreeText, matchUtility } from "../shared/intent-match";
import { walkIntent } from "../shared/walk-text";
import { isTrick } from "../dm/free-actions";
import { loadPrefs } from "./prefs";
import { dollCanvas } from "../ui/atlas";
import { h } from "../ui/dom";
import { showRollPrompt, type DiceOverlay } from "./dice";
import { closeSheet, explainedLine, helpButton, maybeHint, openHelp, showRulesAnswer, showSheet } from "./help";
import { minimapLegend, minimapView, onHold, planRoute, provokedBy } from "./minimap";
import type { GridPos } from "../shared/game";
import { canCraft, RECIPES } from "../shared/crafting";
import { itemIcon } from "../shared/reward";
import { ABILITY_GLOSSAR } from "../engine/core";

const ABILITY_ICON: Record<string, string> = { STR: "💪", DEX: "🤸", CON: "🫀", INT: "🧠", WIS: "🦉", CHA: "🗣️" };

type Tab = "action" | "sheet" | "inventory" | "clues";

const GROUP_TITLES: Record<ActionGroup, string> = {
  story: "📖 Entscheidung",
  attack: "⚔️ Angreifen",
  spell: "✨ Zaubern",
  item: "🎒 Gegenstände",
  ability: "💪 Fähigkeiten",
  look: "👀 Umgebung",
  free: "",
  end: "",
};

export interface Controller {
  element: HTMLElement;
  setView(view: PlayerView): void;
  requestRoll(prompt: RollPrompt): void;
  rollResult(result: RollOutcome): void;
  /** A free action could mean several things: „Meinst du …?“ */
  freeTextOptions(text: string, options: { label: string; detail: string; action: PlayerAction }[], note?: string): void;
  error(reason: string): void;
  /** Ideas from the game master for the free-action sheet. */
  suggestions(ideas: string[]): void;
  /** Answer to "Frag den Spielleiter". */
  rulesAnswer(question: string, answer: string): void;
  /** The look back at the end: own highlights first, then the group's. */
  recap(recap: Recap): void;
  /** This hero gained something: a level, equipment, gold or an item. */
  reward(reward: Reward): void;
  /** A private message for this phone (e.g. "secret goal reached"). */
  secret(text: string): void;
}

/** Browser speech recognition (Chrome/Safari/Edge), if available. */
type SpeechRec = { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start(): void; stop(): void };
/** "🎤 Sprechen": dictate into a text field (if the browser can). */
function micButton(input: HTMLInputElement | HTMLTextAreaElement): HTMLButtonElement | undefined {
  const Rec = speechRecognition();
  if (!Rec) return undefined;
  const mic = h("button", { class: "btn secondary", type: "button", textContent: "🎤 Sprechen" });
  let rec: SpeechRec | undefined;
  mic.addEventListener("click", () => {
    if (rec) {
      rec.stop();
      return;
    }
    rec = new Rec();
    rec.lang = "de-DE";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = Array.from(e.results).map((r) => r[0]?.transcript ?? "").join(" ").trim();
      if (said) input.value = input.value ? `${input.value} ${said}` : said;
      input.dispatchEvent(new Event("input"));
    };
    const done = () => {
      rec = undefined;
      mic.textContent = "🎤 Sprechen";
      mic.classList.remove("recording");
    };
    rec.onend = done;
    rec.onerror = done;
    mic.textContent = "⏹ Fertig";
    mic.classList.add("recording");
    rec.start();
  });
  return mic;
}

function speechRecognition(): (new () => SpeechRec) | undefined {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** The chance to hit in words, with a colour. */
function oddsBadge(chance: number): HTMLElement {
  const pct = Math.round(chance * 100);
  const [cls, text] = chance >= 0.65 ? ["good", "🎯 gute Chance"] : chance >= 0.4 ? ["mid", "⚖️ 50 : 50"] : ["low", "😬 schwierig"];
  return h("span", { class: `odds ${cls}`, dataset: { help: "angriffswurf" } }, `${text} (${pct} %)`);
}

/** What the game will make of a free text (same rules as the TV), in one short line. */
function previewFreeText(raw: string, v: PlayerView): string {
  const text = raw.trim();
  if (text.length < 4) return "";
  const t = text.toLowerCase();
  const parts: string[] = [];
  if (v.companion && !v.companion.dead && (t.includes(v.companion.name.toLowerCase().split(" ")[0]!) || t.includes(v.companion.kind.toLowerCase())) && /\b(fass|greif|hol|beiß|beiss|hack|los|kratz|jag|attack|pack|stürz)/.test(t)) {
    return `${v.companion.icon} Befehl an ${v.companion.name} (kostet nichts)`;
  }
  if (/\b(brau|misch|mix|bastel|koch|knüpf)/.test(t)) {
    const r = RECIPES.find((x) => t.includes(x.name.toLowerCase()) || t.includes(x.id));
    if (r) return `${r.icon} ${r.name} brauen`;
  }
  const walk = walkIntent(text);
  if (walk) {
    parts.push(`🦶 zu „${walk.target}“ gehen`);
    if (!walk.rest) return parts.join("");
  }
  const found = matchUtility(text, v.choices, v.me.id) ?? matchFreeText(text, v.choices, v.me.id, isTrick(text));
  if (!found) parts.push(v.mode === "combat" ? "✨ Trick – eine Probe entscheidet (kostet deine Aktion)" : "✨ Der Spielleiter entscheidet");
  else if ("blocked" in found) parts.push(`⛔ ${found.choice.label}: ${found.blocked}`);
  else if ("ask" in found) parts.push(`🤔 Rückfrage: ${found.ask.map((m) => m.targetNames.join(", ") || m.choice.label).join(" oder ")}`);
  else {
    const { choice: c, targetNames } = found.match;
    const bits = [`${c.label.replace(/^[^\p{L}]+/u, "")}${targetNames.length ? ` → ${targetNames.join(", ")}` : ""}`];
    if (c.chance !== undefined) bits.push(`${Math.round(c.chance * 100)} %`);
    if (c.avg) bits.push(`≈ ${Math.round(c.avg)} ${c.avgKind === "heal" ? "Heilung" : "Schaden"}`);
    parts.push(bits.join(" · "));
  }
  return parts.join(" + ");
}

/** Attacks and spells: coloured chips (damage, chance, range) instead of a sentence. */
function choiceChips(c: ActionChoice): HTMLElement[] {
  const chips: HTMLElement[] = [];
  const chip = (cls: string, text: string) => h("span", { class: `chip ${cls}` }, text);
  const avg = c.avg !== undefined ? Math.round(c.avg) : undefined;
  if (avg && c.avgKind === "heal") chips.push(chip("heal", `💚 ≈ ${avg} Heilung`));
  else if (avg) {
    const dice = /(\d+W\d+(?: \+ \d+W\d+)*(?: \+ \d+)?) Schaden/.exec(c.detail)?.[1];
    chips.push(chip("dmg", `⚔️ ${dice ? `${dice.replace(/ /g, "")} ` : ""}≈ ${avg}`));
  }
  if (c.chance !== undefined) chips.push(oddsBadge(c.chance));
  if (c.group === "attack") chips.push(chip("range", c.detail.includes("Fernkampf") ? "🏹 Fern" : c.detail.includes("werfen") ? "🗡️ Nah · Wurf" : "🗡️ Nah"));
  const slots = /noch (\d+) Pl/.exec(c.detail)?.[1];
  if (c.group === "spell") chips.push(chip("slots", c.detail.startsWith("Zaubertrick") ? "✨ beliebig oft" : `✨ noch ${slots ?? "?"}`));
  if (c.detail.includes("trifft alle")) chips.push(chip("area", "💥 Fläche"));
  return chips;
}

function choiceBody(c: ActionChoice): HTMLElement[] {
  if (!c.enabled) return [h("span", { class: "choice-detail" }, c.reason ?? c.detail)];
  const chips = c.group === "attack" || c.group === "spell" || c.avg ? choiceChips(c) : [];
  if (chips.length >= 2) return [h("span", { class: "chips" }, ...chips)];
  return [h("span", { class: "choice-detail" }, c.detail), ...(chips.length ? [h("span", { class: "chips" }, ...chips)] : [])];
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `−${Math.abs(n)}`;
}

export function createController(playerId: () => string, send: (a: PlayerAction) => void): Controller {
  let view: PlayerView | undefined;
  let tab: Tab = "action";
  let dice: DiceOverlay | undefined;
  let diceFor: string | undefined;
  /** The window showing the last result: a new roll waits until it was seen (or 2.5 s). */
  let landed: DiceOverlay | undefined;
  let waitingPrompt: RollPrompt | undefined;
  let wasMine = false;
  const closedGroups = new Set<ActionGroup>();
  let lockedOpen = false;
  /** Simple view: everything else is shown after "Alle Aktionen". */
  let showAll = false;
  let favourites: Record<string, number> = (() => {
    try {
      return JSON.parse(localStorage.getItem(`couch-dungeon.fav.${playerId()}`) ?? "{}") as Record<string, number>;
    } catch {
      return {};
    }
  })();
  let pulseTurn = false;
  /** Exploring in turns: when this player's turn is skipped (local clock), and whether we warned already. */
  let turnEnds: number | undefined;
  let warnedAt: number | undefined;
  let wasNextUp = false;
  /** Level-ups and new gear shown together in one window. */
  const rewardQueue: Extract<Reward, { kind: "level" | "gear" }>[] = [];
  let rewardBox: { sheet: HTMLElement; stack: HTMLElement; ok: HTMLElement; count: number } | undefined;
  let queueWasMine = false;
  /** A move chosen while someone else is still on (one tap once it is this hero's turn). */
  let queued: { choiceId: string; group: ActionGroup; label: string; targetIds: string[]; targetNames: string[] } | undefined;
  let lastActions = 0;
  const tickTimer = () => {
    const el = status.querySelector<HTMLElement>(".turn-timer");
    if (!el || turnEnds === undefined) return;
    const left = Math.max(0, Math.ceil((turnEnds - Date.now()) / 1000));
    el.textContent = `⏱ ${left} s`;
    el.classList.toggle("urgent", left <= 15);
    el.hidden = left > 60;
    if (left <= 10 && left > 0 && warnedAt !== turnEnds) {
      warnedAt = turnEnds;
      if ("vibrate" in navigator) navigator.vibrate([60, 60, 60]);
    }
  };
  setInterval(tickTimer, 1000);
  /** A walk being planned on the map (the second tap on the same square walks). */
  let walkPlan: { to: GridPos; route: GridPos[]; cost: number; difficult: number; provoked: string[] } | undefined;
  let bigMap: HTMLElement | undefined;
  let bigMapDraw: (() => void) | undefined;
  let bigZoom = 1.5;
  /** The player's favourite actions (newest first). */
  let recent: string[] = (() => {
    try {
      return JSON.parse(localStorage.getItem(`couch-dungeon.recent.${playerId()}`) ?? "[]") as string[];
    } catch {
      return [];
    }
  })();

  const root = h("div", { class: "controller" });
  const header = h("header", { class: "ctl-head" });
  const status = h("div", { class: "ctl-status" });
  const body = h("main", { class: "ctl-body" });
  /** Tips for beginners live here (not in the body, which is redrawn on every change). */
  const hintSlot = h("div", { class: "hint-slot" });
  /** Always within thumb reach on the action tab: favourite actions, free action, end turn. */
  const bottomBar = h("div", { class: "bottom-bar", hidden: true });
  const toast = h("div", { class: "toast", hidden: true });
  const tabs = h("nav", { class: "ctl-tabs" });
  // Quick reactions: a round button above the tabs opens a row of emoji.
  const emoteRow = h("div", { class: "emote-row", hidden: true });
  const emoteBtn = h("button", { class: "emote-btn", type: "button", textContent: "😀", title: "Reaktion zeigen" });
  let emoteClose: ReturnType<typeof setTimeout> | undefined;
  emoteBtn.addEventListener("click", () => {
    emoteRow.hidden = !emoteRow.hidden;
    if (emoteClose) clearTimeout(emoteClose);
    if (!emoteRow.hidden) emoteClose = setTimeout(() => (emoteRow.hidden = true), 5000);
  });
  for (const emoji of EMOTES) {
    const b = h("button", { class: "emote", type: "button", textContent: emoji });
    b.addEventListener("click", () => {
      send({ kind: "emote", emoji });
      emoteRow.hidden = true;
      if ("vibrate" in navigator) navigator.vibrate(15);
    });
    emoteRow.append(b);
  }
  root.append(header, status, hintSlot, body, bottomBar, tabs, toast, emoteRow, emoteBtn);

  const help = helpButton({
    view: () => view,
    setBeginnerMode: (on) => send({ kind: "set_beginner_mode", on }),
    askRules: (question) => send({ kind: "ask_rules", question }),
    onPrefs: () => render(),
  });

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function showToast(text: string): void {
    toast.textContent = text;
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 3200);
  }

  // ---------------------------------------------------------------- header & status

  function renderHeader(me: Creature): void {
    const color = me.appearance?.color ?? "#888";
    const hpPct = Math.max(0, me.hp / me.maxHp);
    header.style.setProperty("--player", color);
    header.replaceChildren(
      me.appearance ? dollCanvas(me.appearance.look, 2, "ctl-figure") : h("span", {}),
      h(
        "div",
        { class: "ctl-who" },
        h("strong", {}, me.name),
        h("span", { dataset: { help: `klasse:${me.pc?.classId}` } }, `${nameOf("classes", me.pc?.classId ?? "")} · Stufe ${me.pc?.level ?? 1}`),
      ),
      h(
        "div",
        { class: "ctl-hp", dataset: { help: "trefferpunkte" } },
        h("div", { class: "hp-bar" }, h("div", { class: "hp-fill", style: `width:${hpPct * 100}%;background:${hpPct > 0.5 ? "#4caf50" : hpPct > 0.25 ? "#e0b030" : "#e04040"}` })),
        h("span", {}, `❤️ ${me.hp}/${me.maxHp}`),
      ),
      h("div", { class: "ctl-ac", dataset: { help: "ruestungsklasse" } }, `🛡️ ${armorClass(me)}`),
      help,
    );
  }

  function renderOrder(v: PlayerView): HTMLElement | null {
    if (v.mode !== "combat" || !v.order.length) return null;
    return h(
      "div",
      { class: "order", dataset: { help: "initiative" } },
      ...v.order.map((o) =>
        h(
          "span",
          { class: `order-entry${o.active ? " active" : ""}${o.enemy ? " enemy" : ""}${o.health <= 0 ? " down" : ""}`, style: o.color ? `--player:${o.color}` : "" },
          o.name,
        ),
      ),
    );
  }

  /** A lamp that is lit while something is still available (movement, action, bonus action). */
  function lamp(icon: string, label: string, on: boolean, key: string): HTMLElement {
    return h("span", { class: `lamp${on ? " on" : ""}`, dataset: { help: key } }, h("span", { class: "lamp-icon" }, icon), h("span", { class: "lamp-label" }, label));
  }

  function renderStatus(v: PlayerView): void {
    status.style.setProperty("--player", v.turn.mine ? (v.me.appearance?.color ?? "#e0a526") : (v.turn.activeColor ?? "#888"));
    if (!v.turn.mine) {
      status.className = `ctl-status waiting${v.turn.nextUp ? " next-up" : ""}`;
      status.replaceChildren(
        h("div", { class: "turn-line" }, h("span", {}, "⏳ "), h("strong", {}, v.turn.activeName), h("span", {}, " ist dran"), v.turn.nextUp ? h("span", { class: "turn-next" }, "· du bist gleich dran") : ""),
        renderOrder(v) ?? "",
      );
      return;
    }
    status.className = `ctl-status mine${pulseTurn ? " pulse" : ""}`;
    const fields = Math.floor(v.turn.movementLeftFt / 5);
    if (v.turn.free) {
      // Exploring: no turns, everyone acts whenever they like.
      status.replaceChildren(
        h("div", { class: "turn-line" }, h("strong", {}, "🧭 Freies Erkunden – alle gleichzeitig")),
        h("div", { class: "lamps" }, lamp("🦶", `bis ${fields} Felder`, fields > 0, "bewegung"), lamp("❤️", `${v.me.hp}/${v.me.maxHp}`, v.me.hp > 0, "trefferpunkte")),
      );
      return;
    }
    // Your turn in one line: what is still left (lit) – walking, the action, the bonus action.
    const moved = fields === 0;
    const acted = v.turn.actions <= 0;
    status.replaceChildren(
      h(
        "div",
        { class: "turn-line" },
        h("strong", {}, "🎯 Du bist dran"),
        h(
          "span",
          { class: "lamps" },
          lamp("🦶", moved ? "gelaufen" : `${fields} ${fields === 1 ? "Feld" : "Felder"}`, !moved, "bewegung"),
          lamp("⚔️", acted ? "Aktion ✓" : "Aktion", !acted, "aktion"),
          v.mode === "combat" && v.turn.bonusAction ? lamp("✨", "Bonus", true, "bonusaktion") : "",
        ),
      ),
      renderOrder(v) ?? "",
    );
    turnEnds = v.turn.secondsLeft !== undefined ? Date.now() + v.turn.secondsLeft * 1000 : undefined;
    tickTimer();
  }

  // ---------------------------------------------------------------- action tab

  function choose(c: ActionChoice): void {
    if (!c.enabled) {
      if (canQueue(c)) return queue(c);
      showToast(c.reason ?? "Das geht gerade nicht.");
      return;
    }
    if ("vibrate" in navigator) navigator.vibrate(12);
    remember(c);
    if (c.action.kind === "free_text") return freeText();
    if (c.action.kind === "cast" && view) maybeHint(playerId(), "first_spell", loadPrefs().tips, hintSlot);
    if (c.targets && !(c.action.kind === "cast" && c.action.targetIds.length)) return pickTargets(c);
    send(c.action);
  }

  function withTargets(c: ActionChoice, ids: string[]): PlayerAction {
    const a = c.action;
    switch (a.kind) {
      case "attack":
      case "approach":
        return { ...a, targetId: ids[0]! };
      case "cast":
        return { ...a, targetIds: ids };
      case "use_item":
      case "interact":
        return { ...a, targetId: ids[0]! };
      case "feature":
        // The TV caps healing at what the target is missing.
      default:
        return a;
    }
  }

  /** Not this hero's turn yet: attacks, spells, items and abilities can be chosen in advance. */
  function canQueue(c: ActionChoice): boolean {
    const v = view;
    return !!v && !v.turn.mine && !v.turn.free && !v.me.dead && v.me.hp > 0 && c.reason === "Warte, bis du dran bist." && ["attack", "spell", "item", "ability"].includes(c.group);
  }

  function queue(c: ActionChoice, targetId?: string): void {
    const set = (ids: string[]) => {
      const names = ids.map((id) => view?.minimap.creatures.find((x) => x.id === id)?.name ?? c.targets?.find((t) => t.id === id)?.name ?? "");
      queued = { choiceId: c.id, group: c.group, label: c.label, targetIds: ids, targetNames: names.filter(Boolean) };
      remember(c);
      showToast("📌 Vorgemerkt – wenn du dran bist, reicht ein Tipp.");
      render();
    };
    if (targetId) return set([targetId]);
    // Attacks may aim at any enemy in sight: who is in reach is checked when the turn comes.
    const enemies = (view?.minimap.creatures ?? []).filter((x) => x.enemy && !x.down).map((x) => ({ id: x.id, name: x.name, detail: `❤️ ${Math.round(x.health * 100)} %` }));
    const targets = c.group === "attack" && enemies.length ? enemies : c.targets;
    if (targets?.length && !(c.action.kind === "cast" && c.action.targetIds.length)) return pickTargets({ ...c, targets }, set);
    set([]);
  }

  /** The queued move as it can be done now: the same choice, or walking there first if the enemy moved away. */
  function queuedNow(v: PlayerView): { choice: ActionChoice; ids: string[] } | undefined {
    if (!queued) return undefined;
    const q = queued;
    const fits = (c: ActionChoice) => c.enabled && (!q.targetIds.length || q.targetIds.every((id) => c.targets?.some((t) => t.id === id)));
    const same = v.choices.find((c) => c.id === q.choiceId);
    if (same && fits(same)) return { choice: same, ids: q.targetIds };
    const walk = q.group === "attack" ? v.choices.find((c) => c.action.kind === "approach" && fits(c)) : undefined;
    return walk ? { choice: walk, ids: q.targetIds } : undefined;
  }

  function queuedCard(v: PlayerView): HTMLElement | null {
    if (!queued) return null;
    const q = queued;
    const cancel = h("button", { class: "btn secondary small", type: "button", textContent: "✖" });
    cancel.addEventListener("click", () => {
      queued = undefined;
      render();
    });
    const what = `${q.label}${q.targetNames.length ? ` → ${q.targetNames.join(", ")}` : ""}`;
    if (!v.turn.mine) return h("section", { class: "card queued-card" }, h("div", { class: "queued-row" }, h("span", {}, "📌 Vorgemerkt: ", h("strong", {}, what)), cancel));
    const now = queuedNow(v);
    if (!now) return null;
    const go = h("button", { class: "btn primary big", type: "button", textContent: `▶ ${now.choice.label}${q.targetNames.length ? ` → ${q.targetNames.join(", ")}` : ""}` });
    go.addEventListener("click", () => {
      queued = undefined;
      remember(now.choice);
      send(now.ids.length ? withTargets(now.choice, now.ids) : now.choice.action);
    });
    const other = h("button", { class: "btn secondary", type: "button", textContent: "Doch etwas anderes" });
    other.addEventListener("click", () => {
      queued = undefined;
      render();
    });
    return h("section", { class: "card queued-card mine" }, h("div", { class: "context-title" }, "📌 Dein vorgemerkter Zug"), go, other);
  }

  function pickTargets(c: ActionChoice, done?: (ids: string[]) => void): void {
    const finish = (ids: string[]) => (done ? done(ids) : send(withTargets(c, ids)));
    const targets = c.targets ?? [];
    const pick = c.pick ?? { min: 1, max: 1, repeat: false };
    if (!targets.length) {
      showToast("Kein passendes Ziel in Reichweite.");
      return;
    }
    const chosen: string[] = [];
    const confirm = h("button", { class: "btn primary big", type: "button", disabled: true });
    const counter = () => {
      confirm.textContent = pick.max > 1 ? `Los! (${chosen.length}/${pick.max})` : "Los!";
      confirm.disabled = chosen.length < pick.min;
    };
    const buttons = targets.map((t) => {
      const count = h("span", { class: "count" });
      const b = h("button", { class: "target", type: "button" }, h("strong", {}, t.name), h("span", {}, t.detail), count);
      b.addEventListener("click", () => {
        if (pick.max === 1) {
          closeSheet();
          finish([t.id]);
          return;
        }
        const has = chosen.filter((x) => x === t.id).length;
        if (chosen.length < pick.max && (pick.repeat || !has)) chosen.push(t.id);
        else if (has) chosen.splice(chosen.indexOf(t.id), 1);
        const n = chosen.filter((x) => x === t.id).length;
        count.textContent = n ? (pick.repeat ? `×${n}` : "✓") : "";
        b.classList.toggle("selected", n > 0);
        counter();
      });
      return b;
    });
    confirm.addEventListener("click", () => {
      closeSheet();
      finish(chosen);
    });
    counter();
    const note =
      pick.max > 1 ? h("p", { class: "lead" }, pick.repeat ? `Verteile ${pick.max} Geschosse: tippe ein Ziel mehrmals an.` : `Wähle bis zu ${pick.max} Ziele.`) : null;
    // The targets on the map too: tap the figure instead of looking for the name.
    let map: HTMLElement | null = null;
    const mm = view?.minimap;
    const spots = mm ? targets.map((t) => ({ t, at: mm.creatures.find((x) => x.id === t.id) })).filter((x) => x.at) : [];
    if (mm && spots.length) {
      map = h(
        "div",
        { class: "target-map" },
        minimapView(
          mm,
          (p) => {
            const hit = spots.findIndex((x) => x.at!.x === p.x && x.at!.y === p.y);
            if (hit >= 0) buttons[targets.indexOf(spots[hit]!.t)]!.click();
          },
          { targets: spots.map((x) => ({ x: x.at!.x, y: x.at!.y })) },
        ),
        h("p", { class: "muted small" }, "Tippe ein Ziel auf der Karte an – oder unten in der Liste."),
      );
    }
    showSheet(`${c.label}: Ziel wählen`, note, map, h("div", { class: "targets" }, ...buttons), pick.max > 1 ? confirm : null);
  }

  let ideasBox: HTMLElement | undefined;
  let ideaInput: HTMLTextAreaElement | undefined;

  function freeText(prefill = ""): void {
    const fighting = view?.mode === "combat";
    const input = h("textarea", {
      class: "text-input",
      rows: 3,
      placeholder: fighting ? "z. B. Ich werfe dem Räuber Sand in die Augen." : "z. B. Ich biete dem Oger Brot an, damit er uns vorbeilässt.",
    }) as HTMLTextAreaElement;
    if (prefill) input.value = prefill;
    const go = h("button", { class: "btn primary big", type: "button", textContent: "Absenden" });
    const submit = (text: string) => {
      if (!text) return;
      closeSheet();
      ideasBox = undefined;
      try {
        localStorage.setItem(`couch-dungeon.lastfree.${playerId()}`, text);
      } catch {
        // no storage: no "again" button
      }
      send({ kind: "free_text", text });
    };
    go.addEventListener("click", () => submit(input.value.trim()));
    // What the game will make of it, while typing ("➜ Rapier auf Goblin 1 · 55 % · ≈ 7 Schaden").
    const preview = h("p", { class: "free-preview" });
    const update = () => {
      const p = view ? previewFreeText(input.value, view) : "";
      preview.textContent = p ? `➜ ${p}` : "";
      preview.hidden = !p;
    };
    input.addEventListener("input", update);
    update();
    // The last free action once more (round 2, 3 … of a fight).
    let last = "";
    try {
      last = localStorage.getItem(`couch-dungeon.lastfree.${playerId()}`) ?? "";
    } catch {
      last = "";
    }
    const again = last ? h("button", { class: "btn secondary again-btn", type: "button", textContent: `🔁 Nochmal: „${last.length > 40 ? `${last.slice(0, 38)}…` : last}“` }) : null;
    again?.addEventListener("click", () => submit(last));
    const tools = h("div", { class: "free-tools" });
    // 🎤 Speak instead of type.
    const mic = micButton(input);
    if (mic) tools.append(mic);
    // 💡 Ideas from the game master.
    const ideas = h("button", { class: "btn secondary", type: "button", textContent: "💡 Ideen" });
    const box = h("div", { class: "idea-list" });
    ideas.addEventListener("click", () => {
      ideas.disabled = true;
      box.replaceChildren(h("p", { class: "lead" }, "Der Spielleiter überlegt …"));
      send({ kind: "suggest" });
      setTimeout(() => (ideas.disabled = false), 15000);
    });
    tools.append(ideas);
    ideasBox = box;
    ideaInput = input;
    const cost = h(
      "p",
      { class: "lead free-cost" },
      fighting
        ? "⚔️ Im Kampf kostet das deine Aktion. Gute Tricks: ablenken, umstoßen, Sand werfen, bestechen, betören, einschüchtern, Fässer werfen."
        : "Reden, suchen, verarzten, bestechen, schmeicheln – beschreibe es einfach. Oft entscheidet eine Probe.",
    );
    showSheet("Freie Aktion", h("p", { class: "lead" }, "Beschreibe mit eigenen Worten, was deine Figur tun will."), ...(again ? [again] : []), cost, input, preview, tools, box, go);
    queueMicrotask(() => input.focus());
  }

  /** Green: someone is badly hurt and this heals. Yellow: you are nearly down and this keeps you safe. */
  function urgency(c: ActionChoice): string {
    const v = view;
    if (!v || !c.enabled) return "";
    const heals = c.avgKind === "heal" || c.id === "item:potion";
    const hurt = v.minimap.creatures.some((x) => !x.enemy && x.color && x.health < 0.35) || v.me.hp / Math.max(1, v.me.maxHp) < 0.35;
    if (heals && hurt) return " urgent-heal";
    const safe = c.action.kind === "feature" && ["dodge", "disengage", "dash", "hide", "second-wind", "patient-defense"].includes(c.action.feature);
    if (safe && v.me.hp / Math.max(1, v.me.maxHp) < 0.3) return " urgent-safe";
    return "";
  }

  function choiceButton(c: ActionChoice): HTMLElement {
    const b = h(
      "button",
      { class: `choice-btn${c.enabled ? "" : canQueue(c) ? " queueable" : " disabled"}${c.recommended ? " recommended" : ""}${c.votes?.mine ? " voted" : ""}${urgency(c)}`, type: "button", dataset: { help: c.glossarKey } },
      h("span", { class: "choice-label" }, c.label, c.recommended ? h("span", { class: "rec" }, "⭐ Empfohlen") : null),
      ...choiceBody(c),
      c.votes
        ? h(
            "span",
            { class: "vote-line" },
            c.votes.mine ? h("strong", { class: "vote-mine" }, "✔ Deine Stimme") : "",
            c.votes.names.length ? `🗳️ ${c.votes.names.join(", ")}` : "",
          )
        : null,
      c.cost !== "free" ? h("span", { class: `cost cost-${c.cost}` }, c.cost === "bonus" ? "Bonus" : "Aktion") : null,
      !c.enabled && canQueue(c) ? h("span", { class: "queue-hint" }, queued?.choiceId === c.id ? "📌 vorgemerkt" : "📌 vormerken") : null,
    );
    b.addEventListener("click", () => choose(c));
    onHold(b, () => explainChoice(c));
    return b;
  }

  /** Long press on a button: what it does, what it costs, why it does not work right now. */
  function explainChoice(c: ActionChoice): void {
    const more = c.glossarKey ? h("button", { class: "btn secondary", type: "button", textContent: "📖 Mehr dazu" }) : null;
    more?.addEventListener("click", () => {
      closeSheet();
      openHelp(c.glossarKey!);
    });
    showSheet(
      `🔎 ${c.label}`,
      h("div", { class: "chips" }, ...choiceChips(c)),
      c.detail ? h("p", { class: "lead" }, c.detail) : null,
      h("p", { class: "muted" }, c.cost === "free" ? "Kostet keine Aktion." : c.cost === "bonus" ? "Kostet deine Bonusaktion." : "Kostet deine Aktion."),
      !c.enabled && c.reason ? h("p", { class: "route-warn" }, `⛔ ${c.reason}`) : null,
      more,
    );
  }

  /** Long press on the map: what is on this square. */
  function explainCell(v: PlayerView, p: GridPos): void {
    const mm = v.minimap;
    const i = (p.y - mm.y0) * mm.w + (p.x - mm.x0);
    const parts: (HTMLElement | null)[] = [];
    if (!mm.frames[i]) parts.push(h("p", { class: "lead" }, "🌫️ Noch nicht erkundet."));
    const who = mm.creatures.find((c) => c.x === p.x && c.y === p.y);
    if (who) {
      parts.push(h("p", { class: "lead" }, h("strong", {}, who.me ? `${who.name} (du)` : who.name), who.enemy ? " – Gegner" : who.color ? " – aus eurer Gruppe" : " – kein Gegner"));
      if (who.enemy) parts.push(enemyCard(who));
      else parts.push(h("p", { class: "muted" }, `❤️ ${Math.round(who.health * 100)} %${who.down ? " · bewusstlos!" : ""}`));
    }
    for (const o of mm.objects.filter((o) => o.x === p.x && o.y === p.y)) {
      parts.push(h("p", { class: "lead" }, `📦 ${o.name ?? "Gegenstand"}`, o.use ? h("span", { class: "muted" }, ` · ${o.use}`) : ""));
    }
    const MARKS: Record<string, string> = {
      d: "▨ Schwieriges Gelände: 2 Schritte pro Feld",
      i: "🧊 Eis: glatt und schwierig – man kann ausrutschen",
      h: "▲ Erhöht: Vorteil beim Schießen nach unten",
      f: "🔥 Feuer: 1W6 Schaden, wer hineinläuft",
      c: "🛡️ Deckung: daneben stehen = +2 RK gegen Fernangriffe",
    };
    const mark = mm.marks?.[i];
    if (mark && MARKS[mark]) parts.push(h("p", {}, MARKS[mark]!));
    if (v.turn.mine && !who?.me) {
      const reach = mm.reachable.some((q) => q.x === p.x && q.y === p.y);
      const route = reach ? planRoute(mm, p) : undefined;
      parts.push(h("p", { class: "muted" }, reach ? `🦶 In diesem Zug erreichbar (${route?.cost ?? 1} ${route?.cost === 1 ? "Feld" : "Felder"}).` : "🦶 Zu weit für diesen Zug."));
    }
    if (parts.length === 0) parts.push(h("p", { class: "muted" }, "Hier ist nichts Besonderes."));
    showSheet("🔎 Was ist hier?", ...parts);
  }

  function renderStory(v: PlayerView): HTMLElement[] {
    const st = v.story;
    if (!st) return [];
    const out: HTMLElement[] = [];
    // One line on the action screen: what to do now. Everything else (story so far, tasks) one tap away.
    const open = st.tasks?.find((t) => !t.done)?.text ?? st.goal;
    const line = h("button", { class: "st-line-btn", type: "button" }, h("span", {}, `🎯 ${open}`), h("span", { class: "muted" }, "📖"));
    line.addEventListener("click", () => showSheet(`📖 ${st.scene}`, storyCard(v)));
    out.push(line);
    return [...out, ...storyChoices(v)];
  }

  /** The story so far: chapter, scene, tasks and the last lines (in a sheet). */
  function storyCard(v: PlayerView): HTMLElement {
    const st = v.story!;
    const last = st.narration.slice(-4);
    return h(
        "section",
        { class: "card st-card" },
        h("div", { class: "st-chapter" }, st.chapter),
        h("strong", { class: "st-scene" }, st.scene),
        st.tasks?.length
          ? h(
              "ul",
              { class: "st-tasks" },
              ...st.tasks.map((t) => h("li", { class: t.done ? "done" : "open" }, `${t.done ? "✅" : "⬜"} ${t.text}`)),
              ...(st.moreTasks ? [h("li", { class: "more" }, `… und ${st.moreTasks} weitere`)] : []),
            )
          : h("div", { class: "st-goal" }, `🎯 Ziel: ${st.goal}`),
        ...last.map((l) =>
          h(
            "p",
            { class: l.npc ? "st-line npc" : "st-line" },
            l.npc ? h("strong", {}, `${l.npc}: `) : "",
            l.text,
            l.tip && loadPrefs().tips ? h("span", { class: "st-tip", dataset: { help: l.tip.key } }, `💡 ${l.tip.text}`) : "",
          ),
        ),
    );
  }

  function storyChoices(v: PlayerView): HTMLElement[] {
    const st = v.story!;
    const out: HTMLElement[] = [];
    if (st.choices.length) {
      out.push(
        h(
          "section",
          { class: "group story-choices" },
          h(
            "div",
            { class: "group-head static" },
            h("span", {}, st.vote ? "🗳️ Abstimmung: Wie geht es weiter?" : "📖 Wie geht es weiter?"),
            h("span", { class: "muted" }, st.vote ? `${st.vote.cast} von ${st.vote.total} haben abgestimmt` : "Besprecht euch!"),
          ),
          st.vote ? h("p", { class: "muted small vote-hint" }, "Jeder stimmt ab – umentscheiden geht, bis alle abgestimmt haben. Die Mehrheit gewinnt.") : "",
          h("div", { class: "group-body" }, ...st.choices.map(choiceButton)),
        ),
      );
    }
    return out;
  }

  function goalCard(g: NonNullable<PlayerView["goal"]>): HTMLElement {
    const pct = Math.round((Math.min(g.have, g.need) / g.need) * 100);
    const state = g.done ? "✅ Erfüllt! Am Ende gibt es Bonus-Gold." : g.atEnd ? (g.have >= g.need ? "Bisher geschafft – wird am Ende geprüft." : "❌ Leider verpasst.") : `${g.have} / ${g.need}`;
    return h(
      "section",
      { class: `card goal-card${g.done ? " done" : ""}` },
      h("div", { class: "card-title", dataset: { help: "geheimes_ziel" } }, "🤫 Dein geheimes Ziel"),
      h("div", { class: "goal-row" }, h("span", { class: "goal-icon" }, g.icon), h("strong", {}, g.text)),
      g.atEnd || g.done ? "" : h("div", { class: "goal-bar" }, h("span", { style: `width:${pct}%` })),
      h("p", { class: "muted small" }, state),
      h("p", { class: "muted small" }, "Psst – nur du siehst das."),
    );
  }

  function renderCluesTab(v: PlayerView): HTMLElement[] {
    const clues = v.story?.clues ?? [];
    return [
      ...(v.goal ? [goalCard(v.goal)] : []),
      h(
        "section",
        { class: "card" },
        h("div", { class: "card-title", dataset: { help: "hinweis" } }, "🔎 Eure Hinweise"),
        clues.length
          ? h("ol", { class: "clue-list" }, ...clues.map((c) => h("li", {}, c.text)))
          : h("p", { class: "muted" }, "Noch keine Hinweise. Redet mit Leuten, seht euch um und besiegt Gegner – dann findet ihr heraus, was hinter der Geschichte steckt."),
        h("p", { class: "muted small" }, "Achtung: Nicht jeder Hinweis stimmt. Am Ende erfahrt ihr, was wirklich geschah."),
      ),
    ];
  }

  /**
   * The campfire card. It is built once per rest and only updated, so the text field keeps
   * what you type (and the keyboard stays open) while the others shop and tell.
   */
  let campCard: { el: HTMLElement; update(c: CampView): void } | undefined;

  function campSection(c: CampView): HTMLElement {
    if (!campCard) {
      const input = h("textarea", { class: "text-input camp-input", rows: 3, maxLength: 220, placeholder: "Ein, zwei Sätze reichen …" }) as HTMLTextAreaElement;
      const question = h("p", { class: "camp-question" });
      const tell = h("button", { class: "btn primary", type: "button", textContent: "🔥 Am Feuer erzählen" });
      tell.addEventListener("click", () => {
        const text = input.value.trim();
        if (text) send({ kind: "camp_tell", text });
      });
      const mic = micButton(input);
      const tellBox = h("div", { class: "camp-tell" }, question, input, h("div", { class: "free-tools" }, ...(mic ? [mic] : []), tell));
      const talesBox = h("div", { class: "camp-tales" });
      const goldLine = h("p", { class: "camp-gold" });
      const shopBox = h("div", { class: "camp-shop" });
      const readyLine = h("p", { class: "muted small" });
      const done = h("button", { class: "btn big", type: "button", textContent: "✅ Weiter – ich bin bereit" });
      done.addEventListener("click", () => send({ kind: "camp_done" }));
      const el = h(
        "section",
        { class: "card camp-card" },
        h("div", { class: "camp-fire" }, "🔥"),
        h("h2", {}, "Rast am Lagerfeuer"),
        h("p", { class: "muted" }, "Alle sind wieder bei vollen Kräften. Erzählt euch etwas über eure Helden – der Spielleiter merkt es sich."),
        tellBox,
        talesBox,
        h("h3", {}, "🛒 Händlerin Grete"),
        goldLine,
        shopBox,
        done,
        readyLine,
      );
      campCard = {
        el,
        update(cv) {
          question.textContent = `❓ ${cv.question}`;
          tellBox.hidden = cv.told;
          talesBox.replaceChildren(
            ...cv.tales.map((t) => h("div", { class: "camp-tale", style: `--player:${t.color ?? "#888"}` }, h("strong", {}, t.name), h("span", {}, `„${t.text}“`))),
          );
          goldLine.textContent = `Dein Gold: 💰 ${cv.gold}`;
          shopBox.replaceChildren(
            ...cv.shop.map((o) => {
              const buy = h("button", { class: "btn small primary", type: "button", textContent: o.blocked ?? `${o.price} 💰 kaufen`, disabled: !!o.blocked });
              buy.addEventListener("click", () => send({ kind: "camp_buy", offerId: o.id }));
              return h(
                "div",
                { class: "gear-row shop-row" },
                h("span", { class: "gear-icon" }, o.icon),
                h("div", { class: "gear-text" }, h("strong", {}, o.name), h("span", { class: "muted" }, o.detail), o.warning ? h("span", { class: "shop-warn" }, `⚠️ ${o.warning}`) : ""),
                h("div", { class: "gear-buttons" }, buy),
              );
            }),
          );
          done.disabled = cv.done;
          done.textContent = cv.done ? "⏳ Warte auf die anderen …" : "✅ Weiter – ich bin bereit";
          readyLine.textContent = `${cv.ready} von ${cv.total} sind bereit.`;
        },
      };
    }
    campCard.update(c);
    return campCard.el;
  }

  /** "Der letzte Schlag gehört dir": kept in place like the campfire card (typing is not interrupted). */
  let blowCard: HTMLElement | undefined;

  function finalBlowSection(boss: string): HTMLElement {
    if (blowCard) return blowCard;
    const input = h("textarea", { class: "text-input camp-input", rows: 3, maxLength: 200, placeholder: "z. B. Ich springe vom Felsen und ramme ihm die Lanze in die Brust!" }) as HTMLTextAreaElement;
    const go = h("button", { class: "btn primary big", type: "button", textContent: "⚔️ So war's!" });
    go.addEventListener("click", () => {
      const text = input.value.trim();
      if (text) send({ kind: "final_blow", text });
    });
    const skip = h("button", { class: "btn small", type: "button", textContent: "Mir fällt nichts ein – überspringen" });
    skip.addEventListener("click", () => send({ kind: "final_blow", text: "" }));
    const mic = micButton(input);
    blowCard = h(
      "section",
      { class: "card blow-card" },
      h("div", { class: "blow-icon" }, "⚔️"),
      h("h2", {}, "Der letzte Schlag gehört dir!"),
      h("p", {}, `Du hast ${boss} besiegt. Beschreib den anderen, wie es passiert ist – der Spielleiter erzählt es auf dem Fernseher nach.`),
      input,
      h("div", { class: "free-tools" }, ...(mic ? [mic] : []), go),
      skip,
    );
    if ("vibrate" in navigator) navigator.vibrate([100, 60, 100, 60, 300]);
    return blowCard;
  }

  /** Something to recommend right now (beginner mode): one big suggestion at the top. */
  /** The attack or spell this player uses most (at least 3 times) – if it works right now. */
  function favouriteChoice(v: PlayerView): ActionChoice | undefined {
    const best = v.choices
      .filter((c) => c.enabled && (c.group === "attack" || c.group === "spell") && c.targets?.length && c.avgKind !== "heal" && (favourites[c.id] ?? 0) >= 3)
      .sort((a, b) => (favourites[b.id] ?? 0) - (favourites[a.id] ?? 0))[0];
    return best;
  }

  /** Right next to something: a big button for it at the top (chest, table, a person to talk to …). */
  function contextCard(v: PlayerView): HTMLElement | null {
    if (!v.turn.mine) return null;
    const things = v.choices.filter((c) => c.enabled && (c.action.kind === "interact" || c.action.kind === "tame" || c.action.kind === "ground")).slice(0, 2);
    const me = v.minimap.creatures.find((c) => c.me);
    const person = me ? v.minimap.creatures.find((c) => !c.me && !c.enemy && !c.color && !c.down && Math.max(Math.abs(c.x - me.x), Math.abs(c.y - me.y)) <= 1) : undefined;
    if (!things.length && !person) return null;
    const buttons = things.map((c) => {
      const b = h("button", { class: "btn context-btn", type: "button", textContent: c.label });
      b.addEventListener("click", () => choose(c));
      return b;
    });
    if (person) {
      const b = h("button", { class: "btn context-btn", type: "button", textContent: `💬 Mit ${person.name} reden` });
      b.addEventListener("click", () => freeText(`Ich spreche mit ${person.name}: `));
      buttons.push(b);
    }
    return h("section", { class: "card context-card" }, h("div", { class: "context-title" }, "📍 Hier"), h("div", { class: "context-row" }, ...buttons));
  }

  function suggestionCard(v: PlayerView): HTMLElement | null {
    if (!v.beginnerMode || !v.turn.mine || v.story?.choices.length) return null;
    const c = favouriteChoice(v) ?? v.choices.find((x) => x.recommended && x.enabled);
    if (!c) return null;
    const go = h("button", { class: "btn primary", type: "button", textContent: "Mach ich!" });
    go.addEventListener("click", () => choose(c));
    return h(
      "section",
      { class: "card suggest-card", dataset: { help: c.glossarKey } },
      h("div", { class: "suggest-head" }, h("span", { class: "suggest-icon" }, "💡"), h("div", {}, h("strong", {}, `Vorschlag: ${c.label}`), ...choiceBody(c))),
      go,
    );
  }

  /** What can be done with the thing on a square (enemy, ally, furniture, animal, oil …). */
  function actionsAt(v: PlayerView, p: GridPos): { title: string; list: { choice: ActionChoice; targetId?: string }[]; enemy?: MiniCreature } | undefined {
    const mm = v.minimap;
    const creature = mm.creatures.find((c) => c.x === p.x && c.y === p.y && !c.me);
    const objects = mm.objects.filter((o) => o.x === p.x && o.y === p.y);
    const list: { choice: ActionChoice; targetId?: string }[] = [];
    for (const c of v.choices) {
      if (c.group === "story" || c.group === "free" || c.group === "end") continue;
      if (creature && c.targets?.some((t) => t.id === creature.id)) list.push({ choice: c, targetId: creature.id });
      else if (creature?.enemy && c.group === "attack" && c.action.kind === "attack" && canQueue(c)) list.push({ choice: c, targetId: creature.id });
      else if (creature && c.action.kind === "tame" && c.action.creatureId === creature.id) list.push({ choice: c });
      else if (c.action.kind === "interact" && objects.some((o) => o.id === (c.action as { objectId: string }).objectId)) list.push({ choice: c });
      else if (c.action.kind === "ground" && c.action.x === p.x && c.action.y === p.y) list.push({ choice: c });
    }
    if (!list.length && !creature?.enemy) return undefined;
    return { title: creature ? creature.name : "Hier", list, ...(creature?.enemy ? { enemy: creature } : {}) };
  }

  /** A short card about an enemy: life bar, armour, how dangerous. */
  function enemyCard(c: MiniCreature): HTMLElement {
    const pct = Math.round(c.health * 100);
    const tone = c.danger === "sehr gefährlich" ? "high" : c.danger === "gefährlich" ? "mid" : "low";
    return h(
      "div",
      { class: "enemy-card" },
      h("div", { class: "enemy-hp" }, h("div", { class: `enemy-hp-bar ${pct > 50 ? "ok" : pct > 25 ? "hurt" : "low"}`, style: `width:${pct}%` })),
      h(
        "div",
        { class: "chips" },
        h("span", { class: "chip" }, c.hp !== undefined ? `❤️ ${c.hp}/${c.maxHp}` : `❤️ ${pct} %`),
        c.ac !== undefined ? h("span", { class: "chip", dataset: { help: "ruestungsklasse" } }, `🛡️ RK ${c.ac}`) : "",
        c.danger ? h("span", { class: `chip danger ${tone}` }, tone === "high" ? "☠️ sehr gefährlich" : tone === "mid" ? "⚠️ gefährlich" : "🙂 leicht") : "",
      ),
    );
  }

  /** A tap on the map: act on what stands there, or plan a walk (a second tap walks). */
  function tapMap(p: GridPos): void {
    const v = view;
    if (!v) return;
    const here = actionsAt(v, p);
    if (here) {
      send({ kind: "point", x: p.x, y: p.y });
      const buttons = here.list.map(({ choice, targetId }) => {
        // A copy of the normal button without its own click (here the target is already known).
        const clone = choiceButton(choice).cloneNode(true) as HTMLElement;
        clone.addEventListener("click", () => {
          closeSheet();
          if (!choice.enabled) {
            if (canQueue(choice)) return queue(choice, targetId);
            showToast(choice.reason ?? "Das geht gerade nicht.");
            return;
          }
          remember(choice);
          // Several targets (magic missile): the normal picker; one target: straight away.
          if (targetId && (choice.pick?.max ?? 1) > 1) return pickTargets(choice);
          send(targetId ? withTargets(choice, [targetId]) : choice.action);
        });
        return clone;
      });
      const reachable = v.minimap.reachable.some((q) => q.x === p.x && q.y === p.y);
      const walk = reachable ? h("button", { class: "btn secondary", type: "button", textContent: "🦶 Stattdessen dorthin gehen" }) : null;
      walk?.addEventListener("click", () => {
        closeSheet();
        planWalk(v, p);
      });
      showSheet(
        `${here.enemy ? "👹" : "🎯"} ${here.title}`,
        ...(here.enemy ? [enemyCard(here.enemy)] : []),
        buttons.length ? h("div", { class: "targets" }, ...buttons) : h("p", { class: "muted small" }, v.turn.mine ? "Gerade kannst du hier nichts tun – geh näher heran." : "Warte, bis du dran bist."),
        ...(walk ? [walk] : []),
      );
      return;
    }
    // Something further away: walk there and use it / talk.
    const thing = v.turn.mine ? v.minimap.objects.find((o) => o.x === p.x && o.y === p.y && o.use) : undefined;
    const person = v.turn.mine ? v.minimap.creatures.find((c) => c.x === p.x && c.y === p.y && !c.me && !c.enemy && !c.color && !c.down) : undefined;
    if (thing || person) {
      send({ kind: "point", x: p.x, y: p.y });
      const go = h("button", { class: "btn primary", type: "button", textContent: thing ? `🦶 Hingehen: ${thing.use}` : `🦶💬 Hingehen und mit ${person!.name} reden` });
      go.addEventListener("click", () => {
        closeSheet();
        if (thing) send({ kind: "go_use", objectId: thing.id });
        else freeText(`Ich spreche mit ${person!.name}: `);
      });
      const reachable = v.minimap.reachable.some((q) => q.x === p.x && q.y === p.y);
      const walk = reachable ? h("button", { class: "btn secondary", type: "button", textContent: "Nur dorthin gehen" }) : null;
      walk?.addEventListener("click", () => {
        closeSheet();
        planWalk(v, p);
      });
      showSheet(`🎯 ${thing?.name ?? person!.name}`, h("p", { class: "muted small" }, "Du läufst so weit, wie deine Bewegung reicht – und legst los, sobald du daneben stehst."), go, walk);
      return;
    }
    planWalk(v, p);
  }

  function planWalk(v: PlayerView, p: GridPos): void {
    if (!v.minimap.reachable.some((q) => q.x === p.x && q.y === p.y)) {
      // Only worth a note in a fight (in exploration you simply walk step by step).
      if (v.turn.mine && v.mode === "combat") showToast(v.minimap.reachable.length ? "Dorthin kommst du in diesem Zug nicht." : "Du kannst dich gerade nicht bewegen.");
      return;
    }
    // Second tap on the same square: go.
    if (walkPlan && walkPlan.to.x === p.x && walkPlan.to.y === p.y) {
      walkPlan = undefined;
      send({ kind: "move", to: p });
      return;
    }
    const route = planRoute(v.minimap, p);
    walkPlan = { to: p, route: route?.path ?? [p], cost: route?.cost ?? 1, difficult: route?.difficult ?? 0, provoked: v.mode === "combat" ? provokedBy(v.minimap, p) : [] };
    // The route shows on the TV too (everyone can say "not that way!").
    send({ kind: "point", x: p.x, y: p.y, path: walkPlan.route });
    render();
  }

  function undoButton(): HTMLElement {
    const b = h("button", { class: "btn secondary small undo-btn", type: "button", textContent: "↩️ Zurück (Schritt zurücknehmen)" });
    b.addEventListener("click", () => {
      walkPlan = undefined;
      send({ kind: "undo_move" });
    });
    return b;
  }

  function mapCard(v: PlayerView): HTMLElement {
    const plan = walkPlan && v.minimap.reachable.some((q) => q.x === walkPlan!.to.x && q.y === walkPlan!.to.y) ? walkPlan : undefined;
    if (!plan) walkPlan = undefined;
    const marks = plan ? { route: plan.route, selected: plan.to } : {};
    const map = minimapView(v.minimap, tapMap, marks, "minimap", (p) => explainCell(v, p));
    const full = h("button", { class: "map-full", type: "button", textContent: "⛶", title: "Karte groß" });
    full.addEventListener("click", () => openBigMap());
    let info: HTMLElement | null = null;
    if (plan) {
      const go = h("button", { class: "btn primary small", type: "button", textContent: "🦶 Hierhin gehen" });
      go.addEventListener("click", () => {
        walkPlan = undefined;
        send({ kind: "move", to: plan.to });
      });
      const cancel = h("button", { class: "btn secondary small", type: "button", textContent: "✖" });
      cancel.addEventListener("click", () => {
        walkPlan = undefined;
        render();
      });
      info = h(
        "div",
        { class: "route-info" },
        h("span", {}, `${plan.cost} ${plan.cost === 1 ? "Feld" : "Felder"}${plan.difficult ? ` (${plan.difficult}× schwieriges Gelände)` : ""}`),
        plan.provoked.length ? h("span", { class: "route-warn", dataset: { help: "gelegenheitsangriff" } }, `⚠️ ${plan.provoked.join(", ")} darf dich dabei schlagen`) : "",
        h("div", { class: "row" }, go, cancel),
      );
    }
    const hintText = v.turn.mine && v.minimap.reachable.length ? "Tippe ein Feld zum Laufen – oder einen Gegner/Gegenstand" : "Tippe auf Gegner oder Gegenstände";
    return h(
      "section",
      { class: "card map-card" },
      h("div", { class: "card-title" }, h("span", {}, `📍 ${v.roomName}`), h("span", { class: "muted small" }, hintText)),
      h("div", { class: "map-wrap" }, map, full),
      info ?? "",
      v.turn.canUndo ? undoButton() : "",
      minimapLegend(v.minimap),
    );
  }

  /** The map full screen, zoomable – tapping works as on the small one. */
  function openBigMap(): void {
    closeBigMap();
    const zoomIn = h("button", { class: "btn secondary small", type: "button", textContent: "＋" });
    const zoomOut = h("button", { class: "btn secondary small", type: "button", textContent: "－" });
    const close = h("button", { class: "btn primary small", type: "button", textContent: "✖ Schließen" });
    const scroller = h("div", { class: "big-map-scroll" });
    bigMap = h("div", { class: "big-map" }, h("div", { class: "big-map-bar" }, zoomOut, zoomIn, close), scroller);
    const draw = () => {
      if (!view || !bigMap) return;
      const plan = walkPlan;
      const canvas = minimapView(view.minimap, (p) => tapMap(p), plan ? { route: plan.route, selected: plan.to } : {}, "minimap big", (p) => view && explainCell(view, p));
      canvas.style.width = `${bigZoom * 100}%`;
      scroller.replaceChildren(canvas);
      // Centre on the own hero.
      const me = view.minimap.creatures.find((c) => c.me);
      if (me) {
        queueMicrotask(() => {
          const fx = (me.x - view!.minimap.x0 + 0.5) / view!.minimap.w;
          const fy = (me.y - view!.minimap.y0 + 0.5) / view!.minimap.h;
          scroller.scrollLeft = fx * canvas.clientWidth - scroller.clientWidth / 2;
          scroller.scrollTop = fy * canvas.clientHeight - scroller.clientHeight / 2;
        });
      }
    };
    bigMapDraw = draw;
    zoomIn.addEventListener("click", () => {
      bigZoom = Math.min(4, bigZoom + 0.5);
      draw();
    });
    zoomOut.addEventListener("click", () => {
      bigZoom = Math.max(1, bigZoom - 0.5);
      draw();
    });
    close.addEventListener("click", closeBigMap);
    // Two fingers zoom (the map stays under the fingers).
    let pinch: { dist: number; zoom: number } | undefined;
    const spread = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    scroller.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) pinch = { dist: spread(e.touches), zoom: bigZoom };
    }, { passive: true });
    scroller.addEventListener("touchmove", (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const canvas = scroller.querySelector("canvas");
      if (!canvas) return;
      const rect = scroller.getBoundingClientRect();
      const mx = (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2 - rect.left;
      const my = (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2 - rect.top;
      const fx = (scroller.scrollLeft + mx) / canvas.clientWidth;
      const fy = (scroller.scrollTop + my) / canvas.clientHeight;
      bigZoom = Math.max(1, Math.min(4, pinch.zoom * (spread(e.touches) / pinch.dist)));
      canvas.style.width = `${bigZoom * 100}%`;
      scroller.scrollLeft = fx * canvas.clientWidth - mx;
      scroller.scrollTop = fy * canvas.clientHeight - my;
    }, { passive: false });
    scroller.addEventListener("touchend", (e) => {
      if (e.touches.length < 2) pinch = undefined;
    });
    document.body.append(bigMap);
    draw();
  }

  function closeBigMap(): void {
    bigMap?.remove();
    bigMap = undefined;
    bigMapDraw = undefined;
  }

  function renderActionTab(v: PlayerView): HTMLElement[] {
    if (v.finalBlow) return [finalBlowSection(v.finalBlow.boss)];
    blowCard = undefined;
    if (v.camp) return [campSection(v.camp)];
    campCard = undefined;
    const top: HTMLElement[] = [];
    const planned = queuedCard(v);
    if (planned) top.push(planned);
    // One helper card at a time: queued move, else what is right here, else (in a fight) a suggestion.
    const here = planned ? null : contextCard(v);
    if (here) top.push(here);
    const suggestion = planned || here || v.mode !== "combat" ? null : suggestionCard(v);
    if (suggestion) top.push(suggestion);
    top.push(...renderStory(v));
    const actions: HTMLElement[] = [];
    // Simple view: the three most useful actions, the rest one tap away.
    if (loadPrefs().simple && !showAll) {
      const usable = v.choices.filter((c) => (c.enabled || canQueue(c)) && ["attack", "spell", "item", "ability", "look"].includes(c.group));
      const score = (c: ActionChoice) => (c === favouriteChoice(v) ? 100 : 0) + (c.recommended ? 50 : 0) + (favourites[c.id] ?? 0) + (c.group === "attack" ? 5 : c.group === "spell" ? 4 : 0) + (c.avg ?? 0) / 10 + ((c.avgKind === "heal" || c.id === "item:potion") && !urgency(c) ? -20 : 0);
      const best = [...usable].sort((a, b) => score(b) - score(a)).slice(0, 3);
      const more = h("button", { class: "btn secondary all-actions", type: "button", textContent: `▼ Alle Aktionen (${usable.length})` });
      more.addEventListener("click", () => {
        showAll = true;
        render();
      });
      actions.push(h("section", { class: "group" }, h("div", { class: "group-body" }, ...best.map(choiceButton))), more);
      if (v.log.length) {
        const lastLine = v.log[v.log.length - 1]!;
        const ticker = h("button", { class: "log-ticker", type: "button" }, h("span", { class: "muted" }, "📜 "), h("span", {}, lastLine.text), h("span", { class: "muted" }, " ›"));
        ticker.addEventListener("click", () => showSheet("📜 Was ist passiert?", h("div", { class: "log" }, ...v.log.slice(-15).map((l) => explainedLine(l)))));
        actions.push(ticker);
      }
      return [h("div", { class: "action-grid" }, h("div", { class: "col-top" }, ...top), h("div", { class: "col-map" }, mapCard(v)), h("div", { class: "col-actions" }, ...actions))];
    }
    if (loadPrefs().simple) {
      const less = h("button", { class: "btn secondary all-actions", type: "button", textContent: "▲ Weniger anzeigen" });
      less.addEventListener("click", () => {
        showAll = false;
        render();
      });
      actions.push(less);
    }
    // Only what works right now; the rest waits behind "Gerade nicht möglich".
    const groups: ActionGroup[] = ["attack", "spell", "item", "ability", "look"];
    const locked: ActionChoice[] = [];
    for (const g of groups) {
      const all = v.choices.filter((c) => c.group === g);
      // Waiting for the turn: attacks & co. can be queued, so they stay in their group.
      const list = all.filter((c) => c.enabled || canQueue(c));
      locked.push(...all.filter((c) => !c.enabled && !canQueue(c)));
      if (!list.length) continue;
      const open = !closedGroups.has(g);
      const head = h("button", { class: "group-head", type: "button" }, h("span", {}, GROUP_TITLES[g]), h("span", { class: "muted" }, `${list.length} ${open ? "▲" : "▼"}`));
      const content = h("div", { class: "group-body", hidden: !open }, ...list.map(choiceButton));
      head.addEventListener("click", () => {
        content.hidden = !content.hidden;
        if (content.hidden) closedGroups.add(g);
        else closedGroups.delete(g);
      });
      actions.push(h("section", { class: "group" }, head, content));
    }
    if (locked.length) {
      const head = h("button", { class: "group-head locked", type: "button" }, h("span", {}, "🔒 Gerade nicht möglich"), h("span", { class: "muted" }, `${locked.length} ${lockedOpen ? "▲" : "▼"}`));
      const content = h("div", { class: "group-body", hidden: !lockedOpen }, ...locked.map(choiceButton));
      head.addEventListener("click", () => {
        lockedOpen = !lockedOpen;
        content.hidden = !lockedOpen;
      });
      actions.push(h("section", { class: "group" }, head, content));
    }
    // The log: only the newest line; tapping shows more.
    if (v.log.length) {
      const lastLine = v.log[v.log.length - 1]!;
      const ticker = h("button", { class: "log-ticker", type: "button" }, h("span", { class: "muted" }, "📜 "), h("span", {}, lastLine.text), h("span", { class: "muted" }, " ›"));
      ticker.addEventListener("click", () => showSheet("📜 Was ist passiert?", h("div", { class: "log" }, ...v.log.slice(-15).map((l) => explainedLine(l)))));
      actions.push(ticker);
    }
    // Landscape on a big phone: map left, everything else right.
    return [h("div", { class: "action-grid" }, h("div", { class: "col-top" }, ...top), h("div", { class: "col-map" }, mapCard(v)), h("div", { class: "col-actions" }, ...actions))];
  }

  /** Remembers what the player uses, for the quick buttons. */
  function remember(c: ActionChoice): void {
    if (!["attack", "spell", "item", "ability"].includes(c.group)) return;
    // How often each attack or spell is used: the favourite becomes this player's suggestion.
    if (c.group === "attack" || c.group === "spell") {
      favourites[c.id] = (favourites[c.id] ?? 0) + 1;
      try {
        localStorage.setItem(`couch-dungeon.fav.${playerId()}`, JSON.stringify(favourites));
      } catch {
        // ignore
      }
    }
    recent = [c.id, ...recent.filter((id) => id !== c.id)].slice(0, 6);
    try {
      localStorage.setItem(`couch-dungeon.recent.${playerId()}`, JSON.stringify(recent));
    } catch {
      // ignore
    }
  }

  /** Thumb zone at the bottom: up to three favourite actions, free action, end turn. */
  function renderBottomBar(v: PlayerView | undefined): void {
    const show = !!v && tab === "action" && !v.camp && !v.finalBlow;
    bottomBar.hidden = !show;
    root.classList.toggle("with-bar", show);
    if (!show || !v) return;
    const quick = recent
      .map((id) => v.choices.find((c) => c.id === id))
      .filter((c): c is ActionChoice => !!c && c.enabled)
      .slice(0, 3)
      .map((c) => {
        const b = h("button", { class: "quick", type: "button", title: c.label }, h("span", {}, c.label.length > 14 ? `${c.label.slice(0, 13)}…` : c.label));
        b.addEventListener("click", () => choose(c));
        return b;
      });
    const free = v.choices.find((c) => c.id === "free");
    const end = v.choices.find((c) => c.id === "end");
    const items: HTMLElement[] = [...quick];
    if (free) {
      const b = h("button", { class: "bar-btn", type: "button", textContent: "✍️ Idee", dataset: { help: "freie_aktion" }, disabled: !free.enabled });
      b.addEventListener("click", () => choose(free));
      items.push(b);
    }
    if (end) {
      const b = h("button", { class: "bar-btn end", type: "button", textContent: "✅ Zug beenden", dataset: { help: "zug_beenden" }, disabled: !end.enabled });
      b.addEventListener("click", () => choose(end));
      items.push(b);
    }
    bottomBar.replaceChildren(...items);
    bottomBar.hidden = !items.length;
    root.classList.toggle("with-bar", items.length > 0);
  }

  // ---------------------------------------------------------------- character tab

  function renderSheetTab(me: Creature): HTMLElement[] {
    const pc = me.pc!;
    const modClass = (n: number) => (n > 0 ? "pos" : n < 0 ? "neg" : "zero");
    // The two best attributes are what this hero is good at.
    const best = [...ABILITIES].sort((a, b) => me.abilities[b] - me.abilities[a]).slice(0, 2);
    const abilities = h(
      "div",
      { class: "abilities" },
      ...ABILITIES.map((a) => {
        const score = me.abilities[a];
        const mod = abilityMod(score);
        return h(
          "div",
          { class: `ability${best.includes(a) ? " best" : ""}`, dataset: { help: ABILITY_GLOSSAR[a] } },
          h("span", { class: "ab-icon" }, ABILITY_ICON[a]),
          h("span", { class: "ab-name" }, abilityName(a)),
          h("strong", { class: `ab-mod ${modClass(mod)}` }, signed(mod)),
          h("div", { class: "ab-bar" }, h("span", { style: `width:${Math.round((Math.min(20, score) / 20) * 100)}%` })),
          h("span", { class: "ab-score" }, `Wert ${score}`),
        );
      }),
    );
    const stat = (icon: string, label: string, value: string, key: string) =>
      h("div", { class: "stat", dataset: { help: key } }, h("span", { class: "stat-icon" }, icon), h("span", { class: "stat-label" }, label), h("strong", {}, value));
    const hpPct = Math.round(Math.max(0, me.hp / me.maxHp) * 100);
    const hero = h(
      "div",
      { class: "hero-banner", style: `--player:${me.appearance?.color ?? "#888"}` },
      me.appearance ? dollCanvas(me.appearance.look, 4, "hero-doll") : h("span", {}),
      h(
        "div",
        { class: "hero-info" },
        h("strong", { class: "hero-name" }, me.name),
        h("span", { class: "muted" }, `${nameOf("classes", pc.classId)} · ${nameOf("races", pc.raceId)}`),
        h("span", { class: "hero-level", dataset: { help: "stufe" } }, `⭐ Stufe ${pc.level}`),
        h("div", { class: "hero-hp", dataset: { help: "trefferpunkte" } }, h("span", { style: `width:${hpPct}%` }), h("em", {}, `❤️ ${me.hp} / ${me.maxHp}`)),
      ),
    );
    const stats = h(
      "div",
      { class: "stats" },
      stat("🛡️", "Rüstungsklasse", String(armorClass(me)), "ruestungsklasse"),
      stat("👣", "Bewegung", `${me.speedFt / 5} Felder`, "bewegung"),
      stat("🎯", "Übungsbonus", signed(me.proficiencyBonus), "uebungsbonus"),
      stat("⚡", "Initiative", signed(abilityMod(me.abilities.DEX)), "initiative"),
    );
    const row = (label: string, value: number, prof: boolean, help: string, icon?: string) =>
      h(
        "div",
        { class: `list-row skill-row${prof ? " prof" : ""}`, dataset: { help } },
        h("span", {}, icon ? h("i", { class: "row-icon" }, icon) : "", prof ? h("b", { class: "prof-dot", title: "geübt" }, "★") : "", label),
        h("strong", { class: `mod-pill ${modClass(value)}` }, signed(value)),
      );
    const saves = h("div", { class: "list" }, ...ABILITIES.map((a) => row(abilityName(a), sumParts(saveParts(me, a)), pc.saveProficiencies.includes(a), "rettungswurf", ABILITY_ICON[a])));
    const skills = h(
      "div",
      { class: "list" },
      ...SRD.skills.map((sk) => row(nameOf("skills", sk.id), sumParts(skillParts(me, sk.id)), pc.skillProficiencies.includes(sk.id), `fertigkeit:${sk.id}`, ABILITY_ICON[sk.ability])),
    );
    const features = [...new Set(pc.features)]
      .filter((f) => !f.startsWith("domain-spells-2"))
      .map((f) => h("button", { class: "chip", type: "button", textContent: nameOf("features", f), dataset: { help: `merkmal:${f}` }, onclick: () => openHelp(`merkmal:${f}`) }));
    const traits = pc.raceId ? SRD.races.find((r) => r.id === pc.raceId)!.traits.map((t) => h("button", { class: "chip", type: "button", textContent: nameOf("raceTraits", t), dataset: { help: `volksmerkmal:${t}` }, onclick: () => openHelp(`volksmerkmal:${t}`) })) : [];
    const out: HTMLElement[] = [
      h("section", { class: "card hero-card" }, hero, stats),
      h("section", { class: "card" }, h("div", { class: "card-title" }, "Attribute"), abilities, h("p", { class: "muted small" }, "Groß: was auf deine Würfe kommt. ⭐ = deine Stärken.")),
      h("section", { class: "card" }, h("div", { class: "card-title" }, "Rettungswürfe"), h("p", { class: "muted small" }, "★ = geübt, da bist du besonders gut"), saves),
      h("section", { class: "card" }, h("div", { class: "card-title" }, "Fertigkeiten"), h("p", { class: "muted small" }, "★ = geübt · Symbol = welches Attribut zählt"), skills),
      h("section", { class: "card" }, h("div", { class: "card-title" }, "Fähigkeiten"), h("div", { class: "chips" }, ...features, ...traits)),
    ];
    // Badges from the hero book (earned in earlier adventures).
    const badges = (pc.badges ?? []).map((id) => badgeById(id)).filter((b) => !!b);
    out.splice(
      2,
      0,
      h(
        "section",
        { class: "card" },
        h("div", { class: "card-title" }, `🏅 Abzeichen (${badges.length} von ${BADGES.length})`),
        badges.length
          ? h("div", { class: "badge-grid" }, ...badges.map((b) => h("button", { class: "badge", type: "button", title: b.how, onclick: () => showToast(`${b.icon} ${b.name}: ${b.how}`) }, h("span", {}, b.icon), h("small", {}, b.name))))
          : h("p", { class: "muted small" }, "Noch keine. Abzeichen gibt es am Ende eines Abenteuers – z. B. für den letzten Schlag, einen Drachen oder 10 kritische Treffer. Sie bleiben im Heldenbuch."),
      ),
    );
    if (pc.spells.length) {
      const slots = pc.spellSlotsMax.map((max, i) => h("span", { class: "pill", dataset: { help: "zauberplaetze" } }, `Grad ${i + 1}: ${pc.spellSlots[i]}/${max}`));
      out.push(
        h(
          "section",
          { class: "card" },
          h("div", { class: "card-title" }, "Zauber"),
          h("div", { class: "budget" }, ...slots),
          h("div", { class: "chips" }, ...pc.spells.map((s) => h("button", { class: "chip", type: "button", textContent: nameOf("spells", s), dataset: { help: `zauber:${s}` }, onclick: () => openHelp(`zauber:${s}`) }))),
        ),
      );
    }
    if (me.conditions.length || me.effects.length) {
      out.push(
        h(
          "section",
          { class: "card" },
          h("div", { class: "card-title" }, "Zustände"),
          h(
            "div",
            { class: "chips" },
            ...me.conditions.map((c) => h("button", { class: "chip warn", type: "button", textContent: nameOf("conditions", c.id), onclick: () => openHelp(`zustand:${c.id}`) })),
            ...me.effects.filter((e) => ["bless", "shield-of-faith", "divine-favor"].includes(e.id)).map((e) => h("button", { class: "chip good", type: "button", textContent: nameOf("spells", e.id), onclick: () => openHelp(`zauber:${e.id}`) })),
          ),
        ),
      );
    }
    return out;
  }

  // ---------------------------------------------------------------- inventory tab

  /** The tamed animal at the top of the hero sheet. */
  function companionCard(v: PlayerView): HTMLElement[] {
    const c = v.companion;
    if (!c) return [];
    const pct = Math.round(Math.max(0, c.hp / c.maxHp) * 100);
    return [
      h(
        "section",
        { class: `card companion-card${c.dead ? " fallen" : ""}`, dataset: { help: "begleiter" } },
        h("div", { class: "companion-head" }, h("span", { class: "companion-icon" }, c.dead ? "💔" : c.icon), h("div", {}, h("strong", {}, c.name), h("span", { class: "muted small" }, `${c.kind === "Katze" ? "Deine Katze" : `Dein ${c.kind}`}${c.dead ? " ist gefallen." : " · folgt dir und kämpft mit"}`))),
        c.dead ? null : h("div", { class: "hero-hp" }, h("span", { style: `width:${pct}%` }), h("em", {}, `❤️ ${c.hp} / ${c.maxHp}`)),
        h("p", { class: "companion-trait" }, `✨ ${c.trait}: ${c.traitText}`),
      ),
    ];
  }

  /** Brewing and tinkering: every recipe with its ingredients; always usable, costs no action. */
  function craftingCard(inventory: { itemId: string; qty: number }[]): HTMLElement {
    const have = (id: string) => inventory.find((i) => i.itemId === id)?.qty ?? 0;
    const rows = RECIPES.map((r) => {
      const ok = canCraft(r, inventory);
      const needs = Object.entries(r.needs).map(([id, n]) => h("span", { class: `need${have(id) >= n ? " got" : ""}` }, `${itemIcon(id)} ${n}× ${nameOf("items", id)} (${have(id)})`));
      const btn = h("button", { class: `btn small${ok ? " primary" : " secondary"}`, type: "button", textContent: "Herstellen", disabled: !ok });
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        send({ kind: "craft", recipe: r.id });
      });
      return h(
        "div",
        { class: `craft-row${ok ? " ready" : ""}`, dataset: { help: `gegenstand:${r.gives.itemId}` } },
        h("span", { class: "craft-icon" }, r.icon),
        h("div", { class: "craft-text" }, h("strong", {}, r.name), h("span", { class: "muted small" }, r.text), h("div", { class: "craft-needs" }, ...needs)),
        btn,
      );
    });
    return h(
      "section",
      { class: "card" },
      h("div", { class: "card-title", dataset: { help: "brauen" } }, "⚗️ Brauen & Basteln"),
      h("p", { class: "muted small" }, "Geht jederzeit – auch wenn du nicht dran bist – und kostet keine Aktion. Zutaten findest du an Kräutern, Pilzen, Spinnennetzen, Öllachen und Knochen."),
      h("div", { class: "list" }, ...rows),
    );
  }

  function renderInventoryTab(me: Creature, v: PlayerView): HTMLElement[] {
    const pc = me.pc!;
    const weapons = me.attacks
      .filter((a) => a.source === "weapon")
      .map((a) =>
        h(
          "div",
          { class: "list-row", dataset: { help: `waffe:${a.sourceId}` } },
          h("span", {}, a.magical && pc.gear?.weapon && getGear(pc.gear.weapon)?.base === a.sourceId ? `${getGear(pc.gear.weapon)!.icon} ${getGear(pc.gear.weapon)!.name}` : nameOf("weapons", a.sourceId)),
          h("strong", {}, `${signed(sumParts(a.toHit))} · ${a.damage[0]!.dice.replace("d", "W")}${sumParts(a.damageBonus) ? signed(sumParts(a.damageBonus)) : ""}`),
        ),
      );
    const armor = [
      pc.gear?.armor && getGear(pc.gear.armor)
        ? h("div", { class: "list-row", dataset: { help: "ausruestung" } }, h("span", {}, `${getGear(pc.gear.armor)!.icon} ${getGear(pc.gear.armor)!.name}`), h("strong", {}, "getragen"))
        : pc.armorId
          ? h("div", { class: "list-row", dataset: { help: `ruestung:${pc.armorId}` } }, h("span", {}, nameOf("armor", pc.armorId)), h("strong", {}, "getragen"))
          : null,
      pc.shield ? h("div", { class: "list-row", dataset: { help: "ruestung:shield" } }, h("span", {}, "Schild"), h("strong", {}, "+2 RK")) : null,
    ].filter((x): x is HTMLDivElement => !!x);
    // Items as big tiles; a tap shows what it is and what you can do with it.
    const items = pc.inventory
      .filter((i) => i.qty > 0)
      .map((i) => {
        const tile = h("button", { class: "item-tile", type: "button" }, h("span", { class: "item-icon" }, i.itemId === "gold" ? "💰" : itemIcon(i.itemId)), h("span", { class: "item-qty" }, `${i.qty}`), h("span", { class: "item-name" }, nameOf("items", i.itemId)));
        tile.addEventListener("click", () => {
          const use = v.choices.find((c) => (c.action.kind === "use_item" && c.action.itemId === i.itemId) || (i.itemId === "potion-of-healing" && c.id === "item:potion"));
          const useBtn = use ? h("button", { class: "btn primary big", type: "button", textContent: use.enabled ? `Benutzen: ${use.label}` : `Benutzen (${use.reason ?? "gerade nicht"})`, disabled: !use.enabled }) : null;
          useBtn?.addEventListener("click", () => {
            closeSheet();
            choose(use!);
          });
          const brew = RECIPES.filter((r) => i.itemId in r.needs);
          const info = h("button", { class: "btn secondary", type: "button", textContent: "❓ Was ist das?" });
          info.addEventListener("click", () => openHelp(`gegenstand:${i.itemId}`, true));
          showSheet(
            `${i.itemId === "gold" ? "💰" : itemIcon(i.itemId)} ${nameOf("items", i.itemId)} × ${i.qty}`,
            brew.length ? h("p", { class: "lead" }, `⚗️ Zutat für: ${brew.map((r) => `${r.icon} ${r.name}`).join(", ")} (unten im Taschen-Tab brauen)`) : null,
            useBtn,
            info,
          );
        });
        return tile;
      });
    // Found and bought equipment: wear, take off, hand over.
    const gear = pc.gear;
    const gearRows = (gear?.owned ?? []).map((id) => {
      const g = getGear(id);
      if (!g) return h("span", {});
      const worn = gear?.[g.slot] === id;
      const row = h(
        "div",
        { class: `gear-row${worn ? " worn" : ""}`, dataset: { help: "ausruestung" } },
        h("span", { class: "gear-icon" }, g.icon),
        h("div", { class: "gear-text" }, h("strong", {}, g.name), h("span", { class: "muted" }, `${g.detail}${worn ? " · angelegt" : ""}`)),
      );
      const buttons = h("div", { class: "gear-buttons" });
      const btn = (label: string, action: PlayerAction) => {
        const b = h("button", { class: "btn secondary small", type: "button", textContent: label });
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          send(action);
        });
        buttons.append(b);
      };
      if (worn) btn("Ablegen", { kind: "unequip", slot: g.slot });
      else btn("Anlegen", { kind: "equip", gearId: id });
      let giveList: HTMLElement | undefined;
      if (v.mode !== "combat" && v.party?.length) {
        const give = h("button", { class: "btn secondary small", type: "button", textContent: givingGear === id ? "Abbrechen" : "Weitergeben" });
        give.addEventListener("click", (e) => {
          e.stopPropagation();
          // Kept outside the page: new game states redraw the tab while you choose.
          givingGear = givingGear === id ? undefined : id;
          render();
        });
        buttons.append(give);
        if (givingGear === id) {
          giveList = h(
            "div",
            { class: "gear-give" },
            ...(v.party ?? []).map((p) => {
              const b = h("button", { class: "btn small", type: "button", textContent: `→ ${p.name}`, style: p.color ? `border-color:${p.color}` : "" });
              b.addEventListener("click", () => {
                givingGear = undefined;
                send({ kind: "give_gear", gearId: id, toId: p.id });
              });
              return b;
            }),
          );
        }
      }
      row.append(buttons);
      if (giveList) row.append(giveList);
      return row;
    });
    return [
      h(
        "section",
        { class: "card" },
        h("div", { class: "card-title", dataset: { help: "ausruestung" } }, "✨ Ausrüstung"),
        h("div", { class: "list" }, ...(gearRows.length ? gearRows : [h("p", { class: "muted" }, "Noch nichts Besonderes. Truhen, besiegte Anführer und fahrende Händler haben manchmal magische Waffen, Rüstungen und Schmuck.")])),
      ),
      h("section", { class: "card" }, h("div", { class: "card-title" }, "Waffen"), h("div", { class: "list" }, ...weapons)),
      h("section", { class: "card" }, h("div", { class: "card-title" }, "Rüstung"), h("div", { class: "list" }, ...(armor.length ? armor : [h("p", { class: "muted" }, "Keine Rüstung")]))),
      h("section", { class: "card" }, h("div", { class: "card-title" }, "🎒 Gegenstände", h("span", { class: "muted small" }, "Antippen für mehr")), h("div", { class: "item-grid" }, ...items)),
      craftingCard(pc.inventory),
    ];
  }

  // ---------------------------------------------------------------- tabs & render

  function renderTabs(): void {
    const mk = (id: Tab, label: string) => {
      const b = h("button", { class: `tab${tab === id ? " on" : ""}`, type: "button", textContent: label });
      b.addEventListener("click", () => {
        tab = id;
        render();
      });
      return b;
    };
    tabs.replaceChildren(mk("action", "⚔️ Aktion"), mk("sheet", "📋 Figur"), mk("inventory", "🎒 Taschen"), mk("clues", `🔎 Hinweise${view?.story?.clues.length ? ` (${view.story.clues.length})` : ""}`));
  }

  let lastChoiceKey = "";
  /** Equipment being handed over (the list of heroes is open). */
  let givingGear: string | undefined;

  function render(): void {
    if (!view) return;
    const me = view.me;
    renderHeader(me);
    renderStatus(view);
    renderTabs();
    const scroll = window.scrollY;
    const content = tab === "action" ? renderActionTab(view) : tab === "sheet" ? [...companionCard(view), ...renderSheetTab(me)] : tab === "inventory" ? renderInventoryTab(me, view) : renderCluesTab(view);
    // The same element again (campfire card): leave it in place, so typing is not interrupted.
    const same = content.length === body.childNodes.length && content.every((el, i) => body.childNodes[i] === el);
    if (!same) body.replaceChildren(...content);
    window.scrollTo(0, scroll);
    // A new decision for the group: bring it into view and buzz once.
    const choiceKey = (view.story?.choices ?? []).map((c) => c.id).join("|");
    if (choiceKey && choiceKey !== lastChoiceKey) {
      if ("vibrate" in navigator) navigator.vibrate([40, 40, 40]);
      if (tab === "action") body.querySelector(".story-choices")?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    lastChoiceKey = choiceKey;
    renderBottomBar(view);
    bigMapDraw?.();
    const pid = playerId();
    if (view.mode === "combat") maybeHint(pid, "first_fight", loadPrefs().tips, hintSlot);
    if (view.turn.mine) maybeHint(pid, "first_turn", loadPrefs().tips, hintSlot);
    if (view.minimap.creatures.some((c) => c.enemy)) maybeHint(pid, "first_enemy", loadPrefs().tips, hintSlot);
    const mm = view.minimap;
    const marks = mm.marks ?? "";
    if (marks.includes("f")) maybeHint(pid, "first_fire", loadPrefs().tips, hintSlot);
    if (view.mode === "combat" && marks.includes("c")) maybeHint(pid, "first_cover", loadPrefs().tips, hintSlot);
    if (view.turn.mine && mm.reachable.some((p) => "di".includes(marks[(p.y - mm.y0) * mm.w + (p.x - mm.x0)] ?? "."))) maybeHint(pid, "first_rough", loadPrefs().tips, hintSlot);
    if (view.choices.some((c) => c.action.kind === "interact" && "use" in c.action && c.action.use && c.enabled)) maybeHint(pid, "first_prop", loadPrefs().tips, hintSlot);
    if (me.hp === 0) maybeHint(pid, "first_down", loadPrefs().tips, hintSlot);
    else if (me.hp < me.maxHp) maybeHint(pid, "first_damage", loadPrefs().tips, hintSlot);
  }

  let goalShown = false;

  return {
    element: root,
    secret(text) {
      const pop = h("div", { class: "gain-pop goal" }, text);
      document.body.append(pop);
      setTimeout(() => pop.remove(), 5200);
      play("chime");
      if ("vibrate" in navigator) navigator.vibrate([60, 40, 60, 40, 60]);
    },
    setView(v) {
      // The secret goal is shown once, big, when it arrives.
      if (v.goal && !goalShown) {
        goalShown = true;
        const key = `couch-dungeon.goal:${v.me.id}:${v.goal.text}`;
        let seen = false;
        try {
          seen = !!sessionStorage.getItem(key);
          sessionStorage.setItem(key, "1");
        } catch {
          // ignore
        }
        if (!seen) showGoalIntro(v.goal);
      }
      // Next in line: a short buzz, so there is time to think.
      if (v.turn.nextUp && !wasNextUp && "vibrate" in navigator) navigator.vibrate(40);
      wasNextUp = !!v.turn.nextUp;
      // My turn begins: the queued move is ready – or it no longer works.
      if (v.turn.mine && !queueWasMine && queued) {
        if (queuedNow(v)) {
          if ("vibrate" in navigator) navigator.vibrate([40, 40, 40]);
        } else {
          showToast(`📌 „${queued.label}“ geht gerade nicht mehr – such dir etwas anderes aus.`);
          queued = undefined;
        }
      }
      queueWasMine = v.turn.mine;
      // "Zug automatisch beenden": the action is used up and no bonus action is left to use.
      const actedNow = v.turn.mine && lastActions > 0 && v.turn.actions <= 0;
      lastActions = v.turn.mine ? v.turn.actions : 0;
      if (actedNow && loadPrefs().autoEnd && !v.pendingRoll && !v.story?.choices.length) {
        const bonusLeft = v.choices.some((c) => c.enabled && c.cost === "bonus");
        if (!bonusLeft) {
          setTimeout(() => {
            const now = view;
            if (now?.turn.mine && now.turn.actions <= 0 && !now.pendingRoll) send({ kind: "end_turn" });
          }, 1800);
        }
      }
      const becameMine = v.turn.mine && !wasMine;
      wasMine = v.turn.mine;
      view = v;
      if (becameMine) {
        if ("vibrate" in navigator) navigator.vibrate([120, 80, 120]);
        tab = "action";
        window.scrollTo(0, 0);
        pulseTurn = true;
        setTimeout(() => {
          pulseTurn = false;
          status.classList.remove("pulse");
        }, 1600);
      }
      // A new state: an old walk plan may no longer fit.
      if (walkPlan && !v.minimap.reachable.some((q) => q.x === walkPlan!.to.x && q.y === walkPlan!.to.y)) walkPlan = undefined;
      render();
    },
    requestRoll(prompt) {
      if (diceFor === prompt.id || waitingPrompt?.id === prompt.id) return;
      const show = () => {
        if (waitingPrompt?.id !== prompt.id) return;
        waitingPrompt = undefined;
        landed?.close();
        landed = undefined;
        dice?.close();
        diceFor = prompt.id;
        dice = showRollPrompt(prompt, () => send({ kind: "roll", rollId: prompt.id }));
        if (view) maybeHint(playerId(), "first_roll", loadPrefs().tips, document.querySelector(".dice-panel") ?? body);
      };
      waitingPrompt = prompt;
      // Let the player see the result of the previous roll first.
      if (landed?.isOpen()) {
        landed.onClosed(show);
        setTimeout(show, 2500);
      } else show();
    },
    rulesAnswer(question, answer) {
      showRulesAnswer(question, answer);
    },
    recap(recap) {
      document.querySelector(".recap-sheet")?.remove();
      // The adventure is over: no die is waiting any more.
      waitingPrompt = undefined;
      dice?.close();
      landed?.close();
      dice = undefined;
      landed = undefined;
      const meId = view?.me.id;
      const heroes = new Map(recap.heroes.map((x) => [x.id, x]));
      const card = (hl: Recap["highlights"][number]) => {
        const hero = heroes.get(hl.heroId);
        return h(
          "div",
          { class: "highlight", style: `--player:${hero?.color ?? "#888"}` },
          hero?.look ? dollCanvas(hero.look, 2, "hl-doll") : h("span", {}),
          h("div", {}, h("strong", {}, `${hl.icon} ${hl.title}`), h("span", { class: "hl-name" }, hero?.name ?? ""), h("span", { class: "muted" }, hl.text)),
        );
      };
      const mine = recap.highlights.filter((x) => x.heroId === meId);
      const me = meId ? heroes.get(meId) : undefined;
      const share = h("button", { class: "btn primary big", type: "button", textContent: "📸 Bild teilen" });
      const close = h("button", { class: "btn big", type: "button", textContent: "Schließen" });
      const sheet = h(
        "div",
        { class: "recap-sheet" },
        h("h2", {}, `🌟 ${recap.ending.title}`),
        h("p", { class: "muted" }, `${recap.story} · ${recap.minutes} Minuten`),
        me
          ? h(
              "div",
              { class: "recap-mine" },
              h("strong", {}, `Deine Bilanz, ${me.name}`),
              h("p", {}, `⚔️ ${me.stats.damageDealt} Schaden · 💀 ${me.stats.kills} besiegt · 🎯 ${me.stats.crits} Volltreffer · 💚 ${me.stats.healing} geheilt · 💰 ${me.stats.gold} Gold`),
              ...mine.map(card),
            )
          : "",
        recap.badges?.length
          ? h(
              "div",
              { class: "recap-badges" },
              h("h2", {}, "🏅 Neue Abzeichen"),
              ...recap.badges.map((b) => h("p", { class: `goal-reveal done${b.heroId === meId ? " mine" : ""}`, style: `--player:${b.color}` }, `${b.icon} `, h("strong", {}, b.name), ` – ${b.title}: ${b.how}`)),
            )
          : "",
        recap.finalBlow
          ? h("div", { class: "recap-blow" }, h("h2", {}, `⚔️ Der letzte Schlag: ${recap.finalBlow.name}`), h("p", { class: "blow-quote" }, `„${recap.finalBlow.text}“`), recap.finalBlow.narration ? h("p", { class: "muted" }, recap.finalBlow.narration) : "")
          : "",
        recap.goals?.length
          ? h(
              "div",
              { class: "recap-goals" },
              h("h2", {}, "🤫 Die geheimen Ziele"),
              ...recap.goals.map((g) => h("p", { class: `goal-reveal${g.done ? " done" : ""}`, style: `--player:${g.color}` }, `${g.done ? "✅" : "❌"} ${g.icon} `, h("strong", {}, g.name), ` ${g.reveal}`)),
            )
          : "",
        h("h2", {}, "Die Highlights der Gruppe"),
        ...recap.highlights.map(card),
        recap.bestIdea ? h("p", { class: "muted" }, `🎭 Beste Idee: „${recap.bestIdea}“`) : "",
        share,
        close,
      );
      share.addEventListener("click", () => void shareRecap(recap).then((how) => showToast(how === "shared" ? "Geteilt!" : "Bild gespeichert.")));
      close.addEventListener("click", () => sheet.remove());
      document.body.append(sheet);
      if ("vibrate" in navigator) navigator.vibrate([60, 40, 60, 40, 120]);
    },
    suggestions(ideas) {
      const box = ideasBox;
      const input = ideaInput;
      if (!box || !input || !box.isConnected) return;
      if (!ideas.length) {
        box.replaceChildren(h("p", { class: "lead" }, "Gerade fällt dem Spielleiter nichts ein. Probier es einfach aus!"));
        return;
      }
      box.replaceChildren(
        ...ideas.map((idea) => {
          const chip = h("button", { class: "idea-chip", type: "button", textContent: idea });
          chip.addEventListener("click", () => {
            input.value = idea;
            input.focus();
          });
          return chip;
        }),
      );
    },
    freeTextOptions(text, options, note) {
      const buttons = options.map((o) => {
        const b = h("button", { class: "choice-btn", type: "button" }, h("span", { class: "choice-label" }, o.label), h("span", { class: "choice-detail" }, o.detail));
        b.addEventListener("click", () => {
          closeSheet();
          if ("vibrate" in navigator) navigator.vibrate(12);
          send(o.action);
        });
        return b;
      });
      const no = h("button", { class: "btn secondary", type: "button", textContent: "✖ Nein, etwas anderes" });
      no.addEventListener("click", () => closeSheet());
      showSheet(note ? "💡 Geht so nicht – aber:" : "🤔 Meinst du …?", h("p", { class: "muted small" }, `„${text}“`), ...(note ? [h("p", { class: "lead" }, note)] : []), h("div", { class: "targets" }, ...buttons), no);
    },
    rollResult(result) {
      if (dice && result.playerId === playerId()) {
        dice.land(result);
        landed = dice;
        dice = undefined;
        diceFor = undefined;
      }
    },
    error(reason) {
      showToast(reason);
    },
    reward(r) {
      if (r.kind === "gold" || r.kind === "item") {
        // Small things: a shiny number rises under the header.
        const pop = h("div", { class: `gain-pop ${r.kind}` }, r.kind === "gold" ? `💰 +${r.amount} Gold` : `${r.icon} +${r.qty} ${r.title}`);
        document.body.append(pop);
        setTimeout(() => pop.remove(), 2600);
        play(r.kind === "gold" ? "coin" : "pop");
        return;
      }
      showReward(r);
    },
  };

  function showGoalIntro(g: NonNullable<PlayerView["goal"]>): void {
    const ok = h("button", { class: "btn primary big", type: "button", textContent: "Psst, verstanden 🤫" });
    const sheet = h(
      "div",
      { class: "reward-sheet" },
      h(
        "div",
        { class: "reward-card goal-intro" },
        h("div", { class: "reward-burst" }, "🤫"),
        h("h2", {}, "Dein geheimes Ziel"),
        h("div", { class: "goal-big" }, h("span", {}, g.icon), h("strong", {}, g.text)),
        h("p", { class: "reward-sub" }, "Verrate es niemandem! Am Ende wird aufgedeckt – schaffst du es, gibt es 25 Gold. Du findest es jederzeit im Tab „Hinweise“."),
        ok,
      ),
    );
    ok.addEventListener("click", () => sheet.remove());
    document.body.append(sheet);
    if ("vibrate" in navigator) navigator.vibrate([40, 30, 40]);
  }

  /** The big moments: a new level (what got better) or a piece of equipment. */
  function showReward(r: Extract<Reward, { kind: "level" | "gear" }>): void {
    // A roll result is still open: the news come together once it is closed (one "Weiter" for all).
    const open = landed?.isOpen() ? landed : dice?.isOpen() ? dice : undefined;
    if (open) {
      rewardQueue.push(r);
      if (rewardQueue.length === 1) open.onClosed(() => rewardQueue.splice(0).forEach(addRewardCard));
      return;
    }
    addRewardCard(r);
  }

  /** Adds a card to the open reward window, or opens one. */
  function addRewardCard(r: Extract<Reward, { kind: "level" | "gear" }>): void {
    if (!rewardBox?.sheet.isConnected) {
      const ok = h("button", { class: "btn primary big reward-ok", type: "button", textContent: "Super! 🎉" });
      const stack = h("div", { class: "reward-stack" });
      const sheet = h("div", { class: "reward-sheet" }, h("div", { class: "reward-bundle" }, stack, ok));
      ok.addEventListener("click", () => {
        sheet.remove();
        rewardBox = undefined;
      });
      document.body.append(sheet);
      rewardBox = { sheet, stack, ok, count: 0 };
    }
    const box = rewardBox!;
    const body: (HTMLElement | string)[] = [];
    if (r.kind === "level") {
      body.push(
        h("div", { class: "reward-burst" }, "⬆️"),
        h("h2", {}, `Stufe ${r.level}!`),
        h("p", { class: "reward-sub" }, `${r.name} ist stärker geworden.`),
        h(
          "div",
          { class: "gain-list" },
          ...r.gains.map((g) =>
            h(
              "button",
              { class: "gain-row", type: "button", onclick: () => g.glossarKey && openHelp(g.glossarKey) },
              h("span", { class: "gain-icon" }, g.icon),
              h("span", { class: "gain-label" }, g.label),
              h("span", { class: "gain-from" }, g.from),
              h("span", { class: "gain-arrow" }, "➜"),
              h("strong", { class: "gain-to" }, g.to),
            ),
          ),
        ),
      );
      const news = [...r.features, ...r.spells];
      if (news.length) {
        body.push(
          h("p", { class: "reward-new" }, "✨ Neu gelernt – antippen für die Erklärung:"),
          h("div", { class: "chips" }, ...news.map((f) => h("button", { class: "chip good", type: "button", textContent: f.name, onclick: () => openHelp(f.key) }))),
        );
      }
    } else {
      const look = h("button", { class: "btn big", type: "button", textContent: "🎒 In den Taschen ansehen" });
      look.addEventListener("click", () => {
        box.sheet.remove();
        rewardBox = undefined;
        tab = "inventory";
        render();
      });
      body.push(
        h("div", { class: "reward-burst gear" }, r.icon),
        h("p", { class: "reward-sub" }, r.how),
        h("h2", {}, r.title),
        h("p", { class: "reward-detail" }, r.detail),
        look,
      );
    }
    box.stack.append(h("div", { class: "reward-card" }, h("div", { class: "reward-rays" }), ...body));
    box.count++;
    box.ok.textContent = box.count > 1 ? `Super! 🎉 (${box.count} Neuigkeiten)` : "Super! 🎉";
    play(r.kind === "level" ? "victory" : "chime");
    if ("vibrate" in navigator) navigator.vibrate(r.kind === "level" ? [80, 50, 80, 50, 200] : [60, 40, 120]);
  }
}
