/**
 * Dice on the phone: the player taps, the die tumbles, and it lands on the value the TV rolled.
 */
import { play } from "../ui/sound";
import { h } from "../ui/dom";
import type { RollOutcome, RollPrompt } from "../shared/view";
import { explainedLine, term } from "./help";
import { BULLET_ICON, type Bullet } from "../shared/bullets";
import { loadPrefs } from "./prefs";

/** Coloured points: damage red, healing green, conditions yellow, protection blue. */
export function bulletList(bullets: Bullet[]): HTMLElement {
  return h("ul", { class: "bullets" }, ...bullets.map((b) => h("li", { class: `bullet ${b.tone}` }, h("span", { class: "bullet-icon" }, BULLET_ICON[b.tone]), b.text)));
}

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
  isOpen(): boolean;
  /** Called once when the window closes (tap on "Weiter" or close()). */
  onClosed(cb: () => void): void;
}

/** Shows the roll screen. `onRoll` is called when the player taps the die. */
export function showRollPrompt(prompt: RollPrompt, onRoll: () => void): DiceOverlay {
  const title = h("h2", {}, prompt.title);
  const shake = loadPrefs().shake && "DeviceMotionEvent" in window;
  const hint = h("p", { class: "lead" }, shake ? "Tippe auf den Würfel – oder schüttle das Handy!" : "Tippe auf den Würfel!");
  const stage = h("div", { class: "dice-stage" }, dieSvg(prompt.sides, "?", "idle"));
  const lines = h("div", { class: "dice-lines" });
  const done = h("button", { class: "btn primary big", type: "button", textContent: "Weiter", hidden: true });
  // What the die has to show, in big: "Du brauchst eine 9 oder mehr".
  const need = prompt.need;
  const needBox = need
    ? h(
        "div",
        { class: "dice-need" },
        h("span", { class: "need-label" }, "Du brauchst"),
        h("strong", { class: "need-min" }, need.min <= 1 ? "keine Mühe" : String(need.min)),
        h("span", { class: "need-label" }, need.min >= 20 ? "– nur eine 20 klappt!" : need.min <= 1 ? "das klappt sicher" : "oder mehr auf dem Würfel"),
        h("span", { class: "need-why" }, `Ziel: ${need.label} ${need.target} · dein Bonus ${need.bonus >= 0 ? "+" : ""}${need.bonus}`),
      )
    : null;
  const panel = h("div", { class: "dice-panel" }, title, h("p", { class: "dice-term" }, term(`W${prompt.sides}`, `w${prompt.sides}`)), ...(needBox ? [needBox] : []), stage, hint, lines, done);
  const overlay = h("div", { class: "dice-overlay" }, panel);
  document.body.append(overlay);

  let rolling: ReturnType<typeof setInterval> | undefined;
  const closedCbs: (() => void)[] = [];
  let rolled = false;
  let pendingResult: RollOutcome | undefined;
  let started = 0;
  let autoTimer: ReturnType<typeof setTimeout> | undefined;

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
    // What it did, at a glance; the full calculation folded away.
    const how = h("details", { class: "dice-how" }, h("summary", {}, "🧮 Wie wurde gerechnet?"), ...r.lines.map((l) => explainedLine(l)));
    lines.replaceChildren(...(r.bullets?.length ? [bulletList(r.bullets), how] : r.lines.map((l) => explainedLine(l))));
    done.hidden = false;
    // Closes by itself after a moment (long enough to read the points); a touch keeps it open.
    if (loadPrefs().autoClose) {
      const ms = Math.min(8000, 3500 + (r.bullets?.length ?? r.lines.length) * 700);
      done.classList.add("autoclose");
      done.style.setProperty("--autoclose", `${ms}ms`);
      autoTimer = setTimeout(() => api.close(), ms);
      const keep = () => {
        if (autoTimer) clearTimeout(autoTimer);
        autoTimer = undefined;
        done.classList.remove("autoclose");
      };
      panel.addEventListener("pointerdown", keep, { once: true });
      how.addEventListener("toggle", keep, { once: true });
    }
    if (r.crit && "vibrate" in navigator) navigator.vibrate([80, 60, 160]);
    if (r.crit) play("crit");
    else if (r.success === true) play("chime");
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
    play("dice");
    onRoll();
  });

  // Shaking the phone rolls too (a strong jolt, not just holding it).
  let last: { x: number; y: number; z: number } | undefined;
  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    const now = { x: a.x, y: a.y, z: a.z };
    if (last && !rolled && Math.abs(now.x - last.x) + Math.abs(now.y - last.y) + Math.abs(now.z - last.z) > 18) stage.click();
    last = now;
  };
  if (shake) window.addEventListener("devicemotion", onMotion);

  const api: DiceOverlay = {
    land(result) {
      // Let the die tumble for at least 0.8 s, it feels better.
      pendingResult = result;
      const wait = Math.max(0, 800 - (Date.now() - started));
      setTimeout(() => pendingResult && showResult(pendingResult), rolled ? wait : 0);
    },
    close() {
      if (rolling) clearInterval(rolling);
      if (autoTimer) clearTimeout(autoTimer);
      window.removeEventListener("devicemotion", onMotion);
      if (!overlay.isConnected) return;
      overlay.remove();
      closedCbs.splice(0).forEach((cb) => cb());
    },
    isOpen() {
      return overlay.isConnected;
    },
    onClosed(cb) {
      if (overlay.isConnected) closedCbs.push(cb);
      else cb();
    },
  };
  done.addEventListener("click", api.close);
  return api;
}

/** Result of a roll that needed no tap (e.g. someone else rolled): small card. */
export function resultCard(r: RollOutcome): HTMLElement {
  return h("div", { class: "result-card" }, h("strong", {}, r.title), ...r.lines.map((l) => explainedLine(l)));
}
