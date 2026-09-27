/**
 * Random events while the heroes explore: the world does something on its own.
 * Every event fits a kind of place (cave, village, night, water, …) and usually brings a small
 * decision to all phones. The rules (checks, gold, damage, fights) run through the director.
 */
import type { Rng } from "../engine/rng";
import type { Theme } from "../shared/map";
import type { SkillId } from "../shared/rules";
import type { MonsterGroup, Narration } from "../shared/story";

export interface Place {
  theme: Theme;
  outdoor: boolean;
  night: boolean;
  /** Water near the heroes. */
  water: boolean;
  gold: number;
  /** Lowest hit points of a hero, 0…1. */
  health: number;
}

export type Fx = "puff" | "shake" | "sparkle" | "splash";

export interface EventOutcome {
  narration: Narration[];
  /** For (or, negative, from) the group. */
  gold?: number;
  /** An item for the hero who chose or rolled. */
  item?: string;
  /** Healing dice for every hero. */
  healAll?: string;
  /** Damage dice for the hero who rolled (never knocks out). */
  hurt?: string;
  /** Damage dice for every hero (never knocks out). */
  hurtAll?: string;
  /** Temporary hit points for the hero who chose. */
  tempHp?: number;
  fight?: MonsterGroup[];
  /** A piece of equipment (src/data/gear.ts) for the hero who chose. */
  gear?: string;
  fx?: Fx;
}

export interface EventCheck {
  skill: SkillId;
  dc: number;
  success: EventOutcome;
  failure: EventOutcome;
}

export interface EventChoice {
  id: string;
  label: string;
  detail: string;
  /** Gold the group pays (the choice is only offered if they have it). */
  cost?: number;
  check?: EventCheck;
  outcome?: EventOutcome;
}

export interface WorldEvent {
  id: string;
  title: string;
  where: (p: Place) => boolean;
  intro: Narration[];
  /** Someone comes by for the event (a figure on the board). */
  visitor?: { monster: string; name: string };
  choices?: EventChoice[];
  /** Happens to the heroes right away: a random hero ("one") or everyone ("each") rolls. */
  auto?: { who: "one" | "each"; skill: SkillId; dc: number; success: EventOutcome; failure: EventOutcome };
  fx?: Fx;
  weight?: number;
}

const INDOOR: Theme[] = ["castle", "throne", "cave", "lair", "crypt", "stone", "mine", "church", "tavern"];
const UNDERGROUND: Theme[] = ["cave", "mine", "lair", "crypt"];
const GREEN: Theme[] = ["forest", "meadow"];
const PEOPLE: Theme[] = ["village", "town", "tavern", "castle"];

const nothing: EventOutcome = { narration: [] };
const walkOn = (text = "Ihr geht weiter."): EventChoice => ({ id: "weiter", label: "🚶 Weitergehen", detail: "Nicht eure Sache.", outcome: { narration: [{ text }] } });

/** Wandering monsters that fit the place (small groups, never bosses). */
export function wanderers(p: Place): MonsterGroup[] | undefined {
  if (p.theme === "cave" || p.theme === "mine") return [{ monster: "giant-rat", count: 2, name: "Riesenratte" }];
  if (p.theme === "crypt" || p.theme === "church") return [{ monster: "skeleton", count: 1, name: "Skelett", perExtraPlayer: 0.5 }];
  if (p.theme === "lair") return [{ monster: "kobold", count: 2, name: "Kobold" }];
  if (GREEN.includes(p.theme) || p.theme === "peak") return p.night ? [{ monster: "wolf", count: 2, name: "Wolf" }] : [{ monster: "wolf", count: 1, name: "Wolf", perExtraPlayer: 0.5 }];
  if (p.theme === "town" || p.theme === "village") return [{ monster: "bandit", count: 2, name: "Strauchdieb" }];
  return undefined;
}

export const WORLD_EVENTS: WorldEvent[] = [
  {
    id: "geraeusch",
    title: "Ein Geräusch",
    where: (p) => INDOOR.includes(p.theme),
    intro: [{ text: "Hinter der Wand kratzt etwas. Dann ist es still. Zu still." }],
    choices: [
      {
        id: "nachsehen",
        label: "🔍 Nachsehen",
        detail: "Wahrnehmung SG 12",
        check: {
          skill: "perception",
          dc: 12,
          success: { narration: [{ text: "In einer Mauerritze liegt ein vergessener Beutel. Darin klimpert es!" }], gold: 8, fx: "sparkle" },
          failure: { narration: [{ text: "Ratten! Sie huschen aus dem Loch und beißen zu, bevor sie verschwinden." }], hurt: "1d4" },
        },
      },
      walkOn("Ihr lasst die Wand in Ruhe. Das Kratzen folgt euch noch ein Stück."),
    ],
  },
  {
    id: "haendler",
    title: "Fahrender Händler",
    where: (p) => !UNDERGROUND.includes(p.theme) && !p.night,
    visitor: { monster: "commoner", name: "Händler Fridolin" },
    intro: [
      { text: "Ein Händler mit einem vollgepackten Bauchladen kommt euch entgegen." },
      { npc: "Händler Fridolin", text: "Heiltränke! Frisch gebraut! Nur zehn Goldstücke, für Helden wie euch." },
    ],
    choices: [
      {
        id: "kaufen",
        label: "🧪 Heiltrank kaufen (10 Gold)",
        detail: "Ein Heiltrank für den, der kauft.",
        cost: 10,
        outcome: { narration: [{ npc: "Händler Fridolin", text: "Eine ausgezeichnete Wahl! Möge er euch nie fehlen." }], item: "potion-of-healing" },
      },
      {
        id: "feilschen",
        label: "🤝 Feilschen",
        detail: "Überzeugen SG 13: vielleicht billiger?",
        cost: 5,
        check: {
          skill: "persuasion",
          dc: 13,
          success: { narration: [{ npc: "Händler Fridolin", text: "Ihr treibt mich in den Ruin! Na gut, fünf Goldstücke." }], item: "potion-of-healing" },
          failure: { narration: [{ npc: "Händler Fridolin", text: "Pah! Wer feilscht, bekommt gar nichts." }, { text: "Er zieht beleidigt weiter – eure fünf Goldstücke behält er als ‚Beratungsgebühr‘." }] },
        },
      },
      walkOn("Der Händler zuckt mit den Schultern und zieht weiter."),
    ],
  },
  {
    id: "waffenhaendler",
    title: "Die fahrende Schmiedin",
    where: (p) => !UNDERGROUND.includes(p.theme) && !p.night && p.gold >= 25,
    visitor: { monster: "commoner", name: "Schmiedin Ortrud" },
    intro: [
      { text: "Ein Karren voller glänzender Klingen und Rüstungen rumpelt heran." },
      { npc: "Schmiedin Ortrud", text: "Beste Ware, von Zwergenhand geschmiedet! Wer kauft, kämpft besser." },
    ],
    // The offers are picked when the event happens (see world.ts).
    choices: [walkOn("Die Schmiedin zuckt mit den Schultern: „Dann eben nicht.“")],
    weight: 1.2,
  },
  {
    id: "falle",
    title: "Falle!",
    where: (p) => INDOOR.includes(p.theme),
    intro: [{ text: "Klick. Unter einem Stiefel senkt sich eine Steinplatte …" }],
    auto: {
      who: "one",
      skill: "acrobatics",
      dc: 12,
      success: { narration: [{ text: "Ein Pfeil zischt aus der Wand – knapp vorbei! Gerade noch zur Seite gesprungen." }] },
      failure: { narration: [{ text: "Ein Pfeil zischt aus der Wand und trifft!" }], hurt: "1d6" },
    },
    fx: "puff",
  },
  {
    id: "wanderer",
    title: "Verletzter Wanderer",
    where: (p) => !UNDERGROUND.includes(p.theme) && p.theme !== "throne",
    visitor: { monster: "commoner", name: "Verletzter Wanderer" },
    intro: [{ text: "Am Wegesrand sitzt ein Wanderer und hält sich stöhnend das Bein." }, { npc: "Verletzter Wanderer", text: "Bitte … könnt ihr mir helfen?" }],
    choices: [
      {
        id: "verarzten",
        label: "🩹 Verarzten",
        detail: "Heilkunde SG 10",
        check: {
          skill: "medicine",
          dc: 10,
          success: { narration: [{ npc: "Verletzter Wanderer", text: "Ihr seid Engel! Nehmt das, es hat mir nie Glück gebracht – vielleicht euch." }], item: "potion-of-healing" },
          failure: { narration: [{ text: "Der Verband sitzt schief, aber der Wanderer humpelt dankbar davon." }] },
        },
      },
      {
        id: "proviant",
        label: "🍞 Proviant und Mut geben",
        detail: "Kein Wurf. Wer hilft, fühlt sich stärker.",
        outcome: { narration: [{ npc: "Verletzter Wanderer", text: "Danke. Die Welt braucht mehr Leute wie euch." }, { text: "Ihr fühlt euch gut. (Wer geholfen hat, bekommt 4 Extra-Trefferpunkte.)" }], tempHp: 4 },
      },
      walkOn("Ihr geht vorbei. Das Stöhnen hinter euch wird leiser."),
    ],
  },
  {
    id: "spuren",
    title: "Spuren",
    where: () => true,
    intro: [{ text: "Kleine Pfotenspuren im Staub führen zu einem Spalt zwischen den Steinen." }],
    choices: [
      {
        id: "folgen",
        label: "🐾 Den Spuren folgen",
        detail: "Überlebenskunst SG 11",
        check: {
          skill: "survival",
          dc: 11,
          success: { narration: [{ text: "Ein Elsternnest! Darin glitzern gestohlene Münzen." }], gold: 12, fx: "sparkle" },
          failure: { narration: [{ text: "Die Spuren verlieren sich. Nur ein paar Federn bleiben zurück." }] },
        },
      },
      walkOn("Ihr lasst die Spuren links liegen."),
    ],
  },
  {
    id: "wandernde_monster",
    title: "Wandernde Monster",
    where: (p) => !!wanderers(p) && p.health > 0.6,
    weight: 0.8,
    intro: [{ text: "Schritte. Schnüffeln. Aus dem Dunkel kommt etwas auf euch zu!" }],
    choices: [
      { id: "kampf", label: "⚔️ Stellen und kämpfen", detail: "Ihr seid bereit.", outcome: { narration: [{ text: "Ihr zieht die Waffen!" }] } },
      {
        id: "verstecken",
        label: "🤫 Verstecken",
        detail: "Heimlichkeit SG 12",
        check: {
          skill: "stealth",
          dc: 12,
          success: { narration: [{ text: "Ihr drückt euch in den Schatten. Die Gestalten ziehen schnüffelnd vorbei." }] },
          failure: { narration: [{ text: "Ein Stein knirscht unter eurem Fuß – entdeckt!" }] },
        },
      },
    ],
  },
  {
    id: "glitzern",
    title: "Glitzern im Wasser",
    where: (p) => p.water,
    intro: [{ text: "Unter der Wasseroberfläche glitzert etwas." }],
    choices: [
      {
        id: "greifen",
        label: "🤿 Hineingreifen",
        detail: "Athletik SG 10",
        check: {
          skill: "athletics",
          dc: 10,
          success: { narration: [{ text: "Ein goldener Ring! Er ist bestimmt 15 Goldstücke wert." }], gold: 15, fx: "splash" },
          failure: { narration: [{ text: "Platsch! Ausgerutscht. Nass bis auf die Knochen und kalt." }], hurt: "1d2", fx: "splash" },
        },
      },
      walkOn("Ihr lasst das Glitzern, wo es ist."),
    ],
  },
  {
    id: "bettelkind",
    title: "Ein Kind bittet",
    where: (p) => (p.theme === "town" || p.theme === "village") && p.gold >= 1,
    visitor: { monster: "commoner", name: "Kleine Lina" },
    intro: [{ npc: "Kleine Lina", text: "Habt ihr eine Münze für mich? Nur eine?" }],
    choices: [
      {
        id: "geben",
        label: "🪙 Eine Münze geben",
        detail: "1 Gold",
        cost: 1,
        outcome: {
          narration: [{ npc: "Kleine Lina", text: "Danke! Ich verrate euch was: Hinter dem Brunnen ist ein loser Stein. Da verstecken die Großen Sachen." }, { text: "Ihr fühlt euch gut. (Wer gegeben hat, bekommt 4 Extra-Trefferpunkte.)" }],
          tempHp: 4,
        },
      },
      walkOn("Das Kind schaut euch traurig nach."),
    ],
  },
  {
    id: "einsturz",
    title: "Steinschlag",
    where: (p) => p.theme === "cave" || p.theme === "mine",
    intro: [{ text: "Ein Grollen in der Decke. Staub rieselt – dann brechen Steine herab!" }],
    auto: {
      who: "each",
      skill: "acrobatics",
      dc: 11,
      success: { narration: [{ text: "Zur Seite gehechtet!" }] },
      failure: { narration: [{ text: "Ein Stein trifft die Schulter." }], hurt: "1d6" },
    },
    fx: "shake",
  },
  {
    id: "pilze",
    title: "Leuchtende Pilze",
    where: (p) => p.theme === "forest" || p.theme === "cave",
    intro: [{ text: "Zwischen Wurzeln und Steinen leuchten blassblaue Pilze." }],
    choices: [
      {
        id: "sammeln",
        label: "🍄 Vorsichtig sammeln",
        detail: "Naturkunde SG 12: Heilpilz oder Giftpilz?",
        check: {
          skill: "nature",
          dc: 12,
          success: { narration: [{ text: "Mondschirmlinge! Zerrieben heilen sie Wunden." }], healAll: "1d6", fx: "sparkle" },
          failure: { narration: [{ text: "Die Sporen brennen in der Nase. Husten, Schwindel … war wohl der falsche Pilz." }], hurt: "1d4" },
        },
      },
      walkOn("Ihr lasst die Pilze leuchten."),
    ],
  },
  {
    id: "inschrift",
    title: "Alte Inschrift",
    where: (p) => ["crypt", "church", "castle", "throne", "stone"].includes(p.theme),
    intro: [{ text: "In die Wand sind uralte Zeichen geritzt, halb verwittert." }],
    choices: [
      {
        id: "entziffern",
        label: "📜 Entziffern",
        detail: "Geschichte SG 12",
        check: {
          skill: "history",
          dc: 12,
          success: { narration: [{ text: "„Wer den dritten Stein drückt, findet den Lohn der Wächter.“ Tatsächlich: Ein Stein gibt nach, dahinter liegt ein Fläschchen!" }], item: "potion-of-healing", fx: "sparkle" },
          failure: { narration: [{ text: "Die Zeichen ergeben keinen Sinn. Vielleicht ein Kinderreim, vielleicht ein Fluch." }] },
        },
      },
      walkOn(),
    ],
  },
  {
    id: "geheul",
    title: "Geheul in der Nacht",
    where: (p) => p.night && p.outdoor,
    intro: [{ text: "Aus der Ferne heulen Wölfe. Einer. Dann viele." }],
    choices: [
      {
        id: "feuer",
        label: "🔥 Kurz ein Feuer machen",
        detail: "Überlebenskunst SG 10: aufwärmen und Wunden versorgen",
        check: {
          skill: "survival",
          dc: 10,
          success: { narration: [{ text: "Das Feuer knistert, die Wärme tut gut. Die Wölfe bleiben auf Abstand." }], healAll: "1d4" },
          failure: { narration: [{ text: "Das Holz ist zu nass. Nur Rauch und kalte Finger." }] },
        },
      },
      walkOn("Ihr zieht die Umhänge enger und geht schneller."),
    ],
  },
  {
    id: "runde",
    title: "Eine Runde für alle",
    where: (p) => p.theme === "tavern" && p.gold >= 5,
    intro: [{ text: "Die Gäste in der Schankstube mustern euch neugierig." }],
    choices: [
      {
        id: "ausgeben",
        label: "🍺 Eine Runde ausgeben (5 Gold)",
        detail: "Freunde machen, Gerüchte hören",
        cost: 5,
        outcome: { narration: [{ text: "„Auf die Helden!“ Die Krüge klirren. Zwischen Liedern und Lachen hört ihr so manches Gerücht." }, { text: "Ihr seid ausgeruht und gut gelaunt." }], healAll: "1d6" },
      },
      walkOn("Ihr nickt den Gästen zu und bleibt für euch."),
    ],
  },
  {
    id: "taschendieb",
    title: "Taschendieb!",
    where: (p) => (p.theme === "town" || p.theme === "tavern") && p.gold >= 5,
    intro: [{ text: "Jemand rempelt euch an – und ist schon wieder im Gedränge verschwunden. Wo ist der Geldbeutel?" }],
    choices: [
      {
        id: "hinterher",
        label: "🏃 Hinterher!",
        detail: "Athletik SG 13",
        check: {
          skill: "athletics",
          dc: 13,
          success: { narration: [{ text: "Erwischt! Der Dieb lässt den Beutel fallen – und in seiner Hast noch ein paar eigene Münzen." }], gold: 4 },
          failure: { narration: [{ text: "Zu schnell. Der Beutel ist weg." }], gold: -5 },
        },
      },
      { id: "lassen", label: "🤷 Laufen lassen", detail: "Es waren nur ein paar Münzen.", outcome: { narration: [{ text: "Ärgerlich, aber verschmerzbar." }], gold: -3 } },
    ],
  },
  {
    id: "schrein",
    title: "Kleiner Schrein",
    where: (p) => !UNDERGROUND.includes(p.theme) || p.theme === "crypt",
    weight: 0.6,
    intro: [{ text: "Ein kleiner Schrein mit einer Opferschale. Ein paar Münzen liegen darin." }],
    choices: [
      {
        id: "opfern",
        label: "🙏 Eine Münze opfern",
        detail: "1 Gold",
        cost: 1,
        outcome: { narration: [{ text: "Ein warmes Licht erfüllt euch. Wunden schließen sich." }], healAll: "1d8", fx: "sparkle" },
      },
      {
        id: "nehmen",
        label: "💰 Die Münzen nehmen",
        detail: "Wer wird es schon merken?",
        outcome: { narration: [{ text: "Ihr steckt die Münzen ein. Ein kalter Wind fährt durch den Raum … und ein stechender Schmerz durch eure Glieder." }], gold: 6, hurtAll: "1d4" },
      },
      walkOn("Ihr lasst den Schrein in Frieden."),
    ],
  },
];

/** Picks the next event for this place (weighted, no repeats until all were used). */
export function pickEvent(rng: Rng, place: Place, used: string[]): WorldEvent | undefined {
  const fits = WORLD_EVENTS.filter((e) => e.where(place));
  const fresh = fits.filter((e) => !used.includes(e.id));
  const pool = fresh.length ? fresh : [];
  if (!pool.length) return undefined;
  const total = pool.reduce((s, e) => s + (e.weight ?? 1), 0);
  let r = rng.next() * total;
  for (const e of pool) {
    r -= e.weight ?? 1;
    if (r <= 0) return e;
  }
  return pool[pool.length - 1];
}

/** Seconds between two events: a little random, sooner with more players. */
export function eventGapSeconds(rng: Rng, players: number): number {
  return Math.round(rng.int(80, 140) * (players >= 4 ? 0.85 : 1));
}

/** Lines when the heroes take too long (time pressure), by place. */
export function clockWarning(p: Place): Narration {
  if (p.night) return { text: "⏳ Die Nacht wird kälter und die Fackeln kürzer. Ihr solltet euch beeilen." };
  if (UNDERGROUND.includes(p.theme)) return { text: "⏳ Irgendwo in der Tiefe regt sich etwas. Ihr seid schon zu lange hier unten." };
  if (PEOPLE.includes(p.theme)) return { text: "⏳ Die Leute tuscheln schon. Die Zeit läuft euch davon." };
  return { text: "⏳ Die Sonne wandert weiter. Trödelt nicht zu lange!" };
}

export { nothing as NO_OUTCOME };
