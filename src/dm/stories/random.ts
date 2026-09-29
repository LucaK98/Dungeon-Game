/**
 * Random adventures: about 30 minutes, put together from a quest, a place, a villain and a twist.
 * The result is an ordinary story (same format as the written ones), so the director, the AI game
 * master, the campfire, votes and saves all work as usual. The seed is part of the id
 * ("zufall-12345"): a saved random adventure is rebuilt exactly the same.
 */
import { seededRng, type Rng } from "../../engine/rng";
import type { Clue, Ending, MonsterGroup, Narration, Scene, Story, StoryNpc, Truth } from "../../shared/story";

export const RANDOM_PREFIX = "zufall-";

const T = (text: string, npc?: string, tip?: { key: string; text: string }): Narration => ({ text, ...(npc ? { npc } : {}), ...(tip ? { tip } : {}) });

interface Home {
  room: string;
  /** The room's name on the TV. */
  name: string;
  /** The place, for sentences like "Ihr kommt nach …". */
  town: string;
  giverMonster: string;
  arrive: string;
}

const HOMES: Home[] = [
  { room: "harzdorf", name: "Dorfplatz von Tannenbrück", town: "Tannenbrück", giverMonster: "commoner", arrive: "Ein kleines Dorf zwischen dunklen Tannen. Die Leute schauen euch hoffnungsvoll an." },
  { room: "marktplatz", name: "Marktplatz von Eichenhall", town: "Eichenhall", giverMonster: "noble", arrive: "Ein Marktplatz voller Stände – doch heute lacht niemand, und die Glocke schweigt." },
  { room: "wirtshaus", name: "Gasthof „Zum Wilden Mann“", town: "Wildenau", giverMonster: "commoner", arrive: "Ein warmer Gasthof am Waldrand. Am Tresen wartet jemand ungeduldig auf euch." },
  { room: "burghof", name: "Burghof von Falkenstein", town: "Falkenstein", giverMonster: "noble", arrive: "Eine kleine Burg auf einem Felsen. Die Wachen öffnen euch sofort das Tor." },
];

const GIVERS = [
  { name: "Müllerin Gerda", title: "die Müllerin" },
  { name: "Schultheiß Anselm", title: "der Schultheiß" },
  { name: "Gräfin Irmgard", title: "die Gräfin" },
  { name: "Wirt Bartholomäus", title: "der Wirt" },
  { name: "Förster Ruprecht", title: "der Förster" },
];

/** A name in the cases the texts need: "der Oger" – "vom Oger" – "den Oger". */
interface VName {
  nom: string;
  dat: string;
  acc: string;
}

interface Villain {
  id: string;
  names: VName[];
  boss: string;
  minions: { monster: string; name: string; plural: string }[];
  road: string[];
  lair: string[];
  entrance: string[];
  /** A curse or a blackmail that could explain it (twist "fluch"). */
  cursed: string;
  look: string;
}

const VILLAINS: Villain[] = [
  { id: "raeuber", names: [{ nom: "Raubritter Kuno der Schwarze", dat: "Raubritter Kuno dem Schwarzen", acc: "Raubritter Kuno den Schwarzen" }, { nom: "Bandenführerin Grete Eisenhand", dat: "Bandenführerin Grete Eisenhand", acc: "Bandenführerin Grete Eisenhand" }], boss: "bandit-captain", minions: [{ monster: "bandit", name: "Räuber", plural: "Räuber" }, { monster: "thug", name: "Schläger", plural: "Schläger" }], road: ["waldweg"], lair: ["hoehle"], entrance: ["gang_knick"], cursed: "wird von einem fremden Fürsten erpresst, der die eigene Familie gefangen hält", look: "mit Narbe und Federhut" },
  { id: "oger", names: [{ nom: "der Oger Grummelbauch", dat: "dem Oger Grummelbauch", acc: "den Oger Grummelbauch" }, { nom: "die Ogerin Knochenbrecherin", dat: "der Ogerin Knochenbrecherin", acc: "die Ogerin Knochenbrecherin" }], boss: "ogre", minions: [{ monster: "goblin", name: "Goblin", plural: "Goblins" }, { monster: "wolf", name: "Wolf", plural: "Wölfe" }], road: ["bruecke"], lair: ["hoehle"], entrance: ["hoehlenstollen"], cursed: "hat einen Dorn im Fuß, der ihn vor Schmerz rasend macht", look: "so groß wie ein Scheunentor" },
  { id: "nekromant", names: [{ nom: "der Totenbeschwörer Mortimer", dat: "dem Totenbeschwörer Mortimer", acc: "den Totenbeschwörer Mortimer" }, { nom: "die Knochenhexe Walpurga", dat: "der Knochenhexe Walpurga", acc: "die Knochenhexe Walpurga" }], boss: "cult-fanatic", minions: [{ monster: "skeleton", name: "Skelett", plural: "Skelette" }, { monster: "zombie", name: "Zombie", plural: "Zombies" }], road: ["gang_gerade"], lair: ["gruft"], entrance: ["saeulenhalle"], cursed: "steht selbst unter dem Bann eines alten Totenschädels", look: "in einer Kutte voller Knochen" },
  { id: "vettel", names: [{ nom: "die Moorvettel Muhme Mahlstrom", dat: "der Moorvettel Muhme Mahlstrom", acc: "die Moorvettel Muhme Mahlstrom" }, { nom: "die Vettel Graugrete", dat: "der Vettel Graugrete", acc: "die Vettel Graugrete" }], boss: "green-hag", minions: [{ monster: "wolf", name: "Wolf", plural: "Wölfe" }, { monster: "swarm-of-bats", name: "Fledermausschwarm", plural: "Fledermausschwärme" }], road: ["harzwald"], lair: ["hexentanzplatz"], entrance: ["bergpfad"], cursed: "ist nur so böse geworden, weil das Dorf sie einst verjagt hat", look: "mit grüner Haut und langen Fingern" },
  { id: "werwolf", names: [{ nom: "der Werwolf von Grauheide", dat: "dem Werwolf von Grauheide", acc: "den Werwolf von Grauheide" }, { nom: "der Wolfsmann Isegrim", dat: "dem Wolfsmann Isegrim", acc: "den Wolfsmann Isegrim" }], boss: "werewolf-hybrid", minions: [{ monster: "wolf", name: "Wolf", plural: "Wölfe" }, { monster: "dire-wolf", name: "Schreckenswolf", plural: "Schreckenswölfe" }], road: ["waldweg"], lair: ["hoehle"], entrance: ["harzwald"], cursed: "ist eigentlich ein Mensch – ein Fluch verwandelt ihn bei Vollmond", look: "halb Mensch, halb Wolf" },
  { id: "spinne", names: [{ nom: "die Spinnenkönigin Arachna", dat: "der Spinnenkönigin Arachna", acc: "die Spinnenkönigin Arachna" }, { nom: "die Nebelspinne Webmutter", dat: "der Nebelspinne Webmutter", acc: "die Nebelspinne Webmutter" }], boss: "giant-spider", minions: [{ monster: "giant-rat", name: "Riesenratte", plural: "Riesenratten" }, { monster: "swarm-of-rats", name: "Rattenschwarm", plural: "Rattenschwärme" }], road: ["hoehlenstollen"], lair: ["kristallgrotte"], entrance: ["gang_knick"], cursed: "verteidigt nur ihr Nest mit hunderten Spinneneiern", look: "mit acht glühenden Augen" },
];

interface Quest {
  id: string;
  title: (v: VName) => string;
  ask: (v: VName) => string;
  goal: string;
  victim: string;
}

const QUESTS: Quest[] = [
  { id: "entfuehrung", title: (v) => `Entführt ${von(v)}`, ask: (v) => `${capital(v.nom)} hat meine Tochter Liese entführt! Bitte bringt sie zurück!`, goal: "Liese befreien", victim: "Liese" },
  { id: "diebstahl", title: (v) => `Der Glücksstein und ${v.nom}`, ask: (v) => `${capital(v.nom)} hat unseren Glücksstein gestohlen – das Herz des Dorfes! Holt ihn zurück!`, goal: "Den Glücksstein zurückholen", victim: "der Glücksstein" },
  { id: "plage", title: (v) => `Die Plage ${von(v)}`, ask: (v) => `Jede Nacht kommen die Diener ${von(v)} und plündern unsere Höfe. Macht dem ein Ende!`, goal: "Die Plage beenden", victim: "das Dorf" },
];

type TruthId = "boese" | "verrat" | "fluch";

/** "von" + dative, contracted: "vom Oger", "von der Vettel", "von Raubritter Kuno". */
function von(v: VName): string {
  return v.dat.startsWith("dem ") ? `vom ${v.dat.slice(4)}` : `von ${v.dat}`;
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pick<T>(rng: Rng, list: T[]): T {
  return list[rng.int(0, list.length - 1)]!;
}

export function isRandomStoryId(id: string): boolean {
  return id.startsWith(RANDOM_PREFIX) && Number.isFinite(Number(id.slice(RANDOM_PREFIX.length)));
}

/** A new random adventure (a fresh seed each time). */
export function newRandomStory(seed = Math.floor(Math.random() * 1e9)): Story {
  return generateStory(seed);
}

export function generateStory(seed: number): Story {
  const rng = seededRng(seed);
  const home = pick(rng, HOMES);
  const giver = pick(rng, GIVERS);
  const villain = pick(rng, VILLAINS);
  const vn = pick(rng, villain.names);
  const vName = vn.nom;
  const quest = pick(rng, QUESTS);
  // Two of the three truths are possible in this adventure; the game rolls one of them secretly.
  const all: TruthId[] = ["boese", "verrat", "fluch"];
  all.splice(rng.int(0, 2), 1);
  const truthIds = all;
  const minion = villain.minions[0]!;
  const minion2 = villain.minions[1] ?? minion;

  const truthsAll: Record<TruthId, Truth> = {
    boese: {
      id: "boese",
      title: `${capital(vName)} ist wirklich böse`,
      summary: `${capital(vName)} wollte die Gegend beherrschen – ohne Grund, ohne Gnade. ${giver.name} hat euch ehrlich um Hilfe gebeten.`,
      reveal: [T(`${capital(vName)} lacht, dass die Wände beben. „Ihr kleinen Helden glaubt, ihr könnt mich aufhalten?“`), T("Kein Trick, kein Fluch – nur pure Bosheit. Jetzt heißt es kämpfen!")],
    },
    verrat: {
      id: "verrat",
      title: `${giver.name} steckt dahinter`,
      summary: `${giver.name} hat ${vn.acc} heimlich bezahlt, damit das Dorf in Not gerät – um danach als Retter dazustehen und mehr Macht zu bekommen. Ihr solltet ${vn.acc} ausschalten, bevor jemand die Wahrheit erfährt.`,
      reveal: [T(`${capital(vName)} hält einen Beutel voller Gold hoch. „Ihr wurdet geschickt? Von ${giver.name}? Ha! Genau dieser Mensch hat mich bezahlt!“`), T("Auf dem Beutel prangt das Siegel eures Auftraggebers …")],
    },
    fluch: {
      id: "fluch",
      title: `${capital(vName)} ist nicht frei`,
      summary: `${capital(vName)} ${villain.cursed}. Wer genau hinsieht und redet, kann den Kampf vielleicht vermeiden.`,
      reveal: [T(`${capital(vName)} taumelt, hält sich den Kopf. „Ich … ich will das doch gar nicht …“`), T(`Ihr begreift: ${capital(vName)} ${villain.cursed}.`)],
    },
  };
  const truths = truthIds.map((t) => truthsAll[t]);

  // Three clue slots in mandatory scenes, one clue per truth each.
  const clueText: Record<TruthId, [string, string, string]> = {
    boese: [
      `Ein alter Mann: „${capital(vName)} hat schon drei Dörfer niedergebrannt. Einfach so, aus Spaß.“`,
      `Am Wegrand: eine zerbrochene Puppe und eine Schmähschrift ${von(vn)}: „Alles hier gehört bald mir!“`,
      `Am Eingang des Verstecks: Trophäen besiegter Ritter. ${capital(vName)} verschont niemanden.`,
    ],
    verrat: [
      `Ein Knecht flüstert: „${giver.name} war letzte Woche nachts im Wald. Mit einem schweren Beutel.“`,
      `Bei den ${minion.plural}: neue Münzen – frisch geprägt, mit dem Wappen von ${home.town}.`,
      `Am Eingang: ein Brief. „Die Hälfte jetzt, die Hälfte, wenn das Dorf verzweifelt ist. – ${giver.name.split(" ")[0]}“`,
    ],
    fluch: [
      `Eine Kräuterfrau: „${capital(vName)} war früher anders. Irgendetwas ist geschehen …“`,
      `Die ${minion.plural} wirken, als würden sie von etwas getrieben, nicht aus eigenem Willen.`,
      `Am Eingang: seltsame Zeichen, halb weggekratzt – als hätte jemand versucht, einen Bann zu lösen.`,
    ],
  };
  const clues: Clue[] = truthIds.flatMap((t) => clueText[t].map((text, i) => ({ id: `${t}_${i}`, text, truth: t })));
  const slot = (i: number) => ({ id: `s${i}`, byTruth: Object.fromEntries(truthIds.map((t) => [t, `${t}_${i}`])) });

  const giverNpc: StoryNpc = { id: "auftraggeber", name: giver.name, monster: home.giverMonster, description: `${capital(giver.title)} von ${home.town}.`, secretGoal: "Je nach Wahrheit: ehrlich verzweifelt – oder heimlich der Drahtzieher." };
  const npcs: StoryNpc[] = [giverNpc];

  const minions = (count: number, per = 1): MonsterGroup[] => [{ monster: minion.monster, count, perExtraPlayer: per, name: minion.name }];
  const scenes1: Scene[] = [
    {
      id: "auftrag",
      title: home.name,
      rooms: [home.room],
      roomNames: { [home.room]: home.name },
      pflicht: true,
      dauer_min: 7,
      mindestDauer: "kurz",
      ziel: `Mit ${giver.name} sprechen`,
      npcs: [{ npc: "auftraggeber" }],
      clues: [slot(0)],
      keywords: [{ words: ["belohnung", "gold", "lohn"], response: [T("„Hundert Goldstücke, wenn ihr Erfolg habt!“", giver.name)] }],
      steps: [
        { id: "hingehen", kind: "reach", target: "auftraggeber", enter: [T(home.arrive), T(`Geht zu ${giver.name}.`)] },
        { id: "bitte", kind: "narrate", enter: [T(quest.ask(vn), giver.name), T(`„${capital(vName)} ist ${villain.look}. Das Versteck liegt hinter dem ${villain.road[0] === "bruecke" ? "Fluss" : "Wald"}.“`, giver.name)], clues: ["s0"] },
        {
          id: "vorbereitung",
          kind: "choice",
          enter: [T("Wie bereitet ihr euch vor?")],
          choices: [
            { id: "ausfragen", label: "Die Leute ausfragen", detail: "Motiv erkennen gegen SG 11", check: { skill: "insight", dc: 11, success: { narration: [T("Ihr hört genau hin – und merkt euch jedes Detail.")], set: ["gut_vorbereitet"] }, failure: { narration: [T("Alle reden durcheinander. Viel schlauer seid ihr nicht.")] } } },
            { id: "vorraete", label: "Vorräte besorgen", detail: "Jeder bekommt einen Heiltrank", outcome: { narration: [T(`${giver.name} gibt euch Heiltränke mit auf den Weg.`)], item: { id: "potion-of-healing", qty: 1 } } },
            { id: "sofort", label: "Sofort aufbrechen", detail: "Keine Zeit verlieren", outcome: { narration: [T("Ihr schultert eure Sachen und zieht los.")], set: ["schnell"] } },
          ],
        },
      ],
    },
    {
      id: "weg",
      title: "Der Weg",
      rooms: [...villain.road],
      pflicht: true,
      dauer_min: 8,
      mindestDauer: "kurz",
      ziel: "Den Weg zum Versteck freikämpfen",
      travel: `Ihr folgt den Spuren ${von(vn)}.`,
      clues: [slot(1)],
      steps: [
        { id: "hinterhalt", kind: "fight", fight: minions(2), enter: [T(`${minion.plural} springen aus dem Hinterhalt – Diener ${von(vn)}!`)], done: [T("Der Weg ist frei. Bei den Besiegten findet ihr etwas …")], clues: ["s1"] },
        { id: "weiter", kind: "reach", target: "exit", enter: [T("Weiter geht's. Das Versteck kann nicht mehr weit sein.")] },
      ],
    },
    {
      id: "umweg",
      title: "Der alte Umweg",
      rooms: ["stadtgasse", "waldweg"].includes(villain.road[0]!) ? ["bruecke"] : ["waldweg"],
      pflicht: false,
      dauer_min: 8,
      mindestDauer: "mittel",
      ziel: "Den Wachposten umgehen",
      travel: "Ein Hirte zeigt euch einen geheimen Pfad.",
      steps: [
        {
          id: "posten",
          kind: "choice",
          enter: [T(`Ein Wachposten ${von(vn)} versperrt den Pfad.`)],
          choices: [
            { id: "schleichen", label: "Vorbeischleichen", detail: "Heimlichkeit gegen SG 12", check: { skill: "stealth", dc: 12, success: { narration: [T("Lautlos wie Schatten zieht ihr vorbei.")], set: ["ungesehen"] }, failure: { narration: [T("Ein Ast knackt! Die Wache ruft Verstärkung!")], fight: [{ monster: minion2.monster, count: 1, perExtraPlayer: 1, name: minion2.name }] } } },
            { id: "kaempfen", label: "Angreifen", detail: "Den Posten ausschalten", outcome: { narration: [T("Ihr stürmt los!")], fight: [{ monster: minion2.monster, count: 1, perExtraPlayer: 1, name: minion2.name }] } },
          ],
        },
      ],
    },
  ];
  const scenes2: Scene[] = [
    {
      id: "eingang",
      title: "Der Eingang",
      rooms: [...villain.entrance],
      pflicht: true,
      dauer_min: 7,
      mindestDauer: "kurz",
      ziel: "In das Versteck gelangen",
      travel: `Endlich: das Versteck ${von(vn)}.`,
      clues: [slot(2)],
      steps: [
        { id: "spuren", kind: "narrate", enter: [T("Am Eingang bleibt ihr stehen. Hier stimmt etwas nicht …")], clues: ["s2"] },
        { id: "falle", kind: "check", check: { skill: "perception", dc: 12, who: "one", title: "Fallen am Eingang", success: { narration: [T("Ihr entdeckt einen Stolperdraht und steigt vorsichtig darüber.")] }, failure: { narration: [T("Klack! Steine prasseln von der Decke!")], damage: "1d6" } }, enter: [T("Ihr tastet euch vorsichtig voran.")] },
        { id: "tiefer", kind: "reach", target: "exit", enter: [T("Tiefer hinein.")] },
      ],
    },
    {
      id: "schatz",
      title: "Die Schatzkammer",
      rooms: ["schatzkammer"],
      pflicht: false,
      dauer_min: 8,
      mindestDauer: "lang",
      ziel: "Die Schatzkammer durchsuchen",
      travel: "Ein Seitengang führt zu einer schweren Tür.",
      steps: [
        { id: "waechter", kind: "fight", fight: [{ monster: minion2.monster, count: 1, perExtraPlayer: 1, name: `${minion2.name} (Wache)` }], enter: [T("Die Schatzkammer wird bewacht!")] },
        { id: "truhe", kind: "use_item", enter: [T("Eine Truhe voller Beute. Öffnet sie!")] },
      ],
    },
    {
      id: "finale",
      title: `Das Versteck ${von(vn)}`,
      rooms: [...villain.lair],
      pflicht: true,
      dauer_min: 9,
      mindestDauer: "kurz",
      ziel: capital(quest.goal),
      steps: [
        { id: "begegnung", kind: "narrate", twist: true, enter: [T(`Da ist ${vName} – ${villain.look}.${quest.id === "entfuehrung" ? " In einer Ecke kauert Liese." : quest.id === "diebstahl" ? " Dahinter funkelt der Glücksstein." : ""}`)] },
        {
          id: "wahl",
          kind: "choice",
          enter: [T("Was tut ihr?")],
          choices: [
            { id: "kampf", label: "Angreifen!", detail: "Der Endkampf beginnt", outcome: { narration: [T("Die Waffen blitzen – der Endkampf beginnt!")], goto: "endkampf" } },
            { id: "reden", label: "Reden und den Bann brechen", detail: "Überzeugen gegen SG 13", truths: ["fluch"], check: { skill: "persuasion", dc: 13, success: { narration: [T(`Eure Worte dringen durch. ${capital(vName)} sinkt auf die Knie – frei.`)], set: ["bann_gebrochen"], endScene: true }, failure: { narration: [T(`${capital(vName)} brüllt auf. Der Bann ist zu stark – es gibt keinen anderen Weg.`)], goto: "endkampf" } } },
            { id: "beweis", label: "Den Beweis für den Verrat einstecken", detail: "Das Siegel mitnehmen", truths: ["verrat"], outcome: { narration: [T("Ihr schnappt euch den Beutel mit dem Siegel. Jetzt habt ihr einen Beweis!")], set: ["beweis"], goto: "endkampf" } },
          ],
        },
        { id: "endkampf", kind: "fight", fight: [{ monster: villain.boss, count: 1, boss: true, name: capital(vName) }, { monster: minion.monster, count: 0, perExtraPlayer: 1, name: minion.name }], enter: [T(`${capital(vName)} greift an!`)], set: ["schurke_besiegt"] },
      ],
    },
  ];

  const endings: Ending[] = [
    { id: "scheitern", title: "Eine zweite Chance", kind: "scheitern", requires: ["niederlage_boss"], text: [T("Ihr erwacht vor dem Versteck. Jemand hat euch hinausgeschleppt."), T("Noch ist nicht alles verloren. Versucht es noch einmal!")] },
    { id: "erloest", title: "Der gebrochene Bann", kind: "friedlich", requires: ["bann_gebrochen"], truths: ["fluch"], text: [T(`${capital(vName)} ist frei vom Fluch und hilft, alles wiedergutzumachen.`), T(`In ${home.town} feiert man euch – und bald versöhnt sich das Dorf auch mit ${vn.dat}.`)] },
    { id: "entlarvt", title: "Der wahre Schurke", kind: "sieg", requires: ["beweis"], truths: ["verrat"], text: [T(`Vor dem ganzen Dorf legt ihr den Beweis auf den Tisch. ${giver.name} wird blass – und muss gestehen.`), T(`${capital(quest.victim)} ist gerettet, und ${home.town} hat einen neuen, ehrlicheren Vorstand.`)] },
    { id: "bittersuess", title: "Gewonnen – aber betrogen", kind: "bittersuess", truths: ["verrat"], text: [T(`${capital(vName)} ist besiegt. ${giver.name} bedankt sich überschwänglich … und ihr werdet das Gefühl nicht los, dass etwas nicht stimmt.`)] },
    { id: "sieg", title: "Die Helden von " + home.town, kind: "sieg", text: [T(`${capital(vName)} ist besiegt! ${quest.id === "entfuehrung" ? "Liese fällt ihrer Mutter in die Arme." : quest.id === "diebstahl" ? "Der Glücksstein leuchtet wieder auf dem Dorfplatz." : "Nachts ist es endlich wieder still."}`), T(`${home.town} feiert euch mit einem Fest bis zum Morgengrauen.`)] },
  ];

  const title = quest.title(vn);
  return {
    id: `${RANDOM_PREFIX}${seed}`,
    title: capital(title),
    subtitle: "Zufallsabenteuer (ca. 30 Minuten)",
    description: `${quest.ask(vn).replace(/!$/, ".")} Ein zufällig zusammengesetztes Abenteuer – jedes Mal anders.`,
    recommended: false,
    cover: [`monster.${villain.boss}`, `monster.${minion.monster}`, "chest.closed"],
    intro: [T(`🎲 Ihr kommt nach ${home.town}. Schon am Ortseingang hört ihr ${von(vn)} …`)],
    truths,
    clues,
    npcs,
    acts: [
      { id: "akt1", title: "Der Auftrag", level: 1, scenes: scenes1 },
      { id: "akt2", title: `Das Versteck ${von(vn)}`, level: 2, scenes: scenes2 },
    ],
    endings,
    events: [{ id: "hinterhalt2", title: "Noch ein Hinterhalt", narration: [T(`Auf dem Rückweg lauern euch die letzten Diener ${von(vn)} auf!`)], fight: minions(1) }],
  };
}
