/**
 * Free text → one of the hero's own buttons: "Ich ramme dem Goblin mein Rapier in den Bauch"
 * becomes the rapier attack on the goblin, "Ich schieße auf ihn" the bow, "Ich heile Ole" the healing spell.
 * Only what the hero really can do is picked; tricks (push, sand, bribe …) stay free actions.
 */
import type { PlayerAction } from "./events";
import type { ActionChoice } from "./view";

export interface IntentMatch {
  choice: ActionChoice;
  action: PlayerAction;
  /** Names of the targets, for the log ("Rapier auf Goblin 1"). */
  targetNames: string[];
}

/** `ask`: not clear which one is meant – the phone asks „Meinst du …?“ with these options. */
export type MatchOutcome = { match: IntentMatch } | { ask: IntentMatch[] } | { blocked: string; choice: ActionChoice } | undefined;

const has = (t: string, re: RegExp) => re.test(t);

const MELEE = /\b(stech|stich|schlag|schläg|schlägt|hau(?:e|t|st)?\b|hieb|ramm|schneid|spieß|spiess|spalt|zertrümmer|prügel|schwing|durchbohr|aufspieß|köpf)/;
const RANGED = /\b(schieß|schiess|schoss|pfeil|bogen|armbrust|bolzen|ziele auf|feuere|leg an)/;
const THROW = /\b(wirf|werf|schleuder)/;
const ATTACK = /\b(greif|angriff|attack|töte|kämpf|erledig|besieg|tritt|trete|treffe|verprügel|zuschlag|biss|beiß|beiss)/;
const SPELL = /\b(zauber|magie|magisch|spruch|beschwör)/;
const HEAL = /\b(heil|verarzt|wunde|rette|trank|aufhelf|wiederbeleb)|helfe? \w+ auf\b|\b(gib|gebe|reich|flöß)\w* .*trank/;
const SELF = /\b(mich|mir|selbst)\b/;
const THING = /\b(tür|tor|fass|fässer|kiste|tisch|truhe|wand|schloss|regal|stuhl|hocker|bank|krug|seil|kronleuchter|hebel|brunnen|altar|sarg)\w*/;

/** Extra words per weapon or spell (lower case, word starts). */
const SYNONYMS: [RegExp, RegExp][] = [
  [/knüppel/, /\b(knüppel|keule|prügel)/],
  [/dolch/, /\b(dolch|messer)/],
  [/axt/, /\b(axt|beil)/],
  [/speer/, /\b(speer|lanze|spieß|spiess)/],
  [/streitkolben/, /\b(kolben|keule)/],
  [/kampfstab/, /\b(stab|stock)/],
  [/armbrust/, /\b(armbrust|bolzen)/],
  [/bogen/, /\b(bogen|pfeil)/],
  [/schwert|zweihänder|rapier/, /\b(schwert|klinge|degen|rapier|zweihänder)/],
  [/kriegshammer/, /\b(hammer)/],
  [/waffenlos|faust/, /\b(faust|fäuste|box|tritt|trete|kick|schlag ihm|schlage ihm)/],
  [/wolfsbiss/, /\b(biss|beiß|beiss|zähne)/],
  [/feuerpfeil/, /\b(feuer|flamme|brenn)/],
  [/froststrahl/, /\b(frost|eis|kälte|gefrier)/],
  [/heilige flamme/, /\b(heilige|göttlich|licht)/],
  [/magisches geschoss/, /\b(geschoss|geschosse)/],
  [/brennende hände/, /\b(brennend|hände|feuer|flamme)/],
  [/schlaf/, /\b(schlaf|einschläfer|müde)/],
  [/heilende|heilendes|heilung/, /\b(heil)/],
  [/segnen/, /\b(segen|segne|segn)/],
  [/lenkendes geschoss/, /\b(lenkend|lichtblitz)/],
  [/schild des glaubens/, /\b(schild|schütz|beschütz)/],
  [/göttliche gunst/, /\b(gunst)/],
  [/sengender strahl/, /\b(strahl|seng)/],
  [/feuerball/, /\b(feuerball|explosion|explodier)/],
  [/gehässiger spott/, /\b(spott|verspott|beleidig|beschimpf)/],
  [/flammen erzeugen/, /\b(flamme)/],
  [/donnerwoge/, /\b(donner|woge|druckwelle)/],
  [/mal des jägers/, /\b(mal |markier)/],
];

/**
 * Things, furniture and abilities: what the verb in the text has to fit ("umwerfen" → "Tisch umwerfen").
 * [label pattern, verbs in the text]
 */
const UTILITY_VERBS: [RegExp, RegExp][] = [
  [/umwerfen|umkippen|umstoßen/, /\b(umwerf|umkipp|kipp|umstoß|umschmeiß|wirf \w+ um|werfe? \w+ \w* ?um\b|stoß \w+ um)/],
  [/werfen|schleudern|rollen/, /\b(wirf|werf|schleuder|roll|schmeiß|kick)/],
  [/zerschlagen|aufbrechen/, /\b(zerschlag|zertrümmer|kaputt|aufbrech|zerbrech|zerdepper|schlag \w+ kaputt)/],
  [/stöbern|durchsuchen/, /\b(durchsuch|stöber|such|wühl|lies|lese|blätter|schau \w+ nach)/],
  [/sammeln|abfüllen|aufheben/, /\b(sammel|pflück|nehm|nimm|pack|abfüll|füll|aufheb|heb|einsteck|steck)/],
  [/essen|probieren|kosten/, /\b(ess|iss|probier|kost|knabber|verspeis|nasch)/],
  [/anzünden/, /\b(anzünd|zünd|entfach|mach \w+ an)/],
  [/löschen/, /\b(lösch|ausblas|auspust|mach \w+ aus)/],
  [/beten/, /\b(bet|gebet)/],
  [/münze/, /\b(münze|wunsch|wünsch)/],
  [/öffnen|aufschieben/, /\b(öffn|aufmach|mach \w+ auf|aufschieb|schieb|aufbrech)/],
  [/ziehen/, /\b(zieh|drück|beweg)/],
  [/rasten/, /\b(rast|ausruh|wärm|setz)/],
  [/abstürzen/, /\b(abstürz|runter|schieß|schneid|kapp|lass)/],
  [/trank|leuchttrank|stärketrank|bärenkraft/, /\b(trink|schluck|nipp|kipp \w+ runter)/],
  [/stolperdraht/, /\b(spann|stolperdraht|leg|stell)/],
  [/fackel/, /\b(fackel|licht)/],
];

/** Class abilities by their everyday words (feature id → words). */
const FEATURE_WORDS: Record<string, RegExp> = {
  "second-wind": /\b(durchatm|atme \w* ?durch|verschnauf|luft hol|sammle mich)/,
  "action-surge": /\b(tatendrang|alles geben|noch einmal zuschlagen|extra aktion)/,
  "turn-undead": /\b(untote \w* ?vertreib|vertreib\w* \w* ?untote|heilige symbol)/,
  "wild-shape": /\b(tiergestalt|verwandl\w* mich|werde \w* ?wolf|wolfsgestalt)/,
  "martial-arts": /\b(kampfkunst|extraschlag)/,
  "flurry-of-blows": /\b(schlaghagel|hagel von schlägen|trommel)/,
  "patient-defense": /\b(geduldig\w* abwehr|abwehrhaltung)/,
  "step-of-the-wind": /\b(schritt des windes)/,
  dash: /\b(sprint|spurt|renne so schnell|renn los|lauf so schnell)/,
  disengage: /\b(rückzug|zieh\w* mich zurück|zurückzieh|weiche zurück)/,
  dodge: /\b(weiche aus|ausweich|duck mich|ducke mich)/,
  hide: /\b(versteck|verberg|verkriech)/,
  "stand-up": /\b(steh\w* auf|aufsteh|rappel)/,
};

const words = (s: string) => s.toLowerCase().replace(/[^a-zäöüß ]/g, " ").split(/\s+/).filter((w) => w.length >= 4);

/** Label nouns in the text ("heiltrank" ~ "trank", "hocker" ~ "hocker"). */
function nounIn(t: string, label: string): boolean {
  const tw = words(t);
  return words(label).some((lw) => tw.some((w) => w === lw || (w.length >= 5 && lw.includes(w)) || (lw.length >= 5 && w.includes(lw))));
}

/**
 * Items, furniture and class abilities: "Ich trinke einen Heiltrank", "Ich werfe den Hocker nach dem Goblin",
 * "Ich kippe den Tisch um", "Ich verstecke mich", "Ich atme durch".
 */
export function matchUtility(text: string, choices: ActionChoice[], meId?: string): MatchOutcome {
  const t = ` ${text.toLowerCase()} `;
  const scored: { c: ActionChoice; s: number }[] = [];
  for (const c of choices) {
    if (c.group === "ability") {
      const feature = c.action.kind === "feature" ? c.action.feature : "";
      const re = FEATURE_WORDS[feature];
      if ((re && re.test(t)) || nounIn(t, c.label.replace(/\(.*?\)/g, ""))) scored.push({ c, s: re?.test(t) ? 12 : 8 });
      continue;
    }
    if (c.group !== "look" && c.group !== "item") continue;
    const label = c.label.toLowerCase();
    const verb = UTILITY_VERBS.some(([l, v]) => l.test(label) && v.test(t));
    const noun = nounIn(t, c.label.replace(/\(.*?\)/g, ""));
    if (verb && noun) scored.push({ c, s: 11 });
    else if (noun && c.group === "item" && /trink|nimm|benutz|verwend/.test(t)) scored.push({ c, s: 9 });
  }
  if (!scored.length) return undefined;
  scored.sort((a, b) => b.s - a.s || Number(b.c.enabled) - Number(a.c.enabled));
  const best = scored.find((x) => x.c.enabled) ?? scored[0]!;
  if (!best.c.enabled) return { blocked: best.c.reason ?? "Das geht gerade nicht.", choice: best.c };
  let named = mentionedTargets(t, best.c.targets ?? [], meId);
  // "Ich trinke den Trank": for yourself.
  if (!named.length && meId && /\b(trink|schluck|nipp)/.test(t)) named = (best.c.targets ?? []).filter((x) => x.id === meId);
  return { match: build(best.c, named) };
}

/** The words of a label that name it ("Kurzbogen", "Feuerpfeil"). */
function namedIn(t: string, label: string): boolean {
  const l = label.toLowerCase().replace(/[^a-zäöüß ]/g, " ");
  if (l.split(/\s+/).some((w) => w.length >= 4 && t.includes(w))) return true;
  return SYNONYMS.some(([which, words]) => which.test(l) && words.test(t));
}

function hpOf(detail: string): number {
  const m = /TP (\d+)\/(\d+)/.exec(detail);
  return m ? Number(m[1]) / Math.max(1, Number(m[2])) : 1;
}

/** Which target is meant: the full name ("Goblin 2"), a unique first word ("Brunhild"), or "mich". */
function mentionedTargets(t: string, targets: NonNullable<ActionChoice["targets"]>, meId: string | undefined): NonNullable<ActionChoice["targets"]> {
  const full = targets.filter((x) => t.includes(x.name.toLowerCase().replace(" (du)", "")));
  if (full.length) return full.sort((a, b) => b.name.length - a.name.length);
  if (meId && SELF.test(t)) {
    const me = targets.find((x) => x.id === meId);
    if (me) return [me];
  }
  return targets.filter((x) => {
    const w = x.name.toLowerCase().split(" ")[0]!;
    return w.length >= 3 && t.includes(w);
  });
}

/**
 * Picks the hero's button that fits the text best, with a sensible target.
 * Returns undefined when the text is not about attacking, casting or healing (or when it is a trick).
 * `trick` says whether the text reads like a combat trick (push, sand, bribe …) – those stay free actions,
 * unless a weapon or spell is named outright.
 */
export function matchFreeText(text: string, choices: ActionChoice[], meId?: string, trick = false): MatchOutcome {
  const t = ` ${text.toLowerCase()} `.replace(/schlage? vor|vorschlag/g, " ");
  // "Ich haue ab" is running away, not a blow.
  if (/\bhau(e|t|en)? ab\b|\babhau/.test(t)) return undefined;
  const melee = has(t, MELEE);
  const ranged = has(t, RANGED);
  const thrown = has(t, THROW);
  const attack = melee || ranged || thrown || has(t, ATTACK);
  const spell = has(t, SPELL);
  const heal = has(t, HEAL);
  const pool = choices.filter((c) => c.group === "attack" || c.group === "spell" || c.id === "item:potion");
  const scored = pool
    .map((c) => {
      const named = namedIn(t, c.label);
      // Special strikes only when asked for.
      if (c.id.startsWith("stun:") && !/betäub/.test(t)) return { c, s: -99, named };
      if (c.id.startsWith("smite:") && !/göttlich|glanz|heilige? kraft/.test(t)) return { c, s: -99, named };
      const healing = c.avgKind === "heal" || c.id === "item:potion" || /segnen|schild des glaubens/i.test(c.label);
      const isRanged = c.detail.includes("Fernkampf");
      let s = named ? 10 : 0;
      if (healing) s += heal ? 6 : attack ? -20 : -2;
      else if (heal && !attack) s -= 20;
      if (c.group === "attack") {
        if (ranged) s += isRanged ? 4 : -3;
        if (melee) s += isRanged ? -3 : 3;
        if (thrown) s += c.detail.includes("werfen") ? 4 : -1;
        if (attack) s += 1;
        if (spell && !named) s -= 3;
      }
      if (c.group === "spell" && !healing) {
        if (spell) s += 3;
        if (attack && !spell && !named) s -= 2;
      }
      if (c.id === "item:potion" && !/trank/.test(t)) s -= 3;
      s += (c.recommended ? 0.5 : 0) + Math.min(1, (c.avg ?? 0) / 20) + (c.enabled ? 0.3 : 0);
      return { c, s, named };
    })
    .filter((x) => x.s >= 1)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return undefined;
  // "Ich trete die Tür ein", "Ich werfe das Fass um": about a thing, not an enemy (unless one is named).
  const aimed = pool.some((c) => mentionedTargets(t, c.targets ?? [], meId).length);
  if (THING.test(t) && !aimed && !scored.some((x) => x.named)) return undefined;
  // A trick ("Ich stoße ihn um", "Ich werfe ihm Sand in die Augen") stays a trick unless a weapon/spell is named.
  if (trick && !scored.some((x) => x.named)) return undefined;
  const best = scored.find((x) => x.c.enabled && (!x.c.targets || x.c.targets.length));
  if (!best || best.s < scored[0]!.s - 5) {
    const top = scored[0]!.c;
    return { blocked: top.reason ?? "Das geht gerade nicht.", choice: top };
  }
  const c = best.c;
  const healing = c.avgKind === "heal" || c.id === "item:potion";
  const named = mentionedTargets(t, c.targets ?? [], meId);
  // Several enemies in reach and none (or more than one) is meant clearly: ask which one.
  if (c.targets && !healing && (c.pick?.max ?? 1) === 1 && c.targets.length > 1 && named.length !== 1) {
    const pool = named.length > 1 ? named : c.targets;
    return { ask: pool.slice(0, 4).map((x) => build(c, [x])) };
  }
  return { match: build(c, named) };
}

/** The action for a button with its targets (named ones, else the best guess). */
function build(c: ActionChoice, named: NonNullable<ActionChoice["targets"]>): IntentMatch {
  if (!c.targets) return { choice: c, action: c.action, targetNames: [] };
  const healing = c.avgKind === "heal" || c.id === "item:potion";
  let chosen = named;
  if (!chosen.length) {
    const sorted = healing ? [...c.targets].sort((a, b) => hpOf(a.detail) - hpOf(b.detail)) : [...c.targets].sort((a, b) => (b.chance ?? 0) - (a.chance ?? 0));
    chosen = sorted.slice(0, 1);
  }
  const pick = c.pick ?? { min: 1, max: 1, repeat: false };
  let ids = chosen.map((x) => x.id);
  if (pick.repeat) ids = Array.from({ length: pick.max }, (_, i) => ids[i % ids.length]!);
  else ids = ids.slice(0, pick.max);
  const a = c.action;
  const action: PlayerAction =
    a.kind === "attack" ? { ...a, targetId: ids[0]! } : a.kind === "cast" ? { ...a, targetIds: ids } : a.kind === "use_item" ? { ...a, targetId: ids[0]! } : a;
  const names = [...new Set(ids)].map((id) => c.targets!.find((x) => x.id === id)!.name.replace(" (du)", ""));
  return { choice: c, action, targetNames: names };
}
