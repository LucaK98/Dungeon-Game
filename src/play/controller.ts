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
import type { ActionChoice, ActionGroup, CampView, PlayerView, RollOutcome, RollPrompt } from "../shared/view";
import { dollCanvas } from "../ui/atlas";
import { h } from "../ui/dom";
import { showRollPrompt, type DiceOverlay } from "./dice";
import { closeSheet, explainedLine, helpButton, maybeHint, openHelp, showRulesAnswer, showSheet } from "./help";
import { minimapLegend, minimapView } from "./minimap";
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
  const openGroups = new Set<ActionGroup>(["attack"]);
  const closedGroups = new Set<ActionGroup>();

  const root = h("div", { class: "controller" });
  const header = h("header", { class: "ctl-head" });
  const status = h("div", { class: "ctl-status" });
  const body = h("main", { class: "ctl-body" });
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
  root.append(header, status, body, tabs, toast, emoteRow, emoteBtn);

  const help = helpButton({
    view: () => view,
    setBeginnerMode: (on) => send({ kind: "set_beginner_mode", on }),
    askRules: (question) => send({ kind: "ask_rules", question }),
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

  function renderStatus(v: PlayerView): void {
    if (!v.turn.mine) {
      status.className = "ctl-status waiting";
      status.style.setProperty("--player", v.turn.activeColor ?? "#888");
      status.replaceChildren(h("span", {}, "⏳ "), h("strong", {}, v.turn.activeName), h("span", {}, " ist dran"), renderOrder(v) ?? "");
      return;
    }
    status.className = "ctl-status mine";
    const fields = Math.floor(v.turn.movementLeftFt / 5);
    if (v.turn.free) {
      // Exploring: no turns, everyone acts whenever they like.
      status.replaceChildren(
        h("strong", {}, "🧭 Freies Erkunden"),
        h("div", { class: "budget" }, h("span", { class: "pill", dataset: { help: "bewegung" } }, `🦶 bis ${fields} Felder pro Schritt`), h("span", { class: "pill" }, "Alle gleichzeitig")),
      );
      return;
    }
    status.replaceChildren(
      h("strong", {}, "🎯 Du bist dran!"),
      h(
        "div",
        { class: "budget" },
        h("span", { class: `pill${fields ? "" : " used"}`, dataset: { help: "bewegung" } }, `🦶 ${fields} ${fields === 1 ? "Feld" : "Felder"}`),
        h("span", { class: `pill${v.turn.actions ? "" : " used"}`, dataset: { help: "aktion" } }, `Aktion ${v.turn.actions ? "✓" : "✗"}`),
        h("span", { class: `pill${v.turn.bonusAction ? "" : " used"}`, dataset: { help: "bonusaktion" } }, `Bonus ${v.turn.bonusAction ? "✓" : "✗"}`),
      ),
      renderOrder(v) ?? "",
    );
  }

  // ---------------------------------------------------------------- action tab

  function choose(c: ActionChoice): void {
    if (!c.enabled) {
      showToast(c.reason ?? "Das geht gerade nicht.");
      return;
    }
    if (c.action.kind === "free_text") return freeText();
    if (c.action.kind === "cast" && view) maybeHint(playerId(), "first_spell", view.beginnerMode, body);
    if (c.targets && !(c.action.kind === "cast" && c.action.targetIds.length)) return pickTargets(c);
    send(c.action);
  }

  function withTargets(c: ActionChoice, ids: string[]): PlayerAction {
    const a = c.action;
    switch (a.kind) {
      case "attack":
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

  function pickTargets(c: ActionChoice): void {
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
          send(withTargets(c, [t.id]));
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
      send(withTargets(c, chosen));
    });
    counter();
    const note =
      pick.max > 1 ? h("p", { class: "lead" }, pick.repeat ? `Verteile ${pick.max} Geschosse: tippe ein Ziel mehrmals an.` : `Wähle bis zu ${pick.max} Ziele.`) : null;
    showSheet(`${c.label}: Ziel wählen`, note, h("div", { class: "targets" }, ...buttons), pick.max > 1 ? confirm : null);
  }

  let ideasBox: HTMLElement | undefined;
  let ideaInput: HTMLTextAreaElement | undefined;

  function freeText(): void {
    const fighting = view?.mode === "combat";
    const input = h("textarea", {
      class: "text-input",
      rows: 3,
      placeholder: fighting ? "z. B. Ich werfe dem Räuber Sand in die Augen." : "z. B. Ich biete dem Oger Brot an, damit er uns vorbeilässt.",
    }) as HTMLTextAreaElement;
    const go = h("button", { class: "btn primary big", type: "button", textContent: "Absenden" });
    go.addEventListener("click", () => {
      const text = input.value.trim();
      if (!text) return;
      closeSheet();
      ideasBox = undefined;
      send({ kind: "free_text", text });
    });
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
    showSheet("Freie Aktion", h("p", { class: "lead" }, "Beschreibe mit eigenen Worten, was deine Figur tun will."), cost, input, tools, box, go);
    queueMicrotask(() => input.focus());
  }

  function choiceButton(c: ActionChoice): HTMLElement {
    const b = h(
      "button",
      { class: `choice-btn${c.enabled ? "" : " disabled"}${c.recommended ? " recommended" : ""}${c.votes?.mine ? " voted" : ""}`, type: "button", dataset: { help: c.glossarKey } },
      h("span", { class: "choice-label" }, c.label, c.recommended ? h("span", { class: "rec" }, "⭐ Empfohlen") : null),
      h("span", { class: "choice-detail" }, c.enabled ? c.detail : (c.reason ?? c.detail)),
      c.votes
        ? h(
            "span",
            { class: "vote-line" },
            c.votes.mine ? h("strong", { class: "vote-mine" }, "✔ Deine Stimme") : "",
            c.votes.names.length ? `🗳️ ${c.votes.names.join(", ")}` : "",
          )
        : null,
      c.cost !== "free" ? h("span", { class: `cost cost-${c.cost}` }, c.cost === "bonus" ? "Bonus" : "Aktion") : null,
    );
    b.addEventListener("click", () => choose(c));
    return b;
  }

  function renderStory(v: PlayerView): HTMLElement[] {
    const st = v.story;
    if (!st) return [];
    const out: HTMLElement[] = [];
    const last = st.narration.slice(-3);
    out.push(
      h(
        "section",
        { class: "card st-card" },
        h("div", { class: "st-chapter" }, st.chapter),
        h("strong", { class: "st-scene" }, st.scene),
        h("div", { class: "st-goal" }, `🎯 Ziel: ${st.goal}`),
        ...last.map((l) =>
          h(
            "p",
            { class: l.npc ? "st-line npc" : "st-line" },
            l.npc ? h("strong", {}, `${l.npc}: `) : "",
            l.text,
            l.tip && v.beginnerMode ? h("span", { class: "st-tip", dataset: { help: l.tip.key } }, `💡 ${l.tip.text}`) : "",
          ),
        ),
      ),
    );
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

  function renderActionTab(v: PlayerView): HTMLElement[] {
    if (v.finalBlow) return [finalBlowSection(v.finalBlow.boss)];
    blowCard = undefined;
    if (v.camp) return [campSection(v.camp)];
    campCard = undefined;
    const out: HTMLElement[] = [...renderStory(v)];
    const map = minimapView(v.minimap, (to) => send({ kind: "move", to }));
    out.push(
      h(
        "section",
        { class: "card map-card" },
        h("div", { class: "card-title" }, h("span", {}, `📍 ${v.roomName}`), v.turn.mine && v.minimap.reachable.length ? h("span", { class: "muted" }, "Tippe auf ein helles Feld") : null),
        map,
        minimapLegend(v.minimap),
      ),
    );
    const groups: ActionGroup[] = ["attack", "spell", "item", "ability", "look"];
    for (const g of groups) {
      const list = v.choices.filter((c) => c.group === g);
      if (!list.length) continue;
      const enabled = list.filter((c) => c.enabled).length;
      const recommended = list.some((c) => c.recommended);
      const open = openGroups.has(g) || (recommended && !closedGroups.has(g));
      const head = h("button", { class: "group-head", type: "button" }, h("span", {}, GROUP_TITLES[g]), h("span", { class: "muted" }, `${enabled}/${list.length} ${open ? "▲" : "▼"}`));
      const content = h("div", { class: "group-body", hidden: !open }, ...list.map(choiceButton));
      head.addEventListener("click", () => {
        content.hidden = !content.hidden;
        if (content.hidden) {
          openGroups.delete(g);
          closedGroups.add(g);
        } else {
          openGroups.add(g);
          closedGroups.delete(g);
        }
      });
      out.push(h("section", { class: "group" }, head, content));
    }
    const free = v.choices.find((c) => c.id === "free");
    const end = v.choices.find((c) => c.id === "end");
    const bottom = h("div", { class: "row" });
    if (free) {
      const b = h("button", { class: "btn secondary", type: "button", textContent: "✍️ Freie Aktion", dataset: { help: "freie_aktion" }, disabled: !free.enabled });
      b.addEventListener("click", () => choose(free));
      bottom.append(b);
    }
    if (end) {
      const b = h("button", { class: "btn primary", type: "button", textContent: "✅ Zug beenden", dataset: { help: "zug_beenden" }, disabled: !end.enabled });
      b.addEventListener("click", () => choose(end));
      bottom.append(b);
    }
    out.push(bottom);
    if (v.log.length) {
      out.push(h("section", { class: "card log" }, h("div", { class: "card-title" }, "📜 Was ist passiert?"), ...v.log.slice(-8).map((l) => explainedLine(l))));
    }
    return out;
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
    const items = pc.inventory.map((i) => {
      const row = h("div", { class: "list-row", dataset: { help: `gegenstand:${i.itemId}` } }, h("span", {}, `${i.itemId === "gold" ? "💰" : itemIcon(i.itemId)} ${nameOf("items", i.itemId)}`), h("strong", {}, `× ${i.qty}`));
      if (i.itemId === "potion-of-healing") {
        const choice = v.choices.find((c) => c.id === "item:potion");
        if (choice) {
          const use = h("button", { class: "btn secondary small", type: "button", textContent: "Trinken / geben" });
          use.addEventListener("click", (e) => {
            e.stopPropagation();
            choose(choice);
          });
          row.append(use);
        }
      }
      return row;
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
      h("section", { class: "card" }, h("div", { class: "card-title" }, "Gegenstände"), h("div", { class: "list" }, ...items)),
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
    const pid = playerId();
    if (view.mode === "combat") maybeHint(pid, "first_fight", view.beginnerMode, body);
    if (view.turn.mine) maybeHint(pid, "first_turn", view.beginnerMode, body);
    if (view.minimap.creatures.some((c) => c.enemy)) maybeHint(pid, "first_enemy", view.beginnerMode, body);
    const mm = view.minimap;
    const marks = mm.marks ?? "";
    if (marks.includes("f")) maybeHint(pid, "first_fire", view.beginnerMode, body);
    if (view.mode === "combat" && marks.includes("c")) maybeHint(pid, "first_cover", view.beginnerMode, body);
    if (view.turn.mine && mm.reachable.some((p) => "di".includes(marks[(p.y - mm.y0) * mm.w + (p.x - mm.x0)] ?? "."))) maybeHint(pid, "first_rough", view.beginnerMode, body);
    if (view.choices.some((c) => c.action.kind === "interact" && "use" in c.action && c.action.use && c.enabled)) maybeHint(pid, "first_prop", view.beginnerMode, body);
    if (me.hp === 0) maybeHint(pid, "first_down", view.beginnerMode, body);
    else if (me.hp < me.maxHp) maybeHint(pid, "first_damage", view.beginnerMode, body);
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
      const becameMine = v.turn.mine && !wasMine;
      wasMine = v.turn.mine;
      view = v;
      if (becameMine) {
        if ("vibrate" in navigator) navigator.vibrate([120, 80, 120]);
        tab = "action";
        window.scrollTo(0, 0);
      }
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
        if (view) maybeHint(playerId(), "first_roll", view.beginnerMode, document.querySelector(".dice-panel") ?? body);
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
    document.querySelector(".reward-sheet")?.remove();
    const ok = h("button", { class: "btn primary big", type: "button", textContent: "Super! 🎉" });
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
        sheet.remove();
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
    const sheet = h("div", { class: "reward-sheet" }, h("div", { class: "reward-card" }, h("div", { class: "reward-rays" }), ...body, ok));
    ok.addEventListener("click", () => sheet.remove());
    document.body.append(sheet);
    play(r.kind === "level" ? "victory" : "chime");
    if ("vibrate" in navigator) navigator.vibrate(r.kind === "level" ? [80, 50, 80, 50, 200] : [60, 40, 120]);
  }
}
