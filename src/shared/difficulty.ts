/**
 * Difficulty levels. The dice always stay honest (a real d20): only the world around them changes –
 * how tough the monsters are, how hard the checks are and what the heroes start with.
 */
export type Difficulty = "leicht" | "normal" | "schwer" | "toedlich";
export const DIFFICULTIES: Difficulty[] = ["leicht", "normal", "schwer", "toedlich"];

export interface DifficultyRules {
  label: string;
  icon: string;
  /** One line for the picker. */
  text: string;
  /** What changes, for the picker (short bullet points). */
  points: string[];
  /** Monster hit points ×. */
  hp: number;
  /** Added to every monster attack (shown in the breakdown as "Schwierigkeit"). */
  attack: number;
  /** Added to monster damage (per hit). */
  damage: number;
  /** Added to every check's target number (SG). */
  dc: number;
  /** Extra monsters per non-boss group (not in training fights). */
  extraMonsters: number;
  /** …also in fights with a boss. */
  extraWithBoss: boolean;
  /** Healing potions each hero has at the start (at least). */
  potions: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyRules> = {
  leicht: {
    label: "Leicht",
    icon: "🌱",
    text: "Zum Reinschnuppern: Fehler werden verziehen.",
    points: ["Monster haben weniger Trefferpunkte", "Monster treffen seltener (−1)", "Proben sind leichter (SG −2)", "2 Heiltränke für jeden"],
    hp: 0.7,
    attack: -1,
    damage: 0,
    dc: -2,
    extraMonsters: 0,
    extraWithBoss: false,
    potions: 2,
  },
  normal: {
    label: "Normal",
    icon: "⚔️",
    text: "Genau nach Regelwerk – fair und spannend.",
    points: ["Monster wie im Regelwerk", "Proben wie im Regelwerk", "1 Heiltrank für jeden"],
    hp: 1,
    attack: 0,
    damage: 0,
    dc: 0,
    extraMonsters: 0,
    extraWithBoss: false,
    potions: 1,
  },
  schwer: {
    label: "Schwer",
    icon: "🔥",
    text: "Für eingespielte Gruppen: Taktik zählt.",
    points: ["Monster haben 30 % mehr Trefferpunkte", "Monster treffen besser (+1)", "Proben sind schwerer (SG +1)", "Ein Gegner mehr (nicht beim Endgegner)"],
    hp: 1.3,
    attack: 1,
    damage: 0,
    dc: 1,
    extraMonsters: 1,
    extraWithBoss: false,
    potions: 1,
  },
  toedlich: {
    label: "Tödlich",
    icon: "💀",
    text: "Nur für Mutige: jeder Fehler kann das Ende sein.",
    points: ["Monster haben 60 % mehr Trefferpunkte", "Monster treffen besser (+2) und härter (+1 Schaden)", "Proben sind schwerer (SG +2)", "Ein Gegner mehr – auch beim Endgegner", "Keine Heiltränke zum Start"],
    hp: 1.6,
    attack: 2,
    damage: 1,
    dc: 2,
    extraMonsters: 1,
    extraWithBoss: true,
    potions: 0,
  },
};

export function isDifficulty(v: unknown): v is Difficulty {
  return typeof v === "string" && (DIFFICULTIES as string[]).includes(v);
}
