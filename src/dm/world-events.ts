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
          success: { narration: [{ text: "In einer Mauerritze liegt ein vergessener Beutel. Darin klimpert es!" }], gold: 4, fx: "sparkle" },
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
          success: { narration: [{ text: "Ein Elsternnest! Darin glitzern gestohlene Münzen." }], gold: 6, fx: "sparkle" },
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
          success: { narration: [{ text: "Ein goldener Ring! Er ist bestimmt 7 Goldstücke wert." }], gold: 7, fx: "splash" },
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
          success: { narration: [{ text: "Erwischt! Der Dieb lässt den Beutel fallen – und in seiner Hast noch ein paar eigene Münzen." }], gold: 2 },
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
        outcome: { narration: [{ text: "Ihr steckt die Münzen ein. Ein kalter Wind fährt durch den Raum … und ein stechender Schmerz durch eure Glieder." }], gold: 3, hurtAll: "1d4" },
      },
      walkOn("Ihr lasst den Schrein in Frieden."),
    ],
  },

  // ---------------------------------------------------------------- twists: nothing is what it seems
  {
    id: "hilflose_oma",
    title: "Eine hilflose Oma",
    where: (p) => !UNDERGROUND.includes(p.theme) && p.gold >= 3,
    visitor: { monster: "commoner", name: "Oma Hilde" },
    intro: [{ npc: "Oma Hilde", text: "Ach, ihr lieben Helden! Mein Rücken … könnt ihr mir über den Weg helfen? Ganz dicht ran, ich höre so schlecht." }],
    choices: [
      {
        id: "durchschauen",
        label: "🧐 Genauer hinsehen",
        detail: "Motiv erkennen SG 13",
        check: {
          skill: "insight",
          dc: 13,
          success: { narration: [{ text: "Unter dem Kopftuch lugt ein grüner, spitzer Ohrenzipfel hervor. Das ist keine Oma – das ist ein Goblin mit Wollschal!" }, { npc: "Oma Hilde", text: "Mist! Erwischt!" }, { text: "Der „Oma“ fällt beim Wegrennen ein Beutel aus der Schürze." }], gold: 5 },
          failure: { narration: [{ text: "Ihr helft der Oma rührend über den Weg. Sie tätschelt euch die Wangen – und die Geldbeutel." }, { text: "Erst später merkt ihr: Es fehlen Münzen. Und die Oma hatte ziemlich grüne Hände." }], gold: -3 },
        },
      },
      {
        id: "helfen",
        label: "🤝 Einfach helfen",
        detail: "Ist doch nur eine Oma …",
        outcome: { narration: [{ text: "Die Oma kichert auffällig tief. Kaum seid ihr über den Weg, reißt sie sich das Kopftuch herunter: ein Goblin! Und zwei Freunde springen aus dem Gebüsch." }], fight: [{ monster: "goblin", count: 2, name: "Verkleideter Goblin" }] },
      },
      walkOn("„Unhöfliche Jugend!“, schimpft die Oma. Ihre Stimme klingt plötzlich sehr nach Goblin."),
    ],
  },
  {
    id: "froschkoenig",
    title: "Ein sprechender Frosch",
    where: (p) => p.water || GREEN.includes(p.theme),
    intro: [{ text: "Auf einem Stein sitzt ein Frosch mit einer winzigen Krone." }, { text: "„Küss mich“, quakt er. „Ich bin ein verwunschener Prinz!“" }],
    choices: [
      {
        id: "kuessen",
        label: "💋 Küssen",
        detail: "Glück? Charisma-Wurf (Überzeugen) SG 14",
        check: {
          skill: "persuasion",
          dc: 14,
          success: { narration: [{ text: "PUFF! Rauch, Glitzer – und da steht … ein zweiter, größerer Frosch." }, { text: "„Oh“, quakt er. „Falscher Zauber. Aber danke!“ Er schenkt euch zum Dank seine Krone. Echtes Gold!" }], gold: 6, fx: "sparkle" },
          failure: { narration: [{ text: "Schmatz. Nichts passiert. Nur eine grüne Zunge schnalzt quer über euer Gesicht." }, { text: "Der Frosch hüpft lachend davon. „Reingelegt! Das sagen wir allen!“" }] },
        },
      },
      walkOn("„Banausen!“, quakt der Frosch euch hinterher."),
    ],
  },
  {
    id: "schatzkarte",
    title: "Eine Schatzkarte",
    where: (p) => !PEOPLE.includes(p.theme),
    intro: [{ text: "Unter einem Stein klemmt ein vergilbtes Pergament: eine Schatzkarte! Das X ist ganz in der Nähe." }],
    choices: [
      {
        id: "graben",
        label: "⛏️ Beim X graben",
        detail: "Nachforschungen SG 12",
        check: {
          skill: "investigation",
          dc: 12,
          success: { narration: [{ text: "Tock! Eine kleine Kiste. Darin: Gold – und ein Zettel: „Wer das findet, hat meine Karte geklaut. Gruß, Räuber Hotzenplotz.“" }], gold: 7, fx: "sparkle" },
          failure: { narration: [{ text: "Ihr grabt ein riesiges Loch. Darin: ein Zettel. „Reingelegt! Hier ist nichts. Gruß, die Kobolde.“" }, { text: "Beim Rausklettern verstaucht sich jemand den Knöchel." }], hurt: "1d3" },
        },
      },
      walkOn("Ihr steckt die Karte ein. Vermutlich eh eine Fälschung."),
    ],
  },
  {
    id: "falscher_alarm",
    title: "Stampfende Schritte",
    where: (p) => GREEN.includes(p.theme) || p.theme === "village" || p.theme === "peak",
    intro: [{ text: "Der Boden bebt. Etwas Großes kommt näher, viele Beine, lautes Schnauben – ein Angriff?!" }],
    choices: [
      {
        id: "stellen",
        label: "⚔️ Kampfbereit machen",
        detail: "Einschüchtern SG 10",
        check: {
          skill: "intimidation",
          dc: 10,
          success: { narration: [{ text: "Aus dem Nebel trabt … eine Herde Schafe. Euer Kampfschrei lässt sie sofort umdrehen." }, { text: "Der Schäfer, der hinterherhechelt, drückt euch dankbar ein paar Münzen in die Hand: „Die wären sonst ins Moor gerannt!“" }], gold: 3 },
          failure: { narration: [{ text: "Aus dem Nebel trabt … eine Herde Schafe. Sie rennt euch einfach über den Haufen." }, { text: "Mäh." }], hurtAll: "1d2" },
        },
      },
      {
        id: "verstecken",
        label: "🌳 Verstecken",
        detail: "Sicher ist sicher.",
        outcome: { narration: [{ text: "Hinter dem Busch hervor seht ihr: Schafe. Nur Schafe. Eines bleibt stehen, schaut euch direkt an und frisst dann gemütlich euer Versteck auf." }] },
      },
    ],
  },
  {
    id: "wirtshausgeist",
    title: "Ein Geist mit einem Witz",
    where: (p) => p.night || p.theme === "tavern" || p.theme === "crypt" || p.theme === "castle",
    visitor: { monster: "ghost", name: "Geist Kunibert" },
    intro: [{ text: "Die Kerzen flackern. Eine durchsichtige Gestalt schwebt aus der Wand. Alle erstarren." }, { npc: "Geist Kunibert", text: "Buuuh! … Nein, wartet, bleibt! Ich will nur meinen Witz erzählen. Seit dreihundert Jahren hört ihn keiner zu Ende." }],
    choices: [
      {
        id: "zuhoeren",
        label: "👂 Zuhören und lachen",
        detail: "Täuschen SG 11 (so tun, als wäre er lustig)",
        check: {
          skill: "deception",
          dc: 11,
          success: { narration: [{ npc: "Geist Kunibert", text: "… und da sagt der Ritter: „Das war nicht mein Pferd, das war meine Schwiegermutter!“" }, { text: "Ihr lacht schallend. Kunibert strahlt, wird ganz hell – und löst sich glücklich auf. Wo er schwebte, liegt ein Heiltrank." }], item: "potion-of-healing", fx: "sparkle" },
          failure: { narration: [{ text: "Euer Lachen klingt so falsch, dass Kunibert beleidigt heult. Eiskalter Wind fährt euch in die Knochen." }], hurtAll: "1d3" },
        },
      },
      walkOn("„Keiner will ihn hören!“, jammert Kunibert und verschwindet in der Wand. Irgendwo hört ihr ihn den Witz sich selbst erzählen."),
    ],
  },
  {
    id: "kobold_zoll",
    title: "Kobold-Zollstation",
    where: (p) => UNDERGROUND.includes(p.theme) || p.theme === "forest",
    visitor: { monster: "kobold", name: "Zöllner Knorz" },
    intro: [{ text: "Quer über dem Weg: ein wackeliger Schlagbaum aus Ästen. Daneben ein Kobold mit viel zu großem Hut." }, { npc: "Zöllner Knorz", text: "Halt! Kobold-Zoll! Zwei Münzen pro Nase. Oder ein Kompliment für meinen Hut." }],
    choices: [
      { id: "zahlen", label: "🪙 Zahlen (2 Gold)", detail: "Der Weg ist frei.", cost: 2, outcome: { narration: [{ npc: "Zöllner Knorz", text: "Sehr gut! Gute Reise! Achtung, da vorn ist eine Falle. War ein Witz. Oder?" }] } },
      {
        id: "kompliment",
        label: "🎩 Den Hut loben",
        detail: "Überzeugen SG 12",
        check: {
          skill: "persuasion",
          dc: 12,
          success: { narration: [{ npc: "Zöllner Knorz", text: "Wirklich?! Das hat noch nie jemand gesagt!" }, { text: "Gerührt öffnet er den Schlagbaum – und schenkt euch seine ganze Zollkasse." }], gold: 4 },
          failure: { narration: [{ npc: "Zöllner Knorz", text: "Ihr macht euch lustig! ALARM!" }, { text: "Aus allen Ritzen kommen Kobolde." }], fight: [{ monster: "kobold", count: 2, name: "Zoll-Kobold" }] },
        },
      },
    ],
  },
  {
    id: "zauberspiegel",
    title: "Ein Spiegel, der antwortet",
    where: (p) => INDOOR.includes(p.theme),
    intro: [{ text: "An der Wand hängt ein verstaubter Spiegel. Als ihr hineinseht, räuspert er sich." }, { text: "„Spieglein, Spieglein … ach, fragt einfach. Ich sage immer die Wahrheit. Leider.“" }],
    choices: [
      {
        id: "fragen",
        label: "🪞 „Wer ist der Schönste hier?“",
        detail: "Weisheit (Motiv erkennen) SG 12 – verkraftet ihr die Antwort?",
        check: {
          skill: "insight",
          dc: 12,
          success: { narration: [{ text: "„Ehrlich? Die Spinne da oben in der Ecke.“ Ihr lacht – und der Spiegel verrät zur Belohnung, wo hinter ihm ein Beutel klemmt." }], gold: 4 },
          failure: { narration: [{ text: "Der Spiegel zählt ausführlich alle Nasenhaare, Warzen und Frisurfehler auf. Es dauert lange. Sehr lange." }, { text: "Gekränkt, aber unverletzt, zieht ihr weiter." }] },
        },
      },
      walkOn("„Feiglinge!“, ruft der Spiegel. „Ihr habt übrigens Spinat zwischen den Zähnen.“"),
    ],
  },
  {
    id: "gefesselter_ritter",
    title: "Ein gefesselter Ritter",
    where: (p) => !PEOPLE.includes(p.theme) && !UNDERGROUND.includes(p.theme),
    visitor: { monster: "bandit", name: "„Ritter“ Kasimir" },
    intro: [{ text: "An einen Baum gebunden: ein Mann in rostiger Rüstung." }, { npc: "„Ritter“ Kasimir", text: "Helft mir! Räuber haben mich überfallen! Bindet mich los, ich belohne euch fürstlich!" }],
    choices: [
      {
        id: "pruefen",
        label: "🔍 Erst mal Fragen stellen",
        detail: "Motiv erkennen SG 13",
        check: {
          skill: "insight",
          dc: 13,
          success: { narration: [{ text: "Seine „Rüstung“ ist aus bemalten Topfdeckeln – und der Knoten sitzt vorne. Er hat sich selbst gefesselt! Eine Räuberfalle." }, { text: "Ihr lasst ihn hängen. Seine Kumpane im Gebüsch schleichen enttäuscht davon und lassen ihren Proviantsack zurück." }], item: "potion-of-healing" },
          failure: { narration: [{ text: "Kaum ist er los, pfeift er schrill. „Danke, Trottel!“ Räuber springen aus dem Gebüsch!" }], fight: [{ monster: "bandit", count: 2, name: "Räuber" }] },
        },
      },
      {
        id: "losbinden",
        label: "✂️ Sofort losbinden",
        detail: "Ein Held zögert nicht!",
        outcome: { narration: [{ text: "Kaum ist er los, pfeift er schrill. „Danke, Trottel!“ Räuber springen aus dem Gebüsch!" }], fight: [{ monster: "bandit", count: 2, name: "Räuber" }] },
      },
      walkOn("„Hey! Ihr könnt mich doch nicht … na gut, dann binde ich mich eben selbst los.“ Was er erstaunlich schnell schafft."),
    ],
  },
  {
    id: "drache_im_stall",
    title: "Der furchtbare Drache",
    where: (p) => p.theme === "village" || p.theme === "meadow" || p.theme === "town",
    visitor: { monster: "commoner", name: "Bauer Egon" },
    intro: [{ npc: "Bauer Egon", text: "Helden! Endlich! In meinem Stall haust ein DRACHE! Er faucht, er spuckt Feuer … na ja, fast!" }],
    choices: [
      {
        id: "stall",
        label: "🗡️ In den Stall",
        detail: "Mit Tieren umgehen SG 11",
        check: {
          skill: "animal-handling",
          dc: 11,
          success: { narration: [{ text: "Im Stroh sitzt … eine Eidechse. Eine sehr wütende, sehr kleine Eidechse, die faucht wie ein Teekessel." }, { text: "Ihr tragt sie behutsam in den Wald. Bauer Egon zahlt trotzdem, als hättet ihr einen Drachen erschlagen." }], gold: 5 },
          failure: { narration: [{ text: "Im Stroh sitzt eine winzige Eidechse. Sie beißt euch in den Finger, entwischt und verschwindet im Heu." }, { npc: "Bauer Egon", text: "Ich hab’s euch gesagt! Ein Ungeheuer!" }], hurt: "1d2" },
        },
      },
      walkOn("„Keiner glaubt mir!“, ruft Bauer Egon. Aus dem Stall kommt ein Fauchen – wie ein sehr kleiner Teekessel."),
    ],
  },
  {
    id: "zwilling",
    title: "Ein bekanntes Gesicht",
    where: (p) => PEOPLE.includes(p.theme),
    intro: [{ text: "Jemand aus eurer Gruppe wird von einer Fremden stürmisch umarmt. „Da bist du ja endlich! Du schuldest mir noch drei Goldstücke!“" }, { text: "Sie hält euch offenbar für jemand anderen. Oder …?" }],
    choices: [
      {
        id: "mitspielen",
        label: "🎭 Mitspielen",
        detail: "Täuschen SG 13",
        check: {
          skill: "deception",
          dc: 13,
          success: { narration: [{ text: "„Drei? Es waren doch dreißig, die DU MIR schuldest!“ Verwirrt zahlt sie euch ein paar Münzen und entschuldigt sich." }], gold: 4 },
          failure: { narration: [{ text: "Sie kneift die Augen zusammen: „Moment … du bist gar nicht Hans!“ Eine Ohrfeige, dann ist sie weg. Die Wange brennt." }], hurt: "1d2" },
        },
      },
      walkOn("Ihr klärt das Missverständnis. Sie wird rot und verschwindet in der Menge. Irgendwo da draußen läuft euer Doppelgänger herum …"),
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
