/**
 * Story format (src/dm/stories/<id>.json): acts → scenes → steps.
 * Every scene has its own small map built from room modules; the heroes travel between scenes.
 */
import type { SkillId } from "./rules";

export type Duration = "kurz" | "mittel" | "lang";
export const DURATIONS: Duration[] = ["kurz", "mittel", "lang"];

export interface Narration {
  text: string;
  /** Spoken by an NPC instead of the narrator. */
  npc?: string;
  /** Beginner explanation the narrator adds (glossary key + short text). */
  tip?: { key: string; text: string };
}

export interface StoryNpc {
  id: string;
  name: string;
  /** SRD stat block (for sprite and, if it comes to blows, fighting). */
  monster: string;
  description: string;
  /** Hidden goal, known to the DM only. */
  secretGoal?: string;
}

export interface MonsterGroup {
  monster: string;
  count: number;
  /** Shown name, e.g. "Knappe Kuno". */
  name?: string;
  /** Add one per player above 2 (encounter scaling). */
  perExtraPlayer?: number;
  /** Stands on the boss spot. */
  boss?: boolean;
  /** Friendly training fight: nobody dies, ends at 0 HP. */
  training?: boolean;
}

/** What happens after a choice or a check. */
export interface Outcome {
  narration: Narration[];
  /** Flags remembered for later scenes and the ending. */
  set?: string[];
  /** Clue slot to reveal (see Scene.clues). */
  clue?: string;
  /** Monsters that attack now. */
  fight?: MonsterGroup[];
  /** Give every hero this item. */
  item?: { id: string; qty: number };
  /** Gold for (or, if negative, from) the group. */
  gold?: number;
  /** Heal every hero by this many hit points (0 = fully). */
  heal?: number;
  /** Everyone takes this much damage (dice). */
  damage?: string;
  /** An NPC changes sides and fights with the heroes in the next fight. */
  ally?: string;
  /** Jumps to another step of the same scene (id). */
  goto?: string;
  /** The scene is over. */
  endScene?: boolean;
}

export interface Check {
  skill: SkillId;
  dc: number;
  /** "each": every hero rolls; "best": one hero of the group (who taps first). */
  who: "each" | "one";
  title: string;
  success: Outcome;
  failure: Outcome;
}

export interface StoryChoice {
  id: string;
  label: string;
  detail: string;
  /** Only offered when all these flags are set / none of these are set. */
  requires?: string[];
  unless?: string[];
  /** Only offered for these truths. */
  truths?: string[];
  check?: Omit<Check, "who" | "title" | "success" | "failure"> & { success: Outcome; failure: Outcome };
  outcome?: Outcome;
}

export type StepKind = "narrate" | "reach" | "check" | "fight" | "choice" | "use_item" | "explore";

export interface Step {
  id: string;
  kind: StepKind;
  /** Told when the step begins. */
  enter?: Narration[];
  /** Told when the step is done. */
  done?: Narration[];
  /** reach: walk next to this NPC (or to the last room with "exit"). */
  target?: string;
  check?: Check;
  fight?: MonsterGroup[];
  choices?: StoryChoice[];
  /** Only for these truths (twist steps). */
  truths?: string[];
  /** The big twist is revealed when this step begins. */
  twist?: boolean;
  /** Clue slot(s) revealed when the step is done. */
  clue?: string;
  clues?: string[];
  set?: string[];
}

export interface ClueSlot {
  id: string;
  /** Clue per truth; only the one of the rolled truth is ever shown. */
  byTruth: Record<string, string>;
}

export interface Scene {
  id: string;
  title: string;
  /** Room modules of this scene's map, in order. */
  rooms: string[];
  /** Other names for rooms of this scene (module id → name), e.g. in random adventures. */
  roomNames?: Record<string, string>;
  /** Extra rooms (inserted before the last one) for longer games. */
  extraRooms?: Partial<Record<Duration, string[]>>;
  pflicht: boolean;
  dauer_min: number;
  /** Shortest game setting that includes this optional scene. */
  mindestDauer: Duration;
  ziel: string;
  /** Night scene: darkness rules (light, darkvision) apply. */
  dark?: boolean;
  /** Short line shown while travelling here. */
  travel?: string;
  npcs?: { npc: string; room?: number }[];
  steps: Step[];
  clues?: ClueSlot[];
  /** Free-text keywords the scripted DM understands in this scene. */
  keywords?: { words: string[]; response: Narration[]; clue?: string; set?: string[] }[];
  /** Offers a save point before this scene ("lang"). */
  savePoint?: boolean;
}

export interface Act {
  id: string;
  title: string;
  /** The heroes reach this level when the act begins (milestone levelling). */
  level?: number;
  scenes: Scene[];
}

export interface Truth {
  id: string;
  title: string;
  /** What really happened, for the end screen. */
  summary: string;
  /** Narration when the twist is revealed. */
  reveal: Narration[];
}

export interface Clue {
  id: string;
  /** What the heroes learn (goes into the clue list on the phones). */
  text: string;
  /** Truth this clue points to; null = a general clue (true for every truth). */
  truth: string | null;
  /** False lead: looks like it points to these truths. */
  falseLeadFor?: string[];
}

export interface Ending {
  id: string;
  title: string;
  kind: "sieg" | "bittersuess" | "friedlich" | "scheitern";
  text: Narration[];
  /** All flags must be set / none of `unless`. First match wins, order matters. */
  requires?: string[];
  unless?: string[];
  truths?: string[];
}

export interface Story {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  recommended: boolean;
  /** Tiles for the title picture. */
  cover: string[];
  intro: Narration[];
  truths: Truth[];
  clues: Clue[];
  npcs: StoryNpc[];
  acts: Act[];
  endings: Ending[];
  /** Improvised events the DM may use when things get slow. */
  events?: { id: string; title: string; narration: Narration[]; fight?: MonsterGroup[] }[];
  /** NPCs that fight on the heroes' side in a scene if a flag is set. */
  allies?: { flag: string; npc: string; scene: string }[];
}
