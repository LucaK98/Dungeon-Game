/**
 * The phone as game controller: turn status, map, actions, character sheet and inventory.
 */
import { abilityMod, saveParts, skillParts, sumParts } from "../engine/core";
import { SRD } from "../engine/data";
import { abilityName, abilityShort, nameOf } from "../engine/names";
import { armorClass } from "../engine/combat";
import type { PlayerAction } from "../shared/events";
import type { Creature } from "../shared/game";
import { ABILITIES } from "../shared/rules";
import type { ActionChoice, ActionGroup, PlayerView, RollOutcome, RollPrompt } from "../shared/view";
import { dollCanvas } from "../ui/atlas";
import { h } from "../ui/dom";
import { showRollPrompt, type DiceOverlay } from "./dice";
import { closeSheet, explainedLine, helpButton, maybeHint, openHelp, showRulesAnswer, showSheet } from "./help";
import { minimapView } from "./minimap";
import { ABILITY_GLOSSAR } from "../engine/core";

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
}

/** Browser speech recognition (Chrome/Safari/Edge), if available. */
type SpeechRec = { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start(): void; stop(): void };
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
  root.append(header, status, body, tabs, toast);

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
    const Rec = speechRecognition();
    if (Rec) {
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
      tools.append(mic);
    }
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
      { class: `choice-btn${c.enabled ? "" : " disabled"}${c.recommended ? " recommended" : ""}`, type: "button", dataset: { help: c.glossarKey } },
      h("span", { class: "choice-label" }, c.label, c.recommended ? h("span", { class: "rec" }, "⭐ Empfohlen") : null),
      h("span", { class: "choice-detail" }, c.enabled ? c.detail : (c.reason ?? c.detail)),
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
          h("div", { class: "group-head static" }, h("span", {}, "📖 Wie geht es weiter?"), h("span", { class: "muted" }, "Besprecht euch!")),
          h("div", { class: "group-body" }, ...st.choices.map(choiceButton)),
        ),
      );
    }
    return out;
  }

  function renderCluesTab(v: PlayerView): HTMLElement[] {
    const clues = v.story?.clues ?? [];
    return [
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

  function renderActionTab(v: PlayerView): HTMLElement[] {
    const out: HTMLElement[] = [...renderStory(v)];
    const map = minimapView(v.minimap, (to) => send({ kind: "move", to }));
    out.push(
      h(
        "section",
        { class: "card map-card" },
        h("div", { class: "card-title" }, h("span", {}, `📍 ${v.roomName}`), v.turn.mine && v.minimap.reachable.length ? h("span", { class: "muted" }, "Tippe auf ein helles Feld") : null),
        map,
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
    const abilities = h(
      "div",
      { class: "abilities" },
      ...ABILITIES.map((a) =>
        h(
          "div",
          { class: "ability", dataset: { help: ABILITY_GLOSSAR[a] } },
          h("span", { class: "ab-short" }, abilityShort(a)),
          h("strong", {}, signed(abilityMod(me.abilities[a]))),
          h("span", { class: "ab-score" }, String(me.abilities[a])),
        ),
      ),
    );
    const stat = (label: string, value: string, key: string) => h("div", { class: "stat", dataset: { help: key } }, h("span", {}, label), h("strong", {}, value));
    const stats = h(
      "div",
      { class: "stats" },
      stat("Rüstungsklasse", String(armorClass(me)), "ruestungsklasse"),
      stat("Trefferpunkte", `${me.hp}/${me.maxHp}`, "trefferpunkte"),
      stat("Bewegung", `${me.speedFt / 5} Felder`, "bewegung"),
      stat("Übungsbonus", signed(me.proficiencyBonus), "uebungsbonus"),
      stat("Initiative", signed(abilityMod(me.abilities.DEX)), "initiative"),
      stat("Volk", nameOf("races", pc.raceId), `volk:${pc.raceId}`),
    );
    const saves = h(
      "div",
      { class: "list" },
      ...ABILITIES.map((a) => {
        const prof = pc.saveProficiencies.includes(a);
        return h("div", { class: `list-row${prof ? " prof" : ""}`, dataset: { help: "rettungswurf" } }, h("span", {}, `${prof ? "★ " : ""}${abilityName(a)}`), h("strong", {}, signed(sumParts(saveParts(me, a)))));
      }),
    );
    const skills = h(
      "div",
      { class: "list" },
      ...SRD.skills.map((s) => {
        const prof = pc.skillProficiencies.includes(s.id);
        return h("div", { class: `list-row${prof ? " prof" : ""}`, dataset: { help: `fertigkeit:${s.id}` } }, h("span", {}, `${prof ? "★ " : ""}${nameOf("skills", s.id)}`), h("strong", {}, signed(sumParts(skillParts(me, s.id)))));
      }),
    );
    const features = [...new Set(pc.features)]
      .filter((f) => !f.startsWith("domain-spells-2"))
      .map((f) => h("button", { class: "chip", type: "button", textContent: nameOf("features", f), dataset: { help: `merkmal:${f}` }, onclick: () => openHelp(`merkmal:${f}`) }));
    const traits = pc.raceId ? SRD.races.find((r) => r.id === pc.raceId)!.traits.map((t) => h("button", { class: "chip", type: "button", textContent: nameOf("raceTraits", t), dataset: { help: `volksmerkmal:${t}` }, onclick: () => openHelp(`volksmerkmal:${t}`) })) : [];
    const out: HTMLElement[] = [
      h("section", { class: "card" }, h("div", { class: "card-title" }, "Attribute"), abilities, h("p", { class: "muted small" }, "Groß: der Modifikator, der auf Würfe kommt. Klein: der Attributswert.")),
      h("section", { class: "card" }, stats),
      h("section", { class: "card" }, h("div", { class: "card-title" }, "Rettungswürfe (★ = geübt)"), saves),
      h("section", { class: "card" }, h("div", { class: "card-title" }, "Fertigkeiten (★ = geübt)"), skills),
      h("section", { class: "card" }, h("div", { class: "card-title" }, "Fähigkeiten"), h("div", { class: "chips" }, ...features, ...traits)),
    ];
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

  function renderInventoryTab(me: Creature, v: PlayerView): HTMLElement[] {
    const pc = me.pc!;
    const weapons = me.attacks
      .filter((a) => a.source === "weapon")
      .map((a) =>
        h(
          "div",
          { class: "list-row", dataset: { help: `waffe:${a.sourceId}` } },
          h("span", {}, nameOf("weapons", a.sourceId)),
          h("strong", {}, `${signed(sumParts(a.toHit))} · ${a.damage[0]!.dice.replace("d", "W")}${sumParts(a.damageBonus) ? signed(sumParts(a.damageBonus)) : ""}`),
        ),
      );
    const armor = [
      pc.armorId ? h("div", { class: "list-row", dataset: { help: `ruestung:${pc.armorId}` } }, h("span", {}, nameOf("armor", pc.armorId)), h("strong", {}, "getragen")) : null,
      pc.shield ? h("div", { class: "list-row", dataset: { help: "ruestung:shield" } }, h("span", {}, "Schild"), h("strong", {}, "+2 RK")) : null,
    ].filter((x): x is HTMLDivElement => !!x);
    const items = pc.inventory.map((i) => {
      const row = h("div", { class: "list-row", dataset: { help: `gegenstand:${i.itemId}` } }, h("span", {}, nameOf("items", i.itemId)), h("strong", {}, `× ${i.qty}`));
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
    return [
      h("section", { class: "card" }, h("div", { class: "card-title" }, "Waffen"), h("div", { class: "list" }, ...weapons)),
      h("section", { class: "card" }, h("div", { class: "card-title" }, "Rüstung"), h("div", { class: "list" }, ...(armor.length ? armor : [h("p", { class: "muted" }, "Keine Rüstung")]))),
      h("section", { class: "card" }, h("div", { class: "card-title" }, "Gegenstände"), h("div", { class: "list" }, ...items)),
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

  function render(): void {
    if (!view) return;
    const me = view.me;
    renderHeader(me);
    renderStatus(view);
    renderTabs();
    const scroll = window.scrollY;
    body.replaceChildren(...(tab === "action" ? renderActionTab(view) : tab === "sheet" ? renderSheetTab(me) : tab === "inventory" ? renderInventoryTab(me, view) : renderCluesTab(view)));
    window.scrollTo(0, scroll);
    const pid = playerId();
    if (view.mode === "combat") maybeHint(pid, "first_fight", view.beginnerMode, body);
    if (view.turn.mine) maybeHint(pid, "first_turn", view.beginnerMode, body);
    if (view.minimap.creatures.some((c) => c.enemy)) maybeHint(pid, "first_enemy", view.beginnerMode, body);
    if (me.hp === 0) maybeHint(pid, "first_down", view.beginnerMode, body);
    else if (me.hp < me.maxHp) maybeHint(pid, "first_damage", view.beginnerMode, body);
  }

  return {
    element: root,
    setView(v) {
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
  };
}
