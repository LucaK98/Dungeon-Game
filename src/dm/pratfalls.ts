/**
 * Critical fumbles and triumphs of free actions (a natural 1 or 20 on the die).
 *
 * A natural 1 does not simply fail: the hero does the comic opposite of what they wanted
 * („Ich streichle den Hund“ → a slap). The consequences stay small and harmless – it should make
 * the table laugh, not ruin the evening. A natural 20 goes better than planned. All lines are
 * written here (no AI needed, no tokens used).
 */
import type { DmEffect } from "../shared/dm";

export interface Pratfall {
  /** What happens, with {name} for the hero and {who} for whoever it was aimed at. */
  text: string;
  /** A small consequence (applied by the rules, may be dropped when it does not fit). */
  effect?: "fall" | "fumble" | "exposed" | "hurt" | "enrage" | "lose_gold";
}

interface Pattern {
  words: RegExp;
  falls: Pratfall[];
}

const PATTERNS: Pattern[] = [
  {
    words: /streiche?l|kraul|tätsche?l|knudde?l|umarm|kusche?l/,
    falls: [
      { text: "{name} holt liebevoll zum Streicheln aus … und – KLATSCH! – eine schallende Ohrfeige für {who}! 🫲💥", effect: "enrage" },
      { text: "{name} will kraulen, rutscht ab und zieht kräftig an Ohr und Fell. Ein beleidigter Blick von {who} trifft {name}.", effect: "enrage" },
      { text: "{name} streckt zärtlich die Hand aus … und haut sich dabei selbst auf die Nase. 🤦", effect: "exposed" },
    ],
  },
  {
    words: /schleich|leise|unbemerkt|auf zehenspitzen|anschleich/,
    falls: [
      { text: "{name} schleicht auf Zehenspitzen los … tritt in einen Eimer und scheppert quer durch den Raum. 🪣", effect: "fall" },
      { text: "{name} ist mucksmäuschenstill – bis ein gewaltiges Niesen alles ruiniert. HATSCHI! 🤧", effect: "exposed" },
    ],
  },
  {
    words: /versteck|tarn|duck mich/,
    falls: [{ text: "{name} versteckt sich hinter einem Busch, der genau halb so groß ist wie {name}. Alle sehen hin. 🌿", effect: "exposed" }],
  },
  {
    words: /überred|überzeug|schmeichel|flirt|betör|grüß|begrüß|rede|sprech|frag|verhandel|bestech/,
    falls: [
      { text: "{name} setzt zum charmanten Satz an … und sagt aus Versehen etwas sehr Beleidigendes über {who}s Mutter. 😳" },
      { text: "{name} will freundlich lächeln, verschluckt sich und spuckt {who} mitten ins Gesicht. 💦" },
      { text: "{name} hält eine flammende Rede – leider mit vertauschten Namen. {who} guckt sehr irritiert." },
    ],
  },
  {
    words: /heil|verbind|verarzt|trank geb|flöß/,
    falls: [
      { text: "{name} greift beherzt zur Heilflasche … und erwischt die mit dem Lampenöl. Alle bekommen Schluckauf. 🫗", effect: "fumble" },
      { text: "{name} verbindet die Wunde sehr gründlich – und dabei auch gleich die eigene Hand mit dem Arm des Patienten. 🩹", effect: "fumble" },
    ],
  },
  {
    words: /kletter|hochzieh|hinauf|erklimm/,
    falls: [{ text: "{name} klettert los, bleibt mit dem Gürtel hängen und baumelt kopfüber wie ein Schinken. 🥓", effect: "fall" }],
  },
  {
    words: /spring|hechte|satz über|sprung/,
    falls: [{ text: "{name} nimmt Anlauf, springt mit einem heldenhaften Schrei – und landet mit dem Gesicht im Matsch. 🐷", effect: "fall" }],
  },
  {
    words: /wirf|werf|schleuder/,
    falls: [{ text: "{name} holt weit aus, der Wurf geht nach hinten los – direkt an den eigenen Hinterkopf. 🤕", effect: "hurt" }],
  },
  {
    words: /schloss|dietrich|knack|aufbrech|tür/,
    falls: [{ text: "{name} stochert im Schloss, der Dietrich bricht ab – und die Tür war die ganze Zeit offen. 🚪" }],
  },
  {
    words: /such|durchsuch|untersuch|schau.*nach|tast/,
    falls: [{ text: "{name} sucht ganz genau … und findet nur eine alte, feuchte Socke. Sie riecht. 🧦" }],
  },
  {
    words: /tanz|sing|musik|lied|spiel.*laute|flöte/,
    falls: [{ text: "{name} stimmt das schönste Lied an – heraus kommt ein Ton, bei dem selbst die Ratten weglaufen. 🎶😖", effect: "exposed" }],
  },
  {
    words: /gold|münze|geld|bezahl/,
    falls: [{ text: "{name} greift nach dem Geldbeutel, der Knoten geht auf – Münzen kullern in alle Ritzen. 🪙", effect: "lose_gold" }],
  },
  {
    words: /fackel|anzünd|feuer|brenn/,
    falls: [{ text: "{name} will Feuer machen und versengt sich dabei die Augenbrauen. Riecht nach Grillfest. 🔥", effect: "hurt" }],
  },
];

const ANY: Pratfall[] = [
  { text: "{name} verheddert sich spektakulär im eigenen Umhang und dreht sich zweimal um sich selbst. 🌀", effect: "fall" },
  { text: "{name} macht alles richtig – nur in die falsche Richtung. Sehr schwungvoll. 🙃", effect: "exposed" },
  { text: "{name} tritt auf den eigenen Schnürsenkel, stolpert und klammert sich an den Nächstbesten. 🤦", effect: "fall" },
];

/** The comic opposite of what the hero wanted (a natural 1 on a free action). */
export function pratfall(text: string, hero: string, who: string | undefined, roll: number): { line: string; effect?: Pratfall["effect"] } {
  const low = text.toLowerCase();
  const pattern = PATTERNS.find((p) => p.words.test(low));
  // Without anyone to aim at, lines about a "who" make no sense.
  const fitting = (pattern?.falls ?? ANY).filter((f) => who || !f.text.includes("{who}"));
  const list = fitting.length ? fitting : ANY;
  const pick = list[Math.abs(Math.floor(roll)) % list.length]!;
  const line = pick.text.replaceAll("{name}", hero).replaceAll("{who}", who ?? "jemand");
  return { line, ...(pick.effect ? { effect: pick.effect } : {}) };
}

/** A small consequence as an effect for the rules (they decide whether it fits right now). */
export function pratfallEffect(effect: Pratfall["effect"], target: string | undefined): DmEffect | undefined {
  switch (effect) {
    case "fall":
      return { kind: "fall" };
    case "fumble":
      return { kind: "fumble" };
    case "exposed":
      return { kind: "exposed" };
    case "hurt":
      return { kind: "hurt", severity: "leicht" };
    case "lose_gold":
      return { kind: "lose_gold" };
    case "enrage":
      return target ? { kind: "enrage", target } : undefined;
    default:
      return undefined;
  }
}

/** A natural 20: it goes better than planned. */
const TRIUMPHS = [
  "🌟 NATÜRLICHE 20! {name} macht das so elegant, dass alle kurz vergessen zu atmen.",
  "🌟 NATÜRLICHE 20! Das wird man sich in den Wirtshäusern noch lange erzählen – {name} in Bestform!",
  "🌟 NATÜRLICHE 20! {name} schafft es mühelos – und sieht dabei auch noch fantastisch aus.",
];

export function triumph(hero: string, roll: number): string {
  return TRIUMPHS[Math.abs(Math.floor(roll)) % TRIUMPHS.length]!.replaceAll("{name}", hero);
}
