/**
 * The game master retells a free action for the whole table: what the player typed in the first
 * person ("Ich streichle den Hund und werfe ihm meine Wurst zu") becomes a short sentence about the
 * hero ("Brunhild streichelt den Hund und wirft ihm seine Wurst zu"). Plain rules, no AI needed –
 * when a sentence is too odd to turn around, the player's own words are quoted instead.
 */

/** Verbs that do not follow the rule (1st person → 3rd person). */
const IRREGULAR: Record<string, string> = {
  bin: "ist",
  habe: "hat",
  hab: "hat",
  will: "will",
  kann: "kann",
  muss: "muss",
  darf: "darf",
  soll: "soll",
  mag: "mag",
  möchte: "möchte",
  weiß: "weiß",
  werde: "wird",
  gebe: "gibt",
  geb: "gibt",
  nehme: "nimmt",
  nehm: "nimmt",
  werfe: "wirft",
  werf: "wirft",
  helfe: "hilft",
  helf: "hilft",
  spreche: "spricht",
  sprech: "spricht",
  breche: "bricht",
  steche: "sticht",
  treffe: "trifft",
  trete: "tritt",
  sehe: "sieht",
  seh: "sieht",
  lese: "liest",
  esse: "isst",
  vergesse: "vergisst",
  laufe: "läuft",
  lauf: "läuft",
  schlage: "schlägt",
  schlag: "schlägt",
  trage: "trägt",
  fahre: "fährt",
  falle: "fällt",
  fange: "fängt",
  halte: "hält",
  lasse: "lässt",
  lass: "lässt",
  stoße: "stößt",
  schlafe: "schläft",
  wasche: "wäscht",
  grabe: "gräbt",
  rate: "rät",
  blase: "bläst",
  empfehle: "empfiehlt",
  befehle: "befiehlt",
  stehle: "stiehlt",
  werbe: "wirbt",
  wirf: "wirft",
  nimm: "nimmt",
  gib: "gibt",
};

/** First person → third person for one verb ("streichle" → "streichelt", "rede" → "redet"). */
export function thirdPerson(verb: string): string {
  const low = verb.toLowerCase();
  const irregular = IRREGULAR[low];
  if (irregular) return irregular;
  // "streichle", "sammle", "klingle": the e comes back in ("streichelt").
  const le = /^(.*[^aeiouäöü])le$/.exec(low);
  if (le) return `${le[1]}elt`;
  // "rede", "bitte", "öffne", "atme": an e before the t.
  const stem = low.endsWith("e") ? low.slice(0, -1) : low;
  if (/(t|d|chn|ffn|gn|tm|dm)$/.test(stem)) return `${stem}et`;
  // "reise", "schließe": just t.
  if (/(s|ß|z|x)$/.test(stem)) return `${stem}t`;
  return `${stem}t`;
}

/** Words that change with the person ("mein Schwert" → "sein Schwert"). */
const PRONOUNS: [RegExp, string][] = [
  [/\bmich\b/gi, "sich"],
  [/\bmir\b/gi, "sich"],
  [/\bmein(e|en|em|er|es)?\b/gi, "sein$1"],
  [/\bwir\b/gi, "sie"],
  [/\bunser(e|en|em|er|es)?\b/gi, "ihr$1"],
];

/** Starts that only fill ("Also", "Okay, dann") – left out of the retelling. */
const FILLER = /^(also|okay|ok|gut|ähm|äh|hm+|dann|und|na ja|so)[,!.\s]+/i;

/**
 * The free action in one sentence about the hero. Falls back to the quoted words when the sentence
 * has no "ich" to turn around ("Feuerball auf den Ork!").
 */
export function retell(text: string, hero: string): string {
  let s = text.trim().replace(/\s+/g, " ").replace(/[.!?…]+$/u, "");
  while (FILLER.test(s)) s = s.replace(FILLER, "");
  if (!s) return `${hero} hat eine Idee.`;
  // Long monologues are cut at the end of the first thought.
  if (s.length > 140) s = `${s.slice(0, 137).replace(/\s+\S*$/, "")} …`;
  const words = s.split(" ");
  const ichAt = words.findIndex((w) => /^ich[,]?$/i.test(w));
  if (ichAt < 0) return `${hero}: „${s}“`;
  // "Ich streichle …": the verb follows; "Dann werfe ich …": the verb comes before.
  const verbAt = ichAt === 0 ? 1 : ichAt - 1;
  const verb = words[verbAt];
  if (!verb || !/^[a-zäöüß]+$/i.test(verb)) return `${hero}: „${s}“`;
  words[verbAt] = thirdPerson(verb);
  words[ichAt] = hero;
  // "Jetzt werfe ich …" → "Pip wirft …" (the name first reads best when told aloud).
  if (ichAt > 0) words.splice(0, ichAt + 1, hero, words[verbAt]!);
  // A second "ich" later ("…, damit ich fliehen kann"): becomes "er/sie" – we do not know, so the name again.
  for (let i = ichAt + 1; i < words.length; i++) {
    if (/^ich[,]?$/i.test(words[i]!)) {
      const comma = words[i]!.endsWith(",") ? "," : "";
      words[i] = `${hero}${comma}`;
      // "und ich werfe" / "ich laufe dann": its verb follows right after.
      const next = words[i + 1];
      if (next && /^[a-zäöüß]+$/i.test(next) && i + 1 !== verbAt) words[i + 1] = thirdPerson(next);
    }
  }
  // "und werfe": a second verb for the same "ich" after "und"/"dann" ("streichle den Hund und gebe ihm …").
  for (let i = 1; i < words.length - 1; i++) {
    if (!/^(und|dann|danach|oder)$/i.test(words[i]!)) continue;
    const next = words[i + 1]!;
    if (/^[a-zäöüß]+e$/.test(next) && !/^(die|der|eine|keine|seine|meine|alle|ganze|große|kleine|nahe|ihre|diese|jede|beide)$/i.test(next)) words[i + 1] = thirdPerson(next);
  }
  let out = words.join(" ");
  for (const [re, to] of PRONOUNS) out = out.replace(re, (m, ending: string | undefined) => keepCase(m, to.replace("$1", ending ?? "")));
  // The hero's name is the subject: the sentence starts with a capital letter.
  out = out.charAt(0).toUpperCase() + out.slice(1);
  return `${out}.`;
}

function keepCase(original: string, replacement: string): string {
  return original[0] === original[0]!.toUpperCase() ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
}
