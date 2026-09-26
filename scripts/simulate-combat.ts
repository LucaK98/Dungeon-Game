/**
 * Simulates a whole fight in the console with readable German roll breakdowns.
 *   npm run simulate                       → 4 heroes (level 1) against 3 goblins
 *   npm run simulate -- --seed 7 --level 3 --enemies ogre,goblin,goblin
 */
import { nameOf } from "../src/engine/names";
import { seededRng } from "../src/engine/rng";
import { simulateBattle } from "../src/engine/simulate";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const seed = Number(arg("seed", "42"));
const setup = {
  level: Number(arg("level", "1")),
  heroes: arg("heroes", "fighter,paladin,wizard,rogue").split(","),
  enemies: arg("enemies", "goblin,goblin,goblin").split(","),
};

console.log(
  `\n⚔️  Kampf (Seed ${seed}): ${setup.heroes.map((h) => nameOf("classes", h)).join(", ")} gegen ${setup.enemies
    .map((m) => nameOf("monsters", m))
    .join(", ")}`,
);
const result = simulateBattle(seededRng(seed), setup);
for (const block of result.log) {
  console.log(`\n— ${block.heading} —`);
  for (const line of block.lines) console.log("  " + line.text);
}
const w = result.winner;
console.log(`\n${w === "party" ? "🏆 Die Helden siegen!" : w === "enemy" ? "💀 Die Helden wurden besiegt." : "⏱️ Abbruch."}`);
for (const c of Object.values(result.battle.creatures)) {
  console.log(`  ${c.name.padEnd(22)} ${c.dead ? "☠️" : c.hp === 0 ? "bewusstlos" : `TP ${c.hp}/${c.maxHp}`}`);
}
