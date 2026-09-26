/**
 * Dice on the phone: the player taps, the die tumbles, and it lands on the value the TV rolled.
 */
import { h } from "../ui/dom";
import type { RollOutcome, RollPrompt } from "../shared/view";
import { explainedLine, term } from "./help";

const SHAPES: Record<number, string> = {
  4: "50,6 95,88 5,88",
  6: "12,12 88,12 88,88 12,88",
  8: "50,4 94,50 50,96 6,50",
  10: "50,4 94,40 76,94 24,94 6,40",
  12: "50,4 90,26 90,74 50,96 10,74 10,26",
  20: "50,3 93,27 93,73 50,97 7,73 7,27",
};

function dieSvg(sides: number, value: string, state: "idle" | "rolling" | "done" | "good" | "bad" | "crit"): HTMLElement {
  const wrap = h("div", { class: `die die-${state}` });
  wrap.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="${SHAPES[sides] ?? SHAPES[20]}"/></svg><span class="die-value">${value}</span><span class="die-sides">W${sides}</span>`;
  return wrap;
}

export interface DiceOverlay {
  /** The TV sent the result for this roll. */
  land(result: RollOutcome): void;
  close(): void;
}

/** Shows the roll screen. `onRoll` is called when the player taps the die. */
export function showRollPrompt(prompt: RollPrompt, onRoll: () => void): DiceOverlay {
  const title = h("h2", {}, prompt.title);
  const hint = h("p", { class: "lead" }, "Tippe auf den Würfel!");
  const stage = h("div", { class: "dice-stage" }, dieSvg(prompt.sides, "?", "idle"));
  const lines = h("div", { class: "dice-lines" });
  const done = h("button", { class: "btn primary big", type: "button", textContent: "Weiter", hidden: true });
  const panel = h("div", { class: "dice-panel" }, title, h("p", { class: "dice-term" }, term(`W${prompt.sides}`, `w${prompt.sides}`)), stage, hint, lines, done);
  const overlay = h("div", { class: "dice-overlay" }, panel);
  document.body.append(overlay);

  let rolling: ReturnType<typeof setInterval> | undefined;
  let rolled = false;
  let pendingResult: RollOutcome | undefined;
  let started = 0;

  const showResult = (r: RollOutcome) => {
    if (rolling) clearInterval(rolling);
    rolling = undefined;
    const state = r.crit ? "crit" : r.success === true ? "good" : r.success === false ? "bad" : "done";
    const dice = r.dice.length ? r.dice : [r.kept];
    stage.replaceChildren(
      ...dice.map((v, i) => {
        const el = dieSvg(r.sides, String(v), dice.length > 1 && v !== r.kept ? "done" : state);
        if (dice.length > 1 && v !== r.kept && i >= 0) el.classList.add("die-dropped");
        return el;
      }),
    );
    hint.textContent = r.crit ? "🎉 Kritischer Treffer!" : r.success === true ? "Geschafft!" : r.success === false ? "Leider nicht geschafft." : "";
    lines.replaceChildren(...r.lines.map((l) => explainedLine(l)));
    done.hidden = false;
    if (r.crit && "vibrate" in navigator) navigator.vibrate([80, 60, 160]);
  };

  stage.addEventListener("click", () => {
    if (rolled) return;
    rolled = true;
    started = Date.now();
    hint.textContent = "Rollt …";
    rolling = setInterval(() => {
      stage.replaceChildren(dieSvg(prompt.sides, String(1 + Math.floor(Math.random() * prompt.sides)), "rolling"));
    }, 70);
    if ("vibrate" in navigator) navigator.vibrate(30);
    onRoll();
  });

  const api: DiceOverlay = {
    land(result) {
      // Let the die tumble for at least 0.8 s, it feels better.
      pendingResult = result;
      const wait = Math.max(0, 800 - (Date.now() - started));
      setTimeout(() => pendingResult && showResult(pendingResult), rolled ? wait : 0);
    },
    close() {
      if (rolling) clearInterval(rolling);
      overlay.remove();
    },
  };
  done.addEventListener("click", api.close);
  return api;
}

/** Result of a roll that needed no tap (e.g. someone else rolled): small card. */
export function resultCard(r: RollOutcome): HTMLElement {
  return h("div", { class: "result-card" }, h("strong", {}, r.title), ...r.lines.map((l) => explainedLine(l)));
}
