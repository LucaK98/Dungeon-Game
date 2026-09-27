/**
 * "Ich gehe zur Theke", "Ich renne zum Goblin und schlage zu": where the hero wants to go,
 * and what is left to do after the walk.
 */
const MOVE = /\b(geh|gehe|gehen|lauf|laufe|renn|renne|schleich|schleiche|beweg|bewege|spazier|eile|stürm|stürme|spring|springe|kletter|klettere|näher|nähere|stell mich|stelle mich|lauf|hin zu)\w*/;
const TOWARDS = /\b(zu|zur|zum|zu den|an den|an die|ans|in die|in den|ins|nach|richtung|hinter|neben|vor|auf den|auf die)\b\s+(.+)/;
const THEN = /\s*(?:,|\bund dann\b|\bund\b|\bdann\b|\bdanach\b|\bum\b)\s*/;

export interface WalkIntent {
  /** Words that name the place or who to go to ("die theke", "den goblin 2"). */
  target: string;
  /** What to do after walking ("" = nothing). */
  rest: string;
}

export function walkIntent(text: string): WalkIntent | undefined {
  const t = text.toLowerCase();
  const m = MOVE.exec(t);
  if (!m) return undefined;
  const after = t.slice(m.index);
  const to = TOWARDS.exec(after);
  if (!to) return undefined;
  const [clause, ...more] = to[2]!.split(THEN);
  const rest = more.join(" ").trim();
  return { target: clause!.replace(/[.!?]+$/, "").trim(), rest };
}

/** Does the name fit the words? ("den wirt" ~ "Wirt Bartholomäus", "zum regal" ~ "Bücherregal") */
export function nameFits(target: string, name: string): boolean {
  const n = name.toLowerCase();
  if (target.includes(n)) return true;
  const words = target.split(/[^a-zäöüß0-9]+/).filter((w) => w.length >= 3 && !["den", "die", "das", "dem", "der", "zum", "zur", "einen", "eine", "dort", "hin"].includes(w));
  if (words.some((w) => n.split(/\s+/).includes(w))) return true;
  return words.some((w) => w.length >= 4 && (n.includes(w) || n.split(/\s+/).some((x) => x.length >= 4 && w.startsWith(x))));
}
