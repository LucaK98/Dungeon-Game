/**
 * The Dungeon Master tells the story; the code does the maths.
 * ScriptedDM (A6) follows the story JSON with fixed rules, AiDM (A8) improvises.
 * Both return a DmResponse, which the host validates before applying anything.
 */
import type { RollRequest } from "./events";
import type { Duration, Narration } from "./story";
import type { PlayerId } from "./types";

/** What the DM gets to see. Kept small on purpose (token budget in A8). */
export interface DmContext {
  storyId: string;
  duration: Duration;
  /** The secret truth of this game (never sent to phones). */
  truth: string;
  sceneId: string;
  stepId?: string;
  /** The obstacle a clever idea may get around right now (hard roll, once per scene), if any. */
  bypass?: string;
  sceneIndex: number;
  sceneCount: number;
  players: { id: PlayerId; name: string; classId: string; hp: number; maxHp: number }[];
  actingPlayer?: PlayerId;
  flags: string[];
  cluesFound: string[];
  twistRevealed: boolean;
  /** Minutes played / planned so far (tempo). */
  minutesPlayed: number;
  minutesPlanned: number;
  /** Hit points the heroes lost in this scene, relative to their maximum (0..n). */
  hardship: number;
  /** Set while a fight is running: the enemies still standing. */
  combat?: { enemies: { id: string; name: string; hp: number; maxHp: number; boss: boolean }[] };
  /** Where the acting hero stands and what is around (for ideas with the surroundings). */
  room?: { name: string; objects: string[]; things?: { id: string; name: string }[]; people?: { id: string; name: string }[] };
  /** Gold of the whole group (bribes cost gold). */
  gold?: number;
  /** Short memory of notable deeds, newest last. */
  chronicle?: string[];
  /** What the heroes told about themselves at the campfire. */
  tales?: string[];
  /** Attitude of story characters towards the group, −3 (hostile) … +3 (friendly). */
  attitudes?: Record<string, number>;
  /** The characters here: personality, feelings towards the heroes and what they remember (src/dm/npc-world.ts). */
  minds?: string[];
  eventsUsed: string[];
}

/** Moments in which the host asks the DM. */
export type DmTrigger =
  | { kind: "scene_start" }
  | { kind: "step_start" }
  | { kind: "step_done" }
  | { kind: "free_text"; text: string; playerId: PlayerId; heroName: string }
  /** The roll the DM asked for after a free action is done. */
  | { kind: "roll_result"; text: string; playerId: PlayerId; heroName: string; skill: string; dc: number; total: number; success: boolean }
  /** "Frag den Spielleiter": a rules question from one player, answered only to them. */
  | { kind: "rules_question"; question: string; playerId: PlayerId; heroName: string; glossary: { title: string; text: string }[]; hero: string }
  /** A player asks "Was könnte ich tun?" – answered with a few ideas, nothing happens yet. */
  | { kind: "suggest"; playerId: PlayerId; heroName: string }
  /** Nobody has done anything for a while: say something to get the group going. */
  | { kind: "idle"; seconds: number }
  | { kind: "scene_end" }
  /** A hero struck down the final boss and described the blow in their own words. */
  | { kind: "final_blow"; heroName: string; bossName: string; text: string }
  /** The heroes rested at the campfire and told each other something about themselves. */
  | { kind: "campfire"; tales: { heroName: string; question: string; text: string }[] }
  | { kind: "story_end" }
  /** A moment with one character (a flirt, a gift): she answers in her own way. The rules decided the outcome. */
  | { kind: "npc_moment"; playerId: PlayerId; heroName: string; npc: string; what: "flirt"; outcome: string };

export type DmNext = "await_roll" | "await_action" | "start_combat" | "end_scene";

/** Shared by ScriptedDM (A6) and AiDM (A8). The host validates every field. */
export interface DmResponse {
  narration: string;
  npc_say?: { name: string; text: string };
  /** Structured narration (scripted DM): several lines with speaker and beginner tips. */
  script?: Narration[];
  request_roll?: RollRequest;
  /** Free actions: what should happen if the roll works (shown on the phone before rolling). */
  plan?: string;
  /** Free actions: the idea was too unclear – a short question back to the player. */
  ask_back?: string;
  spawn?: { monster: string; count: number; zone: string }[];
  reveal_room?: string;
  reveal_clue?: string;
  reveal_twist?: boolean;
  npc_attitude?: { npc: string; change: number };
  /** What the speaking character keeps in mind from this moment (one short sentence, her view). */
  npc_memory?: { name: string; fact: string };
  trigger_event?: string;
  choose_ending?: string | null;
  set_flags?: string[];
  /** Real consequences of a free action, applied by the code (see src/dm/effects.ts). */
  effects?: DmEffect[];
  /** Scene start (AI): a small store for the rest of the scene – greetings per character, quiet moments. */
  pack?: { greetings: { name: string; text: string }[]; moments: string[] };
  /** Answer to "suggest": short ideas for free actions. */
  ideas?: string[];
  /** Answer to "rules_question". */
  answer?: string;
  next: DmNext;
}

/**
 * What a free action can really do. The DM (AI or script) picks, the code checks and applies.
 * Targets are creature ids (enemies in a fight, heroes for help/first aid).
 */
export type DmEffect =
  // in a fight
  | { kind: "distract"; target: string }
  | { kind: "prone"; target: string }
  | { kind: "hamper"; target: string }
  | { kind: "help"; target: string }
  | { kind: "cover" }
  | { kind: "hazard"; target: string; severity: "leicht" | "mittel" | "schwer" }
  | { kind: "flee" }
  | { kind: "pacify"; target: string; how: "ergeben" | "bestechen" | "betoeren" }
  // outside a fight
  | { kind: "find"; item: "gold" | "trank" | "fackel" }
  | { kind: "first_aid"; target: string }
  | { kind: "open_door" }
  | { kind: "reveal" }
  // a clever idea solves the scene's current obstacle (hard roll only, once per scene)
  | { kind: "bypass" }
  // the hero's body: go somewhere (free), climb up high, hide, pull back, lie down / get up
  | { kind: "move_to"; target: string }
  | { kind: "climb" }
  | { kind: "hide" }
  | { kind: "retreat" }
  | { kind: "posture"; how: "up" | "down" }
  // the surroundings: ground (fire, oil, water, ice, mud), things (topple, smash, set alight, push, roll), barricade, light
  | { kind: "ground"; target: string; surface: "fire" | "oil" | "puddle" | "ice" | "mud" }
  | { kind: "object"; target: string; how: "topple" | "smash" | "ignite" | "push" | "roll"; toward?: string }
  | { kind: "barricade"; toward?: string }
  | { kind: "light"; on: boolean }
  // people: characters come, follow, leave, show the way; a gift; an enemy changes sides or runs off
  | { kind: "npc"; target: string; how: "follow" | "come" | "leave" | "show_way" }
  | { kind: "npc_gift"; target: string; item: "gold" | "trank" | "fackel" }
  | { kind: "turncoat"; target: string }
  | { kind: "rout"; target: string }
  // things: throw something to a friend, give a potion, an improvised weapon, a trap
  | { kind: "pass_item"; target: string; item: string }
  | { kind: "feed_potion"; target: string }
  | { kind: "improvised"; target: string }
  | { kind: "set_trap" }
  // bigger physics: break a wall, bring the ceiling down, a big jump, jump down on a foe, noise
  | { kind: "wall_break"; target?: string }
  | { kind: "collapse"; target: string }
  | { kind: "leap"; target: string }
  | { kind: "pounce"; target: string }
  | { kind: "noise"; target?: string; how: "lure" | "loud" }
  // characters: an errand, a disguise, questioning a beaten foe
  | { kind: "errand"; target: string; how: "heal" | "sharpen" | "hide" | "info" }
  | { kind: "disguise" }
  | { kind: "interrogate"; target: string }
  // fighting smart: foes against each other, disarm / break the shield, grab and throw
  | { kind: "feud"; target: string; other: string }
  | { kind: "disarm"; target: string; what: "weapon" | "shield" }
  | { kind: "hurl"; target: string; toward?: string }
  // animals of the surroundings: a beehive, scaring beasts off, rats set on a foe
  | { kind: "animals"; how: "bees" | "scare" | "rats"; target: string }
  // spells used creatively: ice bridge over water, a shove (by muscle or thunder) into fire, onto ice, into water
  | { kind: "ice_bridge"; target: string }
  | { kind: "shove"; target: string; toward?: string }
  // pressure outside fights: bribe, blackmail, threaten (people remember threats)
  | { kind: "pressure"; target: string; how: "bribe" | "blackmail" | "threaten" }
  // prisoners: let go, take along, hand over for a reward
  | { kind: "captive"; target: string; how: "free" | "take" | "hand_over" }
  // study a foe: a weak spot (attacks against it have advantage)
  | { kind: "weakness"; target: string }
  // "yes, but": the acting hero pays a small price (1W4 damage, never knocked out)
  | { kind: "cost" }
  // setbacks after a clearly failed attempt
  | { kind: "exposed" }
  | { kind: "fall" }
  | { kind: "fumble" }
  | { kind: "hurt"; severity: "leicht" | "mittel" }
  | { kind: "lose_gold" }
  | { kind: "enrage"; target: string };

export interface DungeonMaster {
  respond(ctx: DmContext, trigger: DmTrigger): Promise<DmResponse>;
}
