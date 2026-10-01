/**
 * The effect toolbox for free actions. The DM (AI or script) chooses effects by name;
 * this module decides what is allowed right now (fight or not, roll result, bosses, gold),
 * so the AI can be creative but never breaks the rules.
 *
 * Degrees of success:
 *   no roll      → only "helfen" or "deckung" (no dice needed)
 *   success      → 1 effect, 2 if the roll beat the DC by 5 or more
 *   near miss    → (missed by 1–2) 1 effect, but the hero pays a price ("ja, aber")
 *   clear miss   → a setback: something goes wrong (never nothing at all)
 */
import type { DmContext, DmEffect, DmTrigger } from "../shared/dm";
import { canFlee } from "./combat-tricks";

export const BRIBE_PER_ENEMY = 5;

/** German effect names (as the AI sees them) → what they do. */
export const EFFECT_HELP: Record<string, { combat: boolean | "both"; text: string }> = {
  ablenken: { combat: true, text: "ein Gegner ist abgelenkt: der nächste Angriff auf ihn hat Vorteil" },
  umstossen: { combat: true, text: "ein Gegner (kein Anführer) liegt am Boden: Nahkampfangriffe auf ihn haben Vorteil" },
  behindern: { combat: true, text: "ein Gegner (kein Anführer) ist entwaffnet oder geblendet: seine Angriffe haben Nachteil" },
  helfen: { combat: true, text: "ein anderer Held bekommt Vorteil auf seinen nächsten Wurf (auch ohne Probe)" },
  deckung: { combat: true, text: "der Held selbst bekommt +2 Rüstungsklasse bis zu seinem nächsten Zug (auch ohne Probe)" },
  umgebung: { combat: true, text: "etwas aus der Umgebung trifft einen Gegner: leicht 1W6, mittel 2W6, schwer 3W6 Schaden" },
  flucht: { combat: true, text: "alle Gegner fliehen, der Kampf ist vorbei (nur ohne Anführer)" },
  ergeben: { combat: true, text: "ein Gegner oder alle gewöhnlichen Gegner geben auf und kämpfen nicht mehr" },
  bestechen: { combat: true, text: `wie ergeben, kostet ${BRIBE_PER_ENEMY} Gold pro Gegner aus der Gruppenkasse` },
  betoeren: { combat: true, text: "ein Gegner oder alle gewöhnlichen Gegner sind betört und kämpfen nicht mehr" },
  finden_gold: { combat: false, text: "die Gruppe findet etwas Gold (höchstens zweimal pro Szene etwas finden)" },
  finden_trank: { combat: false, text: "die Gruppe findet einen Heiltrank" },
  finden_fackel: { combat: false, text: "die Gruppe findet eine Fackel" },
  erste_hilfe: { combat: false, text: "ein Held wird verarztet: 1W4+1 Trefferpunkte" },
  tuer_oeffnen: { combat: false, text: "die nächste verschlossene Tür geht auf" },
  entdecken: { combat: false, text: "ein verborgener Teil der Umgebung wird sichtbar" },
  abkuerzung: { combat: false, text: "die Idee löst das aktuelle Hindernis der Szene (nur nach gelungener SCHWERER Probe, SG 15 oder mehr; einmal pro Szene)" },
  // the hero's body
  hingehen: { combat: "both", text: "der Held läuft zu einem Ziel (Ding, Figur, Gegner oder Held; id oder Name), so weit sein Zug reicht – ohne Probe, zählt nicht als Effekt; gern als erster Schritt einer Kette" },
  hochklettern: { combat: "both", text: "der Held klettert auf etwas Hohes daneben (Tisch, Fass, Kiste, Fels, Mauer): 3 Runden erhöht, Vorteil bei Fernangriffen nach unten" },
  verstecken: { combat: "both", text: "der Held versteckt sich: unsichtbar für Gegner bis zu seinem nächsten Angriff (höchstens 2 Runden)" },
  rueckzug: { combat: true, text: "der Held zieht sich geordnet zurück: keine Gelegenheitsangriffe in diesem Zug (ohne Probe)" },
  aufstehen: { combat: "both", text: "der Held steht auf (ohne Probe)" },
  hinlegen: { combat: "both", text: "der Held wirft sich hin: Fernangriffe auf ihn haben Nachteil (ohne Probe)" },
  // the surroundings
  boden: { combat: "both", text: "der Boden um ein Ziel ändert sich (art: feuer, oel, wasser, eis oder schlamm) – Feuer brennt, Öl fängt Feuer, Eis lässt ausrutschen, Schlamm bremst" },
  objekt: { combat: "both", text: "ein Ding aus DINGE wird benutzt (art: umwerfen, zerschlagen, anzuenden, schieben oder rollen; richtung: Ziel-id beim Schieben/Rollen). Rollt ein Fass/Fels in Gegner: Schaden 2W6" },
  verbarrikadieren: { combat: "both", text: "der Held baut eine Barrikade (Kisten, Bänke) auf ein Feld Richtung Gegner/Tür: dort kommt keiner durch (einmal pro Szene)" },
  licht_an: { combat: "both", text: "der Held zündet eine Fackel oder eine erloschene Lichtquelle an (ohne Probe)" },
  licht_aus: { combat: "both", text: "Lichter in der Nähe gehen aus (Kerzen, Kohlebecken) – im Dunkeln sieht man schlechter" },
  // people
  figur: { combat: false, text: "eine Figur aus LEUTE handelt (art: folgen = begleitet die Gruppe, kommen = kommt zum Helden, gehen = geht weg, weg_zeigen = führt Richtung Ausgang und deckt ihn auf)" },
  geschenk: { combat: false, text: "eine Figur aus LEUTE gibt dem Helden etwas (art: gold, trank oder fackel) – jede Figur nur einmal" },
  seitenwechsel: { combat: true, text: "ein gewöhnlicher Gegner (kein Anführer) wechselt die Seite und kämpft für euch – nur nach gelungener SCHWERER Probe (SG 15+)" },
  verjagen: { combat: true, text: "ein gewöhnlicher Gegner (kein Anführer) rennt davon und ist weg" },
  // things
  zuwerfen: { combat: "both", text: "der Held wirft einem Helden etwas aus seiner Tasche zu (art: trank, fackel, gold oder ein Gegenstand) – ohne Probe" },
  einfloessen: { combat: "both", text: "der Held flößt einem Helden in der Nähe seinen Heiltrank ein: 2W4+2 Trefferpunkte, auch Bewusstlose – ohne Probe" },
  improvisiert: { combat: true, text: "eine improvisierte Waffe (Stuhlbein, Bratpfanne, Kerzenständer) trifft einen Gegner: 1W6 + Stärke Schaden" },
  falle_stellen: { combat: "both", text: "der Held stellt eine Stolperfalle auf sein Feld: ein Gegner, der darauf tritt, fällt hin" },
  // bigger physics
  wand_einreissen: { combat: "both", text: "eine morsche Wand neben dem Helden bricht ein – ein neuer Durchgang (nur SCHWERE Probe, SG 15+; einmal pro Karte; richtung: wohin)" },
  einsturz: { combat: "both", text: "die Decke über einem Ziel bricht ein: 2W6 Schaden für ALLE dort (Rettungswurf halbiert), Geröll bleibt liegen (nur SCHWERE Probe, SG 15+; einmal pro Karte)" },
  sprung: { combat: "both", text: "ein großer Sprung oder Schwung am Seil zu einem Ziel bis 4 Felder weit – über Wasser, Tische, Abgründe" },
  herabspringen: { combat: true, text: "der Held springt von oben (erhöht) auf einen Gegner: 1W6 + Stärke Schaden und der Gegner (kein Anführer) liegt am Boden" },
  geraeusch: { combat: "both", text: "ein Geräusch (art: locken = Steinwurf lockt wartende Gegner weg und lenkt sie ab; laerm = weckt sie auf, der Kampf beginnt)" },
  // characters
  auftrag: { combat: false, text: "eine Figur aus LEUTE erledigt einen Auftrag (art: heilen = alle +1W6 TP, schaerfen = Vorteil auf den nächsten Wurf, verstecken = die Gruppe ist 2 Runden unsichtbar, auskunft = nächster Raum und Fallen werden sichtbar); kostet 3 Gold, jede Figur einmal" },
  verkleiden: { combat: false, text: "der Held verkleidet sich (Kutte, Uniform): wartende Gegner erkennen ihn nicht, bis er angreift" },
  verhoeren: { combat: false, text: "ein besiegter oder ergebener Gegner aus LEUTE packt aus: Fallen auf der Karte und der Weg voraus werden sichtbar" },
  // fighting smart
  zwietracht: { combat: true, text: "ein gewöhnlicher Gegner greift in seinem nächsten Zug einen anderen Gegner an (richtung = id des anderen)" },
  entwaffnen: { combat: true, text: "art waffe: ein gewöhnlicher Gegner verliert die Waffe – Nachteil auf Angriffe bis Kampfende; art schild: der Schild zerbricht – −2 Rüstungsklasse (auch bei Anführern)" },
  tiere: { combat: true, text: "Tiere der Umgebung (art: bienen = Bienenstock auf einen Gegner: er und seine Nachbarn 1W4 und gestochen; scheuchen = wilde Tiere unter den Gegnern fliehen; ratten = mit Essen gelockte Ratten fallen über einen Gegner her, einmal pro Karte)" },
  eisbruecke: { combat: "both", text: "Frostmagie macht Wasser um ein Ziel zu begehbarem Eis (nur wer einen Kältezauber kennt)" },
  stossen: { combat: true, text: "ein gewöhnlicher Gegner wird 2 Felder weggestoßen (mit Kraft oder Donnerwelle) – landet er in Feuer, auf Eis oder im Wasser, hat das Folgen (richtung: wohin)" },
  druck: { combat: false, text: "Druck auf eine Figur aus LEUTE (art: bestechen = 8 Gold; erpressen/drohen = sie hasst euch danach und schickt später Schläger) – sie lässt euch durch oder verrät den Weg" },
  gefangen: { combat: false, text: "ein Gefangener aus LEUTE (art: laufen_lassen = er vergisst es euch nicht und hilft vielleicht einmal; mitnehmen = er folgt euch; uebergeben = 8 Gold Kopfgeld)" },
  schwachstelle: { combat: true, text: "der Held studiert einen Gegner und entdeckt eine Schwachstelle: alle Angriffe auf ihn haben Vorteil (auch bei Anführern)" },
  packen_werfen: { combat: true, text: "ein starker Held packt einen kleinen Gegner (klein/winzig, kein Anführer) und wirft ihn auf einen anderen Gegner (richtung): beide 1W6 Schaden und liegen am Boden" },
};

/** Effects that need a clean success on a hard roll (DC 15 or more). */
const HARD = new Set(["seitenwechsel", "wand_einreissen", "einsturz"]);
const HARD_KINDS = new Set<DmEffect["kind"]>(["turncoat", "wall_break", "collapse"]);

/** Steps that cost nothing and do not count as an effect (they may start a chain). */
export const FREE_KINDS = new Set<DmEffect["kind"]>(["move_to", "posture"]);

/** Only a hard roll (this DC or more) may open a shortcut. */
export const BYPASS_DC = 15;

/** Setbacks for a clearly failed attempt ("Rückschläge"). */
export const SETBACK_HELP: Record<string, { combat: boolean | "both"; text: string }> = {
  blosse: { combat: true, text: "der Held gibt sich eine Blöße: der nächste Angriff auf ihn hat Vorteil" },
  hinfallen: { combat: true, text: "der Held fällt selbst hin (liegt am Boden)" },
  patzer: { combat: true, text: "der Held behindert sich selbst: seine Angriffe haben bis nach seinem nächsten Zug Nachteil" },
  wuetend: { combat: true, text: "ein Gegner wird wütend: Vorteil auf seinen nächsten Angriff" },
  verletzt: { combat: "both", text: "der Held verletzt sich (leicht 1W4, mittel 1W6 Schaden, nie bewusstlos)" },
  gold_verloren: { combat: "both", text: "die Gruppe verliert 1W6 Gold" },
};

const NO_ROLL = new Set(["helfen", "deckung", "hingehen", "rueckzug", "aufstehen", "hinlegen", "licht_an", "zuwerfen", "einfloessen"]);

/** A clearly failed roll: only setbacks are allowed. */
export function isClearMiss(trigger: DmTrigger): boolean {
  return trigger.kind === "roll_result" && !trigger.success && trigger.total - trigger.dc < -2;
}

/** Effect names the DM may use for this trigger (for the AI schema). */
export function allowedEffectNames(ctx: DmContext, trigger: DmTrigger): string[] {
  // Only a hero's own idea (and its roll) changes the world – no toolbox for other moments.
  if (trigger.kind !== "free_text" && trigger.kind !== "roll_result") return [];
  const fighting = !!ctx.combat?.enemies.length;
  if (isClearMiss(trigger)) {
    return Object.entries(SETBACK_HELP)
      .filter(([, e]) => e.combat === "both" || e.combat === fighting)
      .map(([name]) => name)
      .filter((name) => name !== "gold_verloren" || (ctx.gold ?? 0) > 0);
  }
  const names = Object.entries(EFFECT_HELP)
    .filter(([, e]) => e.combat === "both" || e.combat === fighting)
    .map(([name]) => name)
    .filter((name) => !HARD.has(name) || (trigger.kind === "roll_result" && trigger.success && trigger.dc >= BYPASS_DC))
    .filter((name) => !["auftrag", "verhoeren", "druck", "gefangen"].includes(name) || !!ctx.room?.people?.length)
    .filter((name) => (name !== "figur" && name !== "geschenk") || !!ctx.room?.people?.length)
    .filter((name) => name !== "objekt" || !!ctx.room?.things?.length)
    .filter((name) => name !== "flucht" || canFlee(ctx))
    .filter((name) => name !== "bestechen" || (ctx.gold ?? 0) >= BRIBE_PER_ENEMY)
    .filter((name) => name !== "abkuerzung" || (!!ctx.bypass && trigger.kind === "roll_result" && trigger.success && trigger.dc >= BYPASS_DC));
  if (trigger.kind === "free_text") return names.filter((n) => NO_ROLL.has(n));
  if (trigger.kind === "roll_result") return names;
  return [];
}

/** How many effects the roll allows, and whether the hero pays a price. */
export function rollAllowance(trigger: DmTrigger): { max: number; cost: boolean } {
  if (trigger.kind === "free_text") return { max: 1, cost: false };
  if (trigger.kind !== "roll_result") return { max: 0, cost: false };
  const margin = trigger.total - trigger.dc;
  if (trigger.success) return { max: margin >= 5 ? 2 : 1, cost: false };
  if (margin >= -2) return { max: 1, cost: true };
  return { max: 1, cost: false }; // one setback
}

/** Name + target from the AI → a DmEffect (or undefined if it makes no sense). */
export function effectFromName(name: string, target: string | undefined, ctx: DmContext, severity?: string, art?: string, toward?: string): DmEffect | undefined {
  const enemies = ctx.combat?.enemies ?? [];
  const enemy = enemies.find((e) => e.id === target);
  const hero = ctx.players.find((p) => p.id === target);
  const all = target === "alle" || target === "all";
  switch (name) {
    case "ablenken":
      return enemy ? { kind: "distract", target: enemy.id } : enemies[0] ? { kind: "distract", target: enemies[0].id } : undefined;
    case "umstossen":
      return enemy && !enemy.boss ? { kind: "prone", target: enemy.id } : undefined;
    case "behindern":
      return enemy && !enemy.boss ? { kind: "hamper", target: enemy.id } : undefined;
    case "helfen":
      return hero ? { kind: "help", target: hero.id } : undefined;
    case "deckung":
      return { kind: "cover" };
    case "umgebung": {
      const t = enemy ?? enemies[0];
      const sev = severity === "schwer" || severity === "mittel" ? severity : "leicht";
      return t ? { kind: "hazard", target: t.id, severity: sev } : undefined;
    }
    case "flucht":
      return canFlee(ctx) ? { kind: "flee" } : undefined;
    case "ergeben":
    case "bestechen":
    case "betoeren": {
      const t = all ? "all" : enemy && !enemy.boss ? enemy.id : undefined;
      if (!t) return undefined;
      const count = t === "all" ? enemies.filter((e) => !e.boss).length : 1;
      if (!count) return undefined;
      if (name === "bestechen" && (ctx.gold ?? 0) < count * BRIBE_PER_ENEMY) return undefined;
      return { kind: "pacify", target: t, how: name };
    }
    case "finden_gold":
      return { kind: "find", item: "gold" };
    case "finden_trank":
      return { kind: "find", item: "trank" };
    case "finden_fackel":
      return { kind: "find", item: "fackel" };
    case "erste_hilfe":
      return hero ? { kind: "first_aid", target: hero.id } : undefined;
    case "tuer_oeffnen":
      return { kind: "open_door" };
    case "entdecken":
      return { kind: "reveal" };
    case "abkuerzung":
      return { kind: "bypass" };
    case "hingehen":
      return target ? { kind: "move_to", target } : undefined;
    case "hochklettern":
      return { kind: "climb" };
    case "verstecken":
      return { kind: "hide" };
    case "rueckzug":
      return { kind: "retreat" };
    case "aufstehen":
      return { kind: "posture", how: "up" };
    case "hinlegen":
      return { kind: "posture", how: "down" };
    case "boden": {
      const surface = ({ feuer: "fire", oel: "oil", öl: "oil", wasser: "puddle", eis: "ice", schlamm: "mud" } as const)[(art ?? severity ?? "").toLowerCase() as "feuer"];
      return surface ? { kind: "ground", target: target ?? "", surface } : undefined;
    }
    case "objekt": {
      const how = ({ umwerfen: "topple", zerschlagen: "smash", anzuenden: "ignite", anzünden: "ignite", schieben: "push", rollen: "roll" } as const)[(art ?? "").toLowerCase() as "umwerfen"];
      return how && target ? { kind: "object", target, how, ...(toward ? { toward } : {}) } : undefined;
    }
    case "verbarrikadieren":
      return { kind: "barricade", ...(toward || target ? { toward: toward || target } : {}) };
    case "licht_an":
      return { kind: "light", on: true };
    case "licht_aus":
      return { kind: "light", on: false };
    case "figur": {
      const how = ({ folgen: "follow", kommen: "come", gehen: "leave", weg_zeigen: "show_way" } as const)[(art ?? "").toLowerCase() as "folgen"];
      const who = ctx.room?.people?.find((p) => p.id === target || p.name === target);
      return how && who ? { kind: "npc", target: who.id, how } : undefined;
    }
    case "geschenk": {
      const who = ctx.room?.people?.find((p) => p.id === target || p.name === target);
      const item = art === "trank" || art === "fackel" ? art : "gold";
      return who ? { kind: "npc_gift", target: who.id, item } : undefined;
    }
    case "seitenwechsel":
      return enemy && !enemy.boss ? { kind: "turncoat", target: enemy.id } : undefined;
    case "verjagen":
      return enemy && !enemy.boss ? { kind: "rout", target: enemy.id } : undefined;
    case "zuwerfen":
      return hero ? { kind: "pass_item", target: hero.id, item: art || "trank" } : undefined;
    case "einfloessen":
      return hero ? { kind: "feed_potion", target: hero.id } : undefined;
    case "improvisiert": {
      const t = enemy ?? enemies[0];
      return t ? { kind: "improvised", target: t.id } : undefined;
    }
    case "falle_stellen":
      return { kind: "set_trap" };
    case "wand_einreissen":
      return { kind: "wall_break", ...(toward || target ? { target: toward || target } : {}) };
    case "einsturz":
      return target ? { kind: "collapse", target } : enemies[0] ? { kind: "collapse", target: enemies[0].id } : undefined;
    case "sprung":
      return target ? { kind: "leap", target } : undefined;
    case "herabspringen": {
      const t = enemy ?? enemies[0];
      return t && !t.boss ? { kind: "pounce", target: t.id } : undefined;
    }
    case "geraeusch":
      return { kind: "noise", how: art === "laerm" || art === "lärm" ? "loud" : "lure", ...(target ? { target } : {}) };
    case "auftrag": {
      const who = ctx.room?.people?.find((p) => p.id === target || p.name === target);
      const how = ({ heilen: "heal", schaerfen: "sharpen", schärfen: "sharpen", verstecken: "hide", auskunft: "info" } as const)[(art ?? "").toLowerCase() as "heilen"];
      return who && how ? { kind: "errand", target: who.id, how } : undefined;
    }
    case "verkleiden":
      return { kind: "disguise" };
    case "verhoeren": {
      const who = ctx.room?.people?.find((p) => p.id === target || p.name === target);
      return who ? { kind: "interrogate", target: who.id } : undefined;
    }
    case "zwietracht": {
      const other = enemies.find((e) => e.id === toward && e.id !== enemy?.id) ?? enemies.find((e) => e.id !== enemy?.id);
      return enemy && !enemy.boss && other ? { kind: "feud", target: enemy.id, other: other.id } : undefined;
    }
    case "entwaffnen": {
      const t = enemy ?? enemies[0];
      const what = art === "schild" ? "shield" : "weapon";
      return t && (what === "shield" || !t.boss) ? { kind: "disarm", target: t.id, what } : undefined;
    }
    case "tiere": {
      const how = art === "scheuchen" ? "scare" : art === "ratten" ? "rats" : "bees";
      const t = enemy ?? enemies[0];
      return t ? { kind: "animals", how, target: t.id } : undefined;
    }
    case "eisbruecke":
      return { kind: "ice_bridge", target: target ?? "" };
    case "stossen": {
      const t = enemy ?? enemies.find((e) => !e.boss);
      return t && !t.boss ? { kind: "shove", target: t.id, ...(toward ? { toward } : {}) } : undefined;
    }
    case "druck": {
      const who = ctx.room?.people?.find((p) => p.id === target || p.name === target);
      const how = art === "bestechen" ? "bribe" : art === "erpressen" ? "blackmail" : "threaten";
      if (how === "bribe" && (ctx.gold ?? 0) < 8) return undefined;
      return who ? { kind: "pressure", target: who.id, how } : undefined;
    }
    case "gefangen": {
      const who = ctx.room?.people?.find((p) => p.id === target || p.name === target);
      const how = art === "mitnehmen" ? "take" : art === "uebergeben" || art === "übergeben" ? "hand_over" : "free";
      return who ? { kind: "captive", target: who.id, how } : undefined;
    }
    case "schwachstelle": {
      const t = enemy ?? enemies[0];
      return t ? { kind: "weakness", target: t.id } : undefined;
    }
    case "packen_werfen": {
      const t = enemy ?? enemies.find((e) => !e.boss);
      return t && !t.boss ? { kind: "hurl", target: t.id, ...(toward ? { toward } : {}) } : undefined;
    }
    case "blosse":
      return { kind: "exposed" };
    case "hinfallen":
      return { kind: "fall" };
    case "patzer":
      return { kind: "fumble" };
    case "verletzt":
      return { kind: "hurt", severity: severity === "mittel" || severity === "schwer" ? "mittel" : "leicht" };
    case "gold_verloren":
      return (ctx.gold ?? 0) > 0 ? { kind: "lose_gold" } : undefined;
    case "wuetend": {
      const t = enemy ?? enemies[0];
      return t ? { kind: "enrage", target: t.id } : undefined;
    }
    default:
      return undefined;
  }
}

const COMBAT_KINDS = new Set<DmEffect["kind"]>(["animals", "shove", "weakness", "distract", "prone", "hamper", "help", "cover", "hazard", "flee", "pacify", "exposed", "fall", "fumble", "enrage", "retreat", "turncoat", "rout", "improvised", "pounce", "feud", "disarm", "hurl"]);
const SETBACK_KINDS = new Set<DmEffect["kind"]>(["exposed", "fall", "fumble", "hurt", "lose_gold", "enrage"]);
const BOTH_KINDS = new Set<DmEffect["kind"]>(["help", "hurt", "lose_gold", "move_to", "climb", "hide", "posture", "ground", "object", "barricade", "light", "pass_item", "feed_potion", "set_trap", "wall_break", "collapse", "leap", "noise", "ice_bridge"]);
const NO_ROLL_KINDS = new Set<DmEffect["kind"]>(["help", "cover", "move_to", "retreat", "posture", "pass_item", "feed_potion"]);

/** Final check of a DM answer's effects against the roll and the situation. */
export function filterEffects(effects: DmEffect[] | undefined, ctx: DmContext, trigger: DmTrigger): DmEffect[] {
  const { max, cost } = rollAllowance(trigger);
  if (!max) return [];
  const fighting = !!ctx.combat?.enemies.length;
  const miss = isClearMiss(trigger);
  const fits = (e: DmEffect) => (BOTH_KINDS.has(e.kind) ? true : COMBAT_KINDS.has(e.kind) === fighting);
  // Free steps (walking there, getting up) happen whatever the dice say – they start a chain.
  const free = (effects ?? []).filter((e) => FREE_KINDS.has(e.kind) && fits(e)).slice(0, 2);
  const lights = (effects ?? []).filter((e) => e.kind === "light" && e.on && trigger.kind === "free_text").slice(0, 1);
  const ok = (effects ?? [])
    .filter((e) => e.kind !== "cost" && !FREE_KINDS.has(e.kind) && !lights.includes(e))
    // A turncoat, like a shortcut, needs a clean success on a hard roll.
    .filter((e) => !HARD_KINDS.has(e.kind) || (trigger.kind === "roll_result" && trigger.success && trigger.dc >= BYPASS_DC))
    // Clear miss: only setbacks. Otherwise: no setbacks.
    .filter((e) => SETBACK_KINDS.has(e.kind) === miss)
    .filter((e) => (BOTH_KINDS.has(e.kind) ? true : COMBAT_KINDS.has(e.kind) === fighting))
    .filter((e) => trigger.kind !== "free_text" || NO_ROLL_KINDS.has(e.kind))
    .filter((e) => e.kind !== "flee" || canFlee(ctx))
    // A shortcut needs a clean success on a hard roll – it must not make the game easy.
    .filter((e) => e.kind !== "bypass" || (!!ctx.bypass && trigger.kind === "roll_result" && trigger.success && trigger.dc >= BYPASS_DC))
    .slice(0, trigger.kind === "free_text" ? 2 : max);
  if (!ok.length) return [...free, ...lights];
  return cost ? [...free, ...lights, ...ok, { kind: "cost" }] : [...free, ...lights, ...ok];
}
