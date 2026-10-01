/**
 * The spotlight guard: nobody sits on the couch for long without anything to do. A hero who has
 * not done anything of note for three rounds of exploring gets a hook in the world's turn – a
 * person nearby who wants something from them, or something their class notices.
 */
export const SPOTLIGHT_ROUNDS = 3;

/** What a hero of this class notices (a nudge, never a solution). */
const BY_CLASS: Record<string, string[]> = {
  fighter: ["{name} bemerkt Kratzspuren am Boden – hier wurde etwas Schweres geschleift.", "{name} spürt: Irgendwo hier lauert Ärger. Vielleicht lohnt ein Blick in die nächste Ecke?"],
  wizard: ["✨ {name} spürt ein Kribbeln von Magie ganz in der Nähe.", "📜 {name} fallen seltsame Zeichen auf – vielleicht weiß Wissen mehr?"],
  cleric: ["🙏 {name} hat das Gefühl, dass hier jemand Hilfe braucht.", "🕯️ {name} spürt etwas Unheiliges – irgendwo in diesem Raum."],
  rogue: ["🗝️ {name}s geübte Finger kribbeln – hier gibt es bestimmt etwas zu entdecken.", "👀 {name} sieht etwas Glänzendes, das niemand sonst bemerkt hat."],
  ranger: ["🐾 {name} entdeckt frische Spuren – wohin führen sie?", "🌿 {name} riecht etwas Ungewöhnliches in der Luft."],
  bard: ["🎵 {name} hört ein Gerücht summen – wer hier wüsste wohl mehr?", "🎭 {name} hätte jetzt große Lust, jemanden um den Finger zu wickeln."],
  druid: ["🍃 Die Pflanzen hier flüstern {name} etwas zu.", "🦉 Ein Tier beobachtet {name} – fast so, als wollte es etwas zeigen."],
  monk: ["🧘 {name} spürt einen leichten Luftzug – ein verborgener Weg?", "👂 {name} hört leise Schritte, die sonst niemand bemerkt."],
};
const ANY = ["💡 {name}, dir fällt etwas auf – schau dich genauer um!", "💡 {name} hat eine Ahnung: Hier ist noch nicht alles entdeckt."];

/** The hook for a hero who waited too long (a person nearby comes first). */
export function spotlightLine(name: string, classId: string | undefined, roll: number, person?: string): string {
  if (person) return `👋 ${person} winkt ${name} zu – sieht aus, als gäbe es etwas zu besprechen.`;
  const lines = BY_CLASS[classId ?? ""] ?? ANY;
  return lines[Math.abs(Math.floor(roll)) % lines.length]!.replaceAll("{name}", name);
}

/** Who waited longest without doing anything of note (at least SPOTLIGHT_ROUNDS rounds). */
export function idleHero(heroIds: string[], lastDid: ReadonlyMap<string, number>, round: number): string | undefined {
  let best: string | undefined;
  let longest = SPOTLIGHT_ROUNDS - 1;
  for (const id of heroIds) {
    const idle = round - (lastDid.get(id) ?? 0);
    if (idle > longest) {
      longest = idle;
      best = id;
    }
  }
  return best;
}
