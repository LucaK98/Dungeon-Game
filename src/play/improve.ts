/**
 * Level 4 on the phone: +2 on one attribute, +1 on two, or a talent.
 * The choice goes into the hero book; the TV checks it when the hero plays again.
 */
import { createCharacter } from "../engine/creatures";
import { abilityMod } from "../engine/core";
import { abilityName } from "../engine/names";
import type { SavedHero } from "../shared/herobook";
import { ABILITY_IDS, describeImprovement, improvementsDue, TALENTS } from "../shared/improvements";
import type { Ability } from "../shared/types";
import { h } from "../ui/dom";

const ICON: Record<Ability, string> = { STR: "💪", DEX: "🤸", CON: "🫀", INT: "🧠", WIS: "🦉", CHA: "🗣️" };

export function needsImprovement(hero: SavedHero): boolean {
  return (hero.legacy.improvements?.length ?? 0) < improvementsDue(hero.legacy.level);
}

/** Opens the choice; resolves with the chosen improvement (or undefined = later). */
export function chooseImprovement(hero: SavedHero): Promise<string | undefined> {
  return new Promise((resolve) => {
    const p = hero.profile;
    // The hero as they are now (scores before this choice).
    const now = createCharacter({ id: "x", name: p.name, classId: p.classId, raceId: p.raceId, level: hero.legacy.level, ...(hero.legacy.improvements ? { improvements: hero.legacy.improvements } : {}) });
    let picked: Ability[] = [];
    const finish = (value: string | undefined) => {
      sheet.remove();
      resolve(value);
    };
    const score = (a: Ability) => now.abilities[a];
    const plus2 = ABILITY_IDS.map((a) => {
      const full = score(a) >= 20;
      const next = Math.min(20, score(a) + 2);
      const b = h(
        "button",
        { class: "improve-btn", type: "button", disabled: full },
        h("span", { class: "improve-icon" }, ICON[a]),
        h("strong", {}, abilityName(a)),
        h("span", { class: "muted" }, full ? "schon 20" : `${score(a)} → ${next} (Mod ${signed(abilityMod(score(a)))} → ${signed(abilityMod(next))})`),
      );
      b.addEventListener("click", () => finish(`asi:${a}+2`));
      return b;
    });
    const pairInfo = h("p", { class: "muted small" }, "Tippe zwei Attribute an.");
    const pairOk = h("button", { class: "btn primary", type: "button", textContent: "Beide +1 übernehmen", disabled: true });
    const chips = ABILITY_IDS.map((a) => {
      const c = h("button", { class: "chip", type: "button", disabled: score(a) >= 20 }, `${ICON[a]} ${abilityName(a)} ${score(a)}`);
      c.addEventListener("click", () => {
        picked = picked.includes(a) ? picked.filter((x) => x !== a) : [...picked, a].slice(-2);
        chips.forEach((x, i) => x.classList.toggle("good", picked.includes(ABILITY_IDS[i]!)));
        pairOk.disabled = picked.length !== 2;
        pairInfo.textContent = picked.length === 2 ? `${abilityName(picked[0]!)} +1 und ${abilityName(picked[1]!)} +1` : "Tippe zwei Attribute an.";
      });
      return c;
    });
    pairOk.addEventListener("click", () => picked.length === 2 && finish(`asi:${picked[0]}+1,${picked[1]}+1`));
    const talents = TALENTS.map((t) => {
      const b = h("button", { class: "improve-btn", type: "button" }, h("span", { class: "improve-icon" }, t.icon), h("strong", {}, t.name), h("span", { class: "muted" }, t.text));
      b.addEventListener("click", () => finish(`talent:${t.id}`));
      return b;
    });
    const later = h("button", { class: "btn small", type: "button", textContent: "Später entscheiden" });
    later.addEventListener("click", () => finish(undefined));
    const sheet = h(
      "div",
      { class: "reward-sheet" },
      h(
        "div",
        { class: "reward-card improve-card" },
        h("div", { class: "reward-burst" }, "⬆️"),
        h("h2", {}, `${p.name} erreicht Stufe ${hero.legacy.level}!`),
        h("p", { class: "reward-sub" }, "Wähle eine Verbesserung. Sie bleibt für immer im Heldenbuch."),
        h("h3", {}, "+2 auf ein Attribut"),
        h("div", { class: "improve-grid" }, ...plus2),
        h("h3", {}, "… oder je +1 auf zwei"),
        h("div", { class: "chips" }, ...chips),
        pairInfo,
        pairOk,
        h("h3", {}, "… oder ein Talent"),
        h("div", { class: "improve-grid" }, ...talents),
        later,
      ),
    );
    document.body.append(sheet);
  });
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

export { describeImprovement };
