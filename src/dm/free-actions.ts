/**
 * Free actions without AI: the scripted narrator recognises common ideas by keywords
 * (bribe, charm, scare, push, throw sand, search, bandage, …), asks for a fitting roll and
 * turns the result into effects from the toolbox (src/dm/effects.ts).
 * The AI does the same more freely; the rules check is shared.
 */
import { getSkill } from "../engine/data";
import type { DmContext, DmEffect, DmResponse, DmTrigger } from "../shared/dm";
import type { Narration } from "../shared/story";
import { canFlee } from "./combat-tricks";
import { BRIBE_PER_ENEMY, BYPASS_DC } from "./effects";

type Intent =
  | "attack" | "help" | "cover" | "bribe" | "charm" | "surrender" | "scare" | "push" | "blind" | "hazard" | "trick"
  | "search" | "first_aid" | "door" | "reveal" | "befriend" | "shortcut" | "other"
  | "climb" | "hide" | "ignite" | "oil" | "water" | "barricade" | "roll_thing" | "smash_thing" | "light_on" | "light_off"
  | "npc_follow" | "npc_way" | "npc_give" | "turncoat" | "pass" | "feed" | "improvised" | "trap"
  | "wall" | "ceiling" | "leap" | "pounce" | "lure" | "loud" | "errand" | "disguise" | "interrogate" | "feud" | "disarm" | "hurl"
  | "bees" | "scare_beasts" | "rats" | "ice_bridge" | "shove" | "bribe_npc" | "threaten_npc" | "free_captive" | "take_captive" | "hand_captive" | "study";

interface IntentRule {
  intent: Intent;
  words: RegExp;
  combat: boolean | "both";
  skill?: string;
  dc?: number;
}

/** Order matters: the first match wins. */
const RULES: IntentRule[] = [
  // Animals, spells used cleverly, pressure, prisoners, weak spots.
  { intent: "bees", words: /bienen|bienenstock|wespen|hornissen/, combat: true, skill: "athletics", dc: 12 },
  { intent: "rats", words: /ratten .*(lock|hetz|anlock)|lock\w* .*ratten|käse .*ratten/, combat: true, skill: "animal-handling", dc: 13 },
  { intent: "scare_beasts", words: /(tiere|wölfe|wolf|hund|spinne|ratten) .*(scheuch|verjag|erschreck|scheu)|scheuch\w* .*(tiere|wölfe|wolf)|mach\w* .*scheu/, combat: true, skill: "animal-handling", dc: 12 },
  { intent: "ice_bridge", words: /eisbrücke|(frier|gefrier)\w* .*wasser|wasser .*(einfrier|gefrier)/, combat: "both", skill: "arcana", dc: 12 },
  { intent: "shove", words: /(stoß|stoss|schubs|schieb|tret|kick)\w* .*(ins feuer|aufs eis|auf das eis|ins wasser|in die flammen|in den abgrund|weg|zurück)/, combat: true, skill: "athletics", dc: 13 },
  { intent: "study", words: /studier|beobacht\w* (den|die|das)|schwachstelle|schwäche|wo ist .* verwundbar/, combat: true, skill: "insight", dc: 12 },
  { intent: "free_captive", words: /lass\w* .*(laufen|frei|gehen)|freilassen|lauf(en)? lassen/, combat: false },
  { intent: "take_captive", words: /nehm\w* .*(mit|gefangen)|fessel|abführ/, combat: false },
  { intent: "hand_captive", words: /übergeb|kopfgeld|ausliefer/, combat: false },
  { intent: "bribe_npc", words: /bestech|schmier\w* |steck\w* .*gold zu|hier (hast du|sind) .*gold/, combat: false, skill: "persuasion", dc: 12 },
  { intent: "threaten_npc", words: /droh|erpress|sonst passiert|ich weiß (dein|von deinem) geheimnis/, combat: false, skill: "intimidation", dc: 13 },
  // Bigger physics, people and fighting smart.
  { intent: "wall", words: /wand (ein|durch)|reiß.* wand|durch die wand|wand einreiß|ramm.* (die )?wand|morsche (stelle|wand)/, combat: "both", skill: "athletics", dc: BYPASS_DC },
  { intent: "ceiling", words: /decke (ein|zum einsturz|runter)|einstürz|stütz\w* (weg|um)|balken (weg|raus|umtreten)/, combat: "both", skill: "athletics", dc: BYPASS_DC },
  { intent: "pounce", words: /spring\w* (von oben |herab |runter )?auf (den|die|das)|stürz\w* mich (von oben|herab)|von oben auf/, combat: true, skill: "acrobatics", dc: 13 },
  { intent: "leap", words: /spring\w* (über|rüber|hinüber)|schwing\w* mich|am seil|großer sprung|sprung über/, combat: "both", skill: "acrobatics", dc: 12 },
  { intent: "loud", words: /lärm|krach mach|mach\w* krach|schrei\w* laut|trommel|brüll\w* so laut/, combat: false },
  { intent: "lure", words: /(wirf|werfe)\w* (einen |ein )?(stein|kiesel|münze)|lock\w* (sie |die wache )?weg|geräusch.* ablenk/, combat: false, skill: "stealth", dc: 12 },
  { intent: "errand", words: /(kannst|könntest|würdest) du .*(heil|verbind|schärf|versteck|erzähl|verrat)|bitte .*(heil|schärf|versteck)/, combat: false, skill: "persuasion", dc: 12 },
  { intent: "disguise", words: /verkleid|tarn\w* (mich )?als|kutte an|uniform an|zieh.* (die )?(kutte|uniform|rüstung der wache)/, combat: false, skill: "deception", dc: 13 },
  { intent: "interrogate", words: /verhör|befrag|quetsch\w* .*aus|was weißt du|pack aus|rede endlich/, combat: false, skill: "intimidation", dc: 12 },
  { intent: "feud", words: /verrät dich|verräter|will dich (verraten|umbringen|reinlegen)|gegeneinander|zwietracht|hetz/, combat: true, skill: "deception", dc: 13 },
  { intent: "disarm", words: /entwaffn|schwert aus der hand|waffe (aus der hand|weg)|schild (kaputt|zerschlag|zertrümmer|zerbrech)|zerschlag\w* (den|seinen) schild/, combat: true, skill: "athletics", dc: 13 },
  { intent: "hurl", words: /pack\w* .*(werf|schleuder)|schleuder\w* (den|die) |werf\w* (den|die) (goblin|kobold|ratte)/, combat: true, skill: "athletics", dc: 13 },
  // Things, ground, body and people (the map changes).
  { intent: "feed", words: /flöß|einflöß|trank (ein|in den mund)|gib .* (meinen |einen )?(heil)?trank/, combat: "both" },
  { intent: "pass", words: /wirf .* zu|werfe .* zu|zuwerf|reiche .* (den|die|das|einen|eine)|gebe .* (meinen|meine|einen|eine) /, combat: "both" },
  { intent: "turncoat", words: /seite wechs|wechsel.* seite|kämpf.* für uns|überlauf|lauf.* über/, combat: true, skill: "persuasion", dc: BYPASS_DC },
  { intent: "improvised", words: /stuhlbein|bratpfanne|pfanne|kerzenständer|improvis|flasche über|krug über/, combat: true, skill: "athletics", dc: 12 },
  { intent: "light_off", words: /licht aus|lösch|auspust|pust.* aus|mach.* dunkel/, combat: "both", skill: "sleight-of-hand", dc: 10 },
  { intent: "light_on", words: /fackel an|licht an|zünde .*fackel|mach.* licht/, combat: "both" },
  { intent: "ignite", words: /zünd.*an|anzünd|in brand|feuer leg|legt? feuer|abfackel|brenn.* (ab|nieder)/, combat: "both", skill: "sleight-of-hand", dc: 12 },
  { intent: "oil", words: /öl .*(aus|verschütt|gieß|kipp)|gieß.* öl|kipp.* öl/, combat: "both", skill: "sleight-of-hand", dc: 11 },
  { intent: "water", words: /wasser .*(aus|verschütt|gieß|kipp)|gieß.* wasser|eimer wasser/, combat: "both", skill: "athletics", dc: 10 },
  { intent: "barricade", words: /barrika|verrammel|versperr|verbarrik|blockier|tür zu(stell|mach)/, combat: "both", skill: "athletics", dc: 13 },
  { intent: "roll_thing", words: /(roll|schieb|kick|stoß).*(fass|fässer|kiste|fels|stein)|(fass|kiste|fels).*(roll|schieb)/, combat: "both", skill: "athletics", dc: 13 },
  { intent: "smash_thing", words: /zerschlag|zertrümmer|kaputt(mach|schlag|hau)|zerschmetter|trete? .* ein/, combat: "both", skill: "athletics", dc: 11 },
  { intent: "climb", words: /kletter|steig.* auf|spring.* auf (den|die|das)|stell.* mich auf/, combat: "both", skill: "athletics", dc: 12 },
  { intent: "trap", words: /falle (stellen|aufstellen|spannen|bauen)|stell.* (eine )?falle|stolperdraht|seil spannen/, combat: "both", skill: "sleight-of-hand", dc: 12 },
  { intent: "npc_follow", words: /komm.* mit|folg.* (mir|uns)|begleit|schließ dich/, combat: false, skill: "persuasion", dc: 12 },
  { intent: "npc_way", words: /zeig.* (den|uns den|mir den) weg|führ.* uns|wo geht.*(raus|lang|weiter)/, combat: false, skill: "persuasion", dc: 12 },
  { intent: "npc_give", words: /gib (mir|uns)|schenk (mir|uns)|hast du .*(trank|gold|fackel|was)|kannst du (mir|uns) .*geben/, combat: false, skill: "persuasion", dc: 13 },
  { intent: "hide", words: /versteck|in den schatten|unsichtbar mach|tarn/, combat: false, skill: "stealth", dc: 12 },
  { intent: "help", words: /helf|hilf|unterstütz|beisteh|räuberleiter/, combat: "both" },
  { intent: "cover", words: /deckung|versteck|duck|hinter .*(fass|säule|stein|baum|kiste)/, combat: true },
  { intent: "bribe", words: /bestech|münz|goldstück|bezahl|zahl|geld|gold an/, combat: true, skill: "persuasion", dc: 12 },
  { intent: "charm", words: /verführ|betör|schmeichel|flirt|charm|umgarn|zwinker|küss|kuss|schöne augen|kompliment|tanz/, combat: true, skill: "persuasion", dc: 14 },
  { intent: "surrender", words: /ergeb|aufgeb|verhandel|frieden|überred|waffen nieder|lass.* gehen/, combat: true, skill: "persuasion", dc: 14 },
  { intent: "scare", words: /einschücht|droh|brüll|erschreck|verjag|verscheuch|angst/, combat: true, skill: "intimidation", dc: 13 },
  { intent: "push", words: /stoß|stoss|schubs|umwerf|umreiß|umreiss|bein stell|umrenn|zu boden|stolper/, combat: true, skill: "athletics", dc: 13 },
  { intent: "blind", words: /sand|blend|entwaffn|waffe .*(weg|aus der hand)|netz|mantel über|spuck/, combat: true, skill: "sleight-of-hand", dc: 13 },
  { intent: "hazard", words: /fass|fässer|kronleuchter|felsbrocken|stein|wirf|werf|schleuder|kiste|umkipp|lawine|seil/, combat: true, skill: "athletics", dc: 13 },
  { intent: "trick", words: /ablenk|täusch|trick|bluff|verwirr|lock|list|hinter dir/, combat: true, skill: "deception", dc: 13 },
  { intent: "attack", words: /greif|schlag|hau |haue|stech|schieß|schiess|angriff|attack|töte|kämpf|schwert/, combat: true },
  { intent: "shortcut", words: /schleich|umgeh|abkürz|abkuerz|vorbeischleich|an .* vorbei|anderen weg|geheimgang|hintertür|über die mauer|überred.*(wache|wächter|torwache)/, combat: false, skill: "stealth", dc: BYPASS_DC },
  { intent: "befriend", words: /geschenk|schenk|bestech|kompliment|schmeichel|lob|freund/, combat: false, skill: "persuasion", dc: 12 },
  { intent: "search", words: /durchsuch|such|stöber|untersuch|wühl|schau.*(nach|unter|hinter)/, combat: false, skill: "investigation", dc: 12 },
  { intent: "first_aid", words: /verbind|verarzt|heil|pfleg|erste hilfe|wunde/, combat: false, skill: "medicine", dc: 10 },
  { intent: "door", words: /tür|schloss|aufbrech|knack|dietrich/, combat: false, skill: "sleight-of-hand", dc: 12 },
  { intent: "reveal", words: /geheim|verborgen|erkund|späh|ausschau|klettere hoch|überblick/, combat: false, skill: "perception", dc: 12 },
];

export function intentOf(text: string, fighting: boolean): IntentRule | undefined {
  const t = ` ${text.toLowerCase()} `;
  return RULES.find((r) => (r.combat === "both" || r.combat === fighting) && r.words.test(t));
}

/** A combat trick (push, sand, bribe, scare …) rather than a plain attack. */
export function isTrick(text: string): boolean {
  const rule = intentOf(text, true);
  return !!rule && rule.intent !== "attack" && rule.intent !== "help" && rule.intent !== "cover";
}

/** Who is meant: the full name first ("Räuber 2"), then a unique first word ("Brunhild"). */
function mentioned<T extends { name: string }>(text: string, list: T[]): T | undefined {
  const t = text.toLowerCase();
  const full = list.filter((x) => t.includes(x.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
  if (full) return full;
  const byWord = list.filter((x) => t.includes(x.name.toLowerCase().split(" ")[0]!));
  return byWord[0];
}

function line(text: string, tip?: Narration["tip"]): Narration {
  return tip ? { text, tip } : { text };
}

function respond(lines: Narration[], extra: Partial<DmResponse> = {}): DmResponse {
  return { narration: lines.map((l) => l.text).join(" "), script: lines, next: "await_action", ...extra };
}

/** First reaction to a free action (no roll yet). */
export function scriptedFreeText(ctx: DmContext, trigger: Extract<DmTrigger, { kind: "free_text" }>): DmResponse | undefined {
  const fighting = !!ctx.combat?.enemies.length;
  const rule = intentOf(trigger.text, fighting);
  const hero = trigger.heroName;
  if (!rule) {
    // Too little to go on ("Ich mache was"): ask back instead of guessing.
    if (trigger.text.trim().split(/\s+/).length <= 2 || /^(ich )?(mach|tu|probier)\w* (was|etwas|irgendwas)\b/.test(trigger.text.toLowerCase().trim())) {
      return respond([], { ask_back: "Was genau willst du tun – und womit? Zum Beispiel: „Ich klettere auf den Tisch“." });
    }
    // Any other idea outside a fight: the world answers with a roll (never just "nothing happens").
    if (fighting) return undefined;
    const skill = guessSkill(trigger.text);
    return respond([line(`${hero} probiert es. Mal sehen, ob das klappt …`)], {
      request_roll: { playerId: trigger.playerId, ability: getSkill(skill as never).ability, skill, dc: 13 },
      next: "await_roll",
    });
  }
  if (rule.intent === "attack") {
    return respond([
      line(`${hero} holt aus – aber gerade ist kein Gegner in Reichweite.`, {
        key: "freie_aktion",
        text: "Schreib einfach, womit du angreifst („Ich schieße mit dem Bogen auf den Goblin“) – das Spiel nimmt dann den passenden Angriff.",
      }),
    ]);
  }
  // Without a roll: throwing something to a friend, a potion for a friend, lighting a torch.
  if (rule.intent === "feed" || rule.intent === "pass") {
    const friend = mentioned(trigger.text, ctx.players.filter((p) => p.id !== trigger.playerId));
    if (!friend) return respond([line(`Wem denn? Nennt den Namen des Helden, z. B. „Ich werfe Brunhild meinen Trank zu“.`)]);
    if (rule.intent === "feed") return respond([line(`${hero} eilt zu ${friend.name}.`)], { effects: [{ kind: "move_to", target: friend.id }, { kind: "feed_potion", target: friend.id }] });
    const item = /fackel/.test(trigger.text.toLowerCase()) ? "fackel" : /gold|münz/.test(trigger.text.toLowerCase()) ? "gold" : /trank/.test(trigger.text.toLowerCase()) ? "trank" : trigger.text.toLowerCase().replace(/.*(wirf|werfe|reiche|gebe)\s+\S+\s+/, "").split(" ").slice(0, 3).join(" ");
    return respond([line(`${hero} holt aus …`)], { effects: [{ kind: "pass_item", target: friend.id, item }] });
  }
  if (rule.intent === "light_on") return respond([line(`${hero} macht Licht.`)], { effects: [{ kind: "light", on: true }] });
  if (rule.intent === "free_captive" || rule.intent === "take_captive" || rule.intent === "hand_captive") {
    const captives = (ctx.room?.people ?? []).filter((p) => !p.id.startsWith("npc-"));
    const who = mentioned(trigger.text, captives) ?? captives[0];
    if (!who) return respond([line(`Hier ist kein Gefangener.`)]);
    const how = rule.intent === "free_captive" ? "free" : rule.intent === "take_captive" ? "take" : "hand_over";
    return respond([line(`${hero} entscheidet über ${who.name}.`)], { effects: [{ kind: "captive", target: who.id, how }] });
  }
  if (rule.intent === "loud") return respond([line(`${hero} macht einen Heidenlärm!`)], { effects: [{ kind: "noise", how: "loud" }] });
  if (rule.intent === "help") {
    const friend = mentioned(trigger.text, ctx.players.filter((p) => p.id !== trigger.playerId));
    if (!friend) return respond([line(`Wem will ${hero} helfen? Nennt den Namen des Helden, z. B. „Ich helfe Brunhild“.`)]);
    return respond([line(`${hero} eilt ${friend.name} zu Hilfe.`)], { effects: [{ kind: "help", target: friend.id }] });
  }
  if (rule.intent === "cover") return respond([line(`${hero} sucht Deckung.`)], { effects: [{ kind: "cover" }] });
  if (rule.intent === "bribe" && (ctx.gold ?? 0) < BRIBE_PER_ENEMY) {
    return respond([line(`${hero} greift in den Beutel – aber die Gruppe hat nicht genug Gold für eine Bestechung (${BRIBE_PER_ENEMY} pro Gegner).`)]);
  }
  const skill = rule.skill!;
  return respond([line(`${hero} versucht es. Gelingt die Probe?`)], {
    request_roll: { playerId: trigger.playerId, ability: getSkill(skill as never).ability, skill, dc: rule.dc! },
    next: "await_roll",
    ...(PLANS[rule.intent] ? { plan: PLANS[rule.intent] } : {}),
  });
}

/** Effects the scripted narrator wants after the roll (filterEffects decides what is allowed). */
export function scriptedRollResult(ctx: DmContext, trigger: Extract<DmTrigger, { kind: "roll_result" }>): DmResponse {
  const fighting = !!ctx.combat?.enemies.length;
  const rule = intentOf(trigger.text, fighting);
  const margin = trigger.total - trigger.dc;
  const hero = trigger.heroName;
  const nearMiss = !trigger.success && margin >= -2;
  const intro = trigger.success ? (margin >= 5 ? "Großartig geschafft!" : "Geschafft!") : nearMiss ? "Knapp! Es klappt – aber nicht ohne Preis." : "Das geht schief!";
  if (!rule) {
    // An idea without keywords: success uncovers something, a near miss too (with a price).
    if (fighting || (!trigger.success && !nearMiss)) return respond([line(`${intro} ${trigger.success ? `${hero} gelingt es.` : `${hero} versucht es, aber es klappt nicht.`}`)]);
    return respond([line(`${intro} ${hero} entdeckt dabei etwas, das vorher niemand bemerkt hat.`)], { effects: [{ kind: "reveal" }] });
  }
  if (!trigger.success && !nearMiss) return setback(rule.intent, ctx, trigger);

  const enemies = ctx.combat?.enemies ?? [];
  const named = mentioned(trigger.text, enemies);
  const ordinary = enemies.filter((e) => !e.boss);
  const one = named && !named.boss ? named : ordinary[0];
  const all = /alle|ihr |euch|die räuber|die wölfe|die kobolde/.test(trigger.text.toLowerCase());
  const effects: DmEffect[] = [];
  switch (rule.intent) {
    case "bribe":
    case "charm":
    case "surrender": {
      const how = rule.intent === "bribe" ? "bestechen" : rule.intent === "charm" ? "betoeren" : "ergeben";
      const target = all && ordinary.length > 1 ? "all" : one?.id;
      if (target) effects.push({ kind: "pacify", target, how });
      else effects.push({ kind: "distract", target: (named ?? enemies[0])!.id });
      break;
    }
    case "scare":
      if (canFlee(ctx)) effects.push({ kind: "flee" });
      else if (one) effects.push({ kind: "pacify", target: one.id, how: "ergeben" });
      else effects.push({ kind: "distract", target: enemies[0]!.id });
      break;
    case "push":
      if (one) effects.push({ kind: "prone", target: one.id });
      break;
    case "blind":
      if (one) effects.push({ kind: "hamper", target: one.id });
      break;
    case "hazard":
      effects.push({ kind: "hazard", target: (named ?? enemies[0])!.id, severity: margin >= 5 ? "schwer" : "mittel" });
      break;
    case "trick":
      effects.push({ kind: "distract", target: (named ?? enemies[0])!.id });
      break;
    case "search":
      effects.push({ kind: "find", item: margin >= 5 ? "trank" : "gold" });
      break;
    case "first_aid": {
      const patient = mentioned(trigger.text, ctx.players) ?? [...ctx.players].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (patient) effects.push({ kind: "first_aid", target: patient.id });
      break;
    }
    case "door":
      effects.push({ kind: "open_door" });
      break;
    case "reveal":
      effects.push({ kind: "reveal" });
      break;
    case "shortcut":
      effects.push({ kind: "bypass" });
      break;
    case "climb":
      effects.push({ kind: "climb" });
      break;
    case "hide":
      effects.push({ kind: "hide" });
      break;
    case "ignite": {
      const thing = thingIn(trigger.text, ctx, /tisch|bank|regal|kiste|heu|busch|gebüsch|netz|fass|hocker|tresen|dorn/);
      effects.push(thing ? { kind: "object", target: thing.id, how: "ignite" } : { kind: "ground", target: one?.id ?? "", surface: "fire" });
      break;
    }
    case "oil":
    case "water":
      effects.push({ kind: "ground", target: (named ?? one)?.id ?? "", surface: rule.intent === "oil" ? "oil" : "puddle" });
      break;
    case "barricade":
      effects.push({ kind: "barricade", ...(one ? { toward: one.id } : {}) });
      break;
    case "roll_thing": {
      const thing = thingIn(trigger.text, ctx, /fass|fässer|kiste|fels|stein/);
      if (thing) effects.push({ kind: "object", target: thing.id, how: /schieb/.test(trigger.text.toLowerCase()) ? "push" : "roll", ...((named ?? one) ? { toward: (named ?? one)!.id } : {}) });
      // No barrel on the map list: it is simply something from the surroundings that hits.
      else if (enemies.length) effects.push({ kind: "hazard", target: (named ?? enemies[0])!.id, severity: margin >= 5 ? "schwer" : "mittel" });
      break;
    }
    case "smash_thing": {
      const thing = thingIn(trigger.text, ctx, /kiste|krug|topf|fass|tisch|hocker|regal|statue|säule/);
      if (thing) effects.push({ kind: "object", target: thing.id, how: "smash" });
      break;
    }
    case "light_off":
      effects.push({ kind: "light", on: false });
      break;
    case "npc_follow":
    case "npc_way":
    case "npc_give": {
      const who = mentioned(trigger.text, ctx.room?.people ?? []) ?? ctx.room?.people?.[0];
      if (!who) break;
      if (rule.intent === "npc_give") {
        const t = trigger.text.toLowerCase();
        effects.push({ kind: "npc_gift", target: who.id, item: /trank/.test(t) ? "trank" : /fackel/.test(t) ? "fackel" : "gold" });
      } else effects.push({ kind: "npc", target: who.id, how: rule.intent === "npc_way" ? "show_way" : "follow" });
      break;
    }
    case "turncoat":
      if (one) effects.push({ kind: "turncoat", target: one.id });
      break;
    case "improvised":
      if (named ?? one ?? enemies[0]) effects.push({ kind: "improvised", target: (named ?? one ?? enemies[0])!.id });
      break;
    case "trap":
      effects.push({ kind: "set_trap" });
      break;
    case "wall":
      effects.push({ kind: "wall_break" });
      break;
    case "bees":
    case "rats":
    case "scare_beasts":
      if (named ?? one ?? enemies[0]) effects.push({ kind: "animals", how: rule.intent === "bees" ? "bees" : rule.intent === "rats" ? "rats" : "scare", target: (named ?? one ?? enemies[0])!.id });
      break;
    case "ice_bridge":
      effects.push({ kind: "ice_bridge", target: "" });
      break;
    case "shove":
      if (one) effects.push({ kind: "shove", target: one.id });
      break;
    case "study":
      if (named ?? enemies[0]) effects.push({ kind: "weakness", target: (named ?? enemies[0])!.id });
      break;
    case "bribe_npc":
    case "threaten_npc": {
      const who = mentioned(trigger.text, ctx.room?.people ?? []) ?? ctx.room?.people?.[0];
      const how = rule.intent === "bribe_npc" ? "bribe" : /erpress|geheimnis/.test(trigger.text.toLowerCase()) ? "blackmail" : "threaten";
      if (who && (how !== "bribe" || (ctx.gold ?? 0) >= 8)) effects.push({ kind: "pressure", target: who.id, how });
      break;
    }
    case "ceiling":
      if (named ?? one ?? enemies[0]) effects.push({ kind: "collapse", target: (named ?? one ?? enemies[0])!.id });
      break;
    case "leap": {
      const goal = named ?? thingIn(trigger.text, ctx, /tisch|fass|kiste|fels|bühne|brunnen/) ?? mentioned(trigger.text, ctx.players);
      if (goal) effects.push({ kind: "leap", target: goal.id });
      break;
    }
    case "pounce":
      if (one) effects.push({ kind: "pounce", target: one.id });
      break;
    case "lure":
      effects.push({ kind: "noise", how: "lure" });
      break;
    case "errand": {
      const who = mentioned(trigger.text, ctx.room?.people ?? []) ?? ctx.room?.people?.[0];
      const t = trigger.text.toLowerCase();
      const how = /heil|verbind/.test(t) ? "heal" : /schärf/.test(t) ? "sharpen" : /versteck/.test(t) ? "hide" : "info";
      if (who) effects.push({ kind: "errand", target: who.id, how });
      break;
    }
    case "disguise":
      effects.push({ kind: "disguise" });
      break;
    case "interrogate": {
      const who = mentioned(trigger.text, ctx.room?.people ?? []) ?? ctx.room?.people?.find((p) => !p.id.startsWith("npc-"));
      if (who) effects.push({ kind: "interrogate", target: who.id });
      break;
    }
    case "feud": {
      const other = enemies.find((e) => e.id !== one?.id && trigger.text.toLowerCase().includes(e.name.toLowerCase())) ?? enemies.find((e) => e.id !== one?.id);
      if (one && other) effects.push({ kind: "feud", target: one.id, other: other.id });
      break;
    }
    case "disarm": {
      const t = named ?? one;
      if (t) effects.push({ kind: "disarm", target: t.id, what: /schild/.test(trigger.text.toLowerCase()) ? "shield" : "weapon" });
      break;
    }
    case "hurl": {
      const small = enemies.filter((e) => !e.boss);
      const t = named && !named.boss ? named : small[0];
      const other = small.find((e) => e.id !== t?.id) ?? enemies.find((e) => e.id !== t?.id);
      if (t) effects.push({ kind: "hurl", target: t.id, ...(other ? { toward: other.id } : {}) });
      break;
    }
    case "befriend":
    case "other":
      break;
  }
  if (rule.intent === "befriend") return respond([line(trigger.success ? `${intro} Das kommt gut an.` : intro)]);
  return respond([line(intro)], { effects });
}

/** A clearly failed attempt: something goes wrong, fitting to what was tried. */
function setback(intent: Intent, ctx: DmContext, trigger: Extract<DmTrigger, { kind: "roll_result" }>): DmResponse {
  const hero = trigger.heroName;
  const enemies = ctx.combat?.enemies ?? [];
  const named = mentioned(trigger.text, enemies) ?? enemies[0];
  const gold = (ctx.gold ?? 0) > 0;
  const pick = (): [string, DmEffect | undefined] => {
    switch (intent) {
      case "push":
        return [`${hero} rutscht aus und landet selbst auf dem Boden!`, { kind: "fall" }];
      case "blind":
        return [`Der Wind dreht – ${hero} bekommt den Sand selbst in die Augen!`, { kind: "fumble" }];
      case "hazard":
        return [`Das geht nach hinten los – ${hero} klemmt sich die Finger und verletzt sich!`, { kind: "hurt", severity: "mittel" }];
      case "bribe":
        return gold ? [`${named?.name ?? "Der Gegner"} schnappt sich das Gold – und kämpft trotzdem weiter!`, { kind: "lose_gold" }] : [`${named?.name ?? "Der Gegner"} lacht nur.`, named ? { kind: "enrage", target: named.id } : undefined];
      case "surrender":
      case "scare":
        return [`${named?.name ?? "Der Gegner"} lacht ${hero} aus und greift jetzt erst recht an!`, named ? { kind: "enrage", target: named.id } : undefined];
      case "charm":
      case "trick":
        return [`${named?.name ?? "Der Gegner"} fällt nicht darauf herein – und ${hero} steht plötzlich ungeschützt da!`, { kind: "exposed" }];
      case "search":
        return [`Autsch! ${hero} greift in etwas Spitzes.`, { kind: "hurt", severity: "leicht" }];
      case "door":
        return [`Das Schloss schnappt zu – ${hero} klemmt sich die Finger.`, { kind: "hurt", severity: "leicht" }];
      case "reveal":
        return [`${hero} rutscht beim Klettern ab und schürft sich auf.`, { kind: "hurt", severity: "leicht" }];
      case "climb":
        return [`${hero} rutscht ab und plumpst unsanft auf den Hintern!`, enemies.length ? { kind: "fall" } : { kind: "hurt", severity: "leicht" }];
      case "ignite":
      case "oil":
        return [`Autsch – ${hero} verbrennt sich die Finger!`, { kind: "hurt", severity: "leicht" }];
      case "roll_thing":
      case "smash_thing":
      case "barricade":
        return [`Das Ding ist schwerer als gedacht – ${hero} zerrt sich was!`, { kind: "hurt", severity: "leicht" }];
      case "turncoat":
      case "npc_give":
      case "npc_follow":
        return named ? [`${named.name} lacht nur – und ist jetzt richtig sauer!`, { kind: "enrage", target: named.id }] : [`Das kommt gar nicht gut an.`, undefined];
      case "improvised":
      case "disarm":
        return [`${hero} haut daneben und steht ungeschützt da!`, { kind: "exposed" }];
      case "wall":
      case "ceiling":
      case "hurl":
        return [`Au! ${hero} prallt ab und hat sich ordentlich wehgetan.`, { kind: "hurt", severity: "mittel" }];
      case "leap":
      case "pounce":
        return [`${hero} springt zu kurz und landet der Länge nach auf dem Boden!`, enemies.length ? { kind: "fall" } : { kind: "hurt", severity: "leicht" }];
      case "feud":
        return named ? [`${named.name} durchschaut die Lüge – und ist jetzt richtig sauer!`, { kind: "enrage", target: named.id }] : [`Keiner fällt darauf rein.`, undefined];
      default:
        return [`${hero} versucht es, aber es klappt nicht.`, undefined];
    }
  };
  const [text, effect] = pick();
  return respond([line(`Das geht schief! ${text}`)], effect ? { effects: [effect] } : {});
}

/** What the scripted narrator would do if the roll works (shown on the phone before rolling). */
const PLANS: Partial<Record<Intent, string>> = {
  bribe: "Der Gegner nimmt das Gold und hört auf",
  charm: "Der Gegner ist betört und kämpft nicht mehr",
  surrender: "Der Gegner gibt auf",
  scare: "Die Gegner fliehen (oder einer gibt auf)",
  push: "Der Gegner liegt am Boden",
  blind: "Der Gegner ist behindert (Nachteil)",
  hazard: "Etwas aus der Umgebung trifft den Gegner",
  trick: "Der Gegner ist abgelenkt",
  search: "Du findest etwas",
  first_aid: "Wunden werden verbunden (+1W4+1 TP)",
  door: "Die Tür geht auf",
  reveal: "Ein verborgener Teil wird sichtbar",
  shortcut: "Das Hindernis ist umgangen",
  climb: "Du stehst erhöht (Vorteil beim Schießen)",
  hide: "Du bist für die Gegner unsichtbar",
  ignite: "Es brennt!",
  oil: "Öl auf dem Boden – glitschig und brennbar",
  water: "Wasser auf dem Boden",
  barricade: "Eine Barrikade versperrt den Weg",
  roll_thing: "Das Ding rollt los – Schaden bei Treffer",
  smash_thing: "Es geht zu Bruch",
  light_off: "Die Lichter gehen aus",
  npc_follow: "Die Figur kommt mit euch",
  npc_way: "Die Figur zeigt euch den Weg",
  npc_give: "Die Figur gibt dir etwas",
  turncoat: "Der Gegner kämpft ab jetzt für euch",
  improvised: "1W6 + Stärke Schaden",
  trap: "Eine Stolperfalle liegt bereit",
  wall: "Die Wand bricht ein – ein neuer Durchgang",
  bees: "Bienen stechen die Gegner (1W4, Nachteil)",
  rats: "Ratten fallen über den Gegner her",
  scare_beasts: "Die Tiere rennen davon",
  ice_bridge: "Das Wasser wird zu Eis – begehbar",
  shove: "Der Gegner fliegt 2 Felder zurück",
  study: "Du findest seine Schwachstelle (Vorteil für alle)",
  bribe_npc: "Für 8 Gold lässt sie euch durch oder verrät den Weg",
  threaten_npc: "Sie gibt nach – und vergisst es euch nie",
  ceiling: "Die Decke stürzt auf die Gegner (2W6)",
  leap: "Du springst hinüber",
  pounce: "Sprung von oben: Schaden und Gegner am Boden",
  lure: "Die Wachen folgen dem Geräusch – abgelenkt",
  errand: "Die Figur hilft dir (3 Gold)",
  disguise: "Wartende Gegner erkennen dich nicht",
  interrogate: "Er verrät Fallen und den Weg",
  feud: "Die Gegner gehen aufeinander los",
  disarm: "Waffe weg oder Schild kaputt",
  hurl: "Du wirfst ihn auf einen anderen – beide am Boden",
};

/** A thing from the surroundings the text is about (by its name, else the first of the right sort). */
function thingIn(text: string, ctx: DmContext, sort: RegExp): { id: string; name: string } | undefined {
  const things = ctx.room?.things ?? [];
  const t = text.toLowerCase();
  return things.find((x) => t.includes(x.name.toLowerCase().split(" ")[0]!)) ?? things.find((x) => sort.test(x.name.toLowerCase()));
}

/** Which skill an idea without keywords needs (a rough guess from the verbs). */
function guessSkill(text: string): string {
  const t = text.toLowerCase();
  if (/rede|frag|sprech|erzähl|überzeug|bitte|verhandel/.test(t)) return "persuasion";
  if (/kletter|spring|heb|zieh|drück|schieb|trag|brech|stemm|schwimm/.test(t)) return "athletics";
  if (/schleich|versteck|leise|heimlich/.test(t)) return "stealth";
  if (/lausch|horch|schau|beobacht|späh|riech/.test(t)) return "perception";
  if (/les|entziffer|erinner|kenn|wiss|geschichte/.test(t)) return "history";
  if (/zauber|magie|rune|beschwör|arkan/.test(t)) return "arcana";
  if (/tier|pferd|hund|füttr|streichel/.test(t)) return "animal-handling";
  if (/lüg|täusch|verkleid|tu so/.test(t)) return "deception";
  return "investigation";
}

/** "Was könnte ich tun?" without AI: ideas that the keywords above understand. */
export function scriptedIdeas(ctx: DmContext): string[] {
  const enemies = ctx.combat?.enemies ?? [];
  const things = (ctx.room?.things ?? []).map((t) => t.name);
  const has = (re: RegExp) => things.find((t) => re.test(t));
  const people = ctx.room?.people ?? [];
  if (enemies.length) {
    const e = enemies.find((x) => !x.boss) ?? enemies[0]!;
    const ideas: string[] = [];
    // What this room offers first.
    if (has(/Fass|Fässer/)) ideas.push(`🛢️ Ich rolle das Fass auf ${e.name}`);
    if (has(/Tisch|Kiste|Fels|Bühne|Baumstumpf/)) ideas.push(`🧗 Ich klettere auf ${has(/Tisch|Kiste|Fels|Bühne|Baumstumpf/)!.startsWith("Tisch") ? "den Tisch" : "die Kiste"} und schieße von oben`);
    if (has(/Kerzen|Kohlebecken/)) ideas.push(`🕯️ Ich werfe ${has(/Kerzen|Kohlebecken/)!.startsWith("Kerzen") ? "den Kerzenständer" : "das Kohlebecken"} auf ${e.name}`);
    if (enemies.length > 1) ideas.push(`😤 Ich rufe: „${enemies[1]!.name} will dich verraten, ${e.name}!“`);
    ideas.push(`🏖️ Ich werfe ${e.name} Sand in die Augen`, `💪 Ich stoße ${e.name} um`);
    if ((ctx.gold ?? 0) >= BRIBE_PER_ENEMY) ideas.push(`💰 Ich biete ${e.name} Gold an, damit er aufhört`);
    ideas.push("📢 Ich brülle sie an und verjage sie");
    return ideas.slice(0, 4);
  }
  const ideas: string[] = [];
  if (people[0]) ideas.push(`🗣️ ${people[0].name}, zeig uns den Weg!`);
  if (has(/Regal|Kiste|Truhe/)) ideas.push(`🔍 Ich durchsuche ${has(/Regal/) ? "das Bücherregal" : "die Kisten"}`);
  if (has(/Fass|Fässer|Kiste/)) ideas.push("🧱 Ich baue aus Kisten und Fässern eine Barrikade");
  ideas.push("👀 Ich halte Ausschau nach verborgenen Wegen");
  const hurt = ctx.players.find((p) => p.hp < p.maxHp);
  if (hurt) ideas.push(`🩹 Ich verbinde ${hurt.name}s Wunden`);
  if (ctx.room?.objects.includes("Tür")) ideas.push("🔓 Ich knacke das Schloss der Tür");
  ideas.push("🧱 Ich suche eine morsche Stelle in der Wand");
  return ideas.slice(0, 4);
}
