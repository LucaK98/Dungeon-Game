/**
 * Trash talk: enemies who can talk mock the heroes – when they hit, miss, get hit, are nearly done
 * and when they fall. Two registers: cheeky (for everyone) and crude (swearing; on by default,
 * switched off in the TV settings). Animals, swarms and the mindless dead only snarl.
 */
export type TauntEvent = "hit_hero" | "missed_hero" | "hero_missed" | "hurt" | "low" | "dying";

/** Monsters that can talk (the rest growls at most). */
const TALKERS = new Set([
  "goblin", "kobold", "bandit", "bandit-captain", "thug", "cultist", "cult-fanatic", "spy", "knight", "veteran", "guard", "noble",
  "ogre", "green-hag", "mage", "priest", "red-dragon-wyrmling", "werewolf-hybrid", "ghost", "skeleton", "commoner", "scout",
]);

export function canTalk(monster: string): boolean {
  return TALKERS.has(monster);
}

type Pool = Record<TauntEvent, string[]>;

// {hero} = the hero's name.
const CHEEKY: Pool = {
  hit_hero: [
    "Na, {hero}? Tut’s weh? Soll ich pusten?",
    "Das war erst das Vorspiel, {hero}!",
    "Hahaha! Hast du das gespürt, {hero}? Ich schon!",
    "Deine Rüstung ist aus Pappe, oder?",
    "Ab nach Hause zu Mami, {hero}!",
    "Treffer! Schreib’s dir auf, {hero}.",
  ],
  missed_hero: [
    "Halt still, du zappelige Wurst!",
    "Absicht! Das war … eine Finte!",
    "Hör auf rumzuhüpfen, {hero}!",
    "Das nächste Mal, {hero}. Versprochen.",
  ],
  hero_missed: [
    "Daneben! Meine Oma zielt besser – und die ist blind!",
    "Uuuh, gefährlich! Fast hättest du die Luft getroffen!",
    "War das ein Angriff oder ein Tanz, {hero}?",
    "Zielen üben, {hero}! Zielen!",
    "Pfff. Kitzelt nicht mal.",
    "Hast du deine Waffe beim Trödler gewonnen?",
  ],
  hurt: [
    "Aua! Das gibt Rache, {hero}!",
    "Nur ein Kratzer! Ein … ziemlich großer Kratzer.",
    "Okay, DAS hat wehgetan.",
    "Glückstreffer! Reiner Glückstreffer!",
  ],
  low: [
    "Äh … können wir drüber reden?",
    "Ich war nur zufällig hier! Ehrlich!",
    "Das war nur zum Aufwärmen!",
    "Mama hat gesagt, ich soll Bäcker werden …",
  ],
  dying: [
    "Das … erzähl ich … meinem Anwalt …",
    "Ich komm wieder … als Geist … und nerv dich …",
    "Sag meiner Katze … dass ich sie … nie mochte …",
    "Na toll. Und das an meinem Geburtstag.",
    "Unfair … ihr wart … mehr …",
  ],
};

const CRUDE: Pool = {
  hit_hero: [
    "Friss das, du Hurensohn!",
    "Na, {hero}, du Lappen? Gefällt dir das?",
    "Ich hau dich zu Brei, du Wichser!",
    "Heul doch, {hero}, du Pissnelke!",
    "Das war für deine Mutter, {hero}!",
    "Voll auf die Fresse, du Arschgeige!",
  ],
  missed_hero: [
    "Scheiße! Halt still, du Bastard!",
    "Verdammte Axt! Beim nächsten Mal, {hero}, du Mistkerl!",
    "Hör auf zu zappeln, du Hurensohn!",
    "Leck mich doch, {hero}!",
  ],
  hero_missed: [
    "Daneben, du Opfer! Meine Oma zielt besser!",
    "Hahaha! Triffst du im Bett auch so schlecht, {hero}?",
    "Was war das, du Flachzange? Ein Streichelversuch?",
    "Zielen, du Vollpfosten! ZIELEN!",
    "Du kämpfst wie ein besoffener Hurensohn!",
    "Pfff. Meine Fürze sind gefährlicher als du, {hero}.",
  ],
  hurt: [
    "Au, du Arschloch! Das gibt Rache!",
    "Scheiße, das tat weh, du Bastard!",
    "Glückstreffer, du Wichser!",
    "Dafür reiß ich dir den Arsch auf, {hero}!",
  ],
  low: [
    "Scheiße, Scheiße, Scheiße …",
    "Okay, okay! Ich nehm den Hurensohn zurück!",
    "Ich hab mir gerade in die Hose gemacht. Zufrieden, {hero}?",
    "Verpisst euch einfach, ja? Bitte?",
  ],
  dying: [
    "Fick … dich … {hero} …",
    "Du … elender … Hurensohn …",
    "Scheiße … ausgerechnet … von dir …",
    "Ich … hasse … euch … alle …",
  ],
};

const GROWLS: Partial<Record<TauntEvent, string[]>> = {
  hit_hero: ["Grrrr!", "*knurrt zufrieden*"],
  hero_missed: ["*schnaubt verächtlich*", "Grrr-hehe."],
  dying: ["*jault*", "*röchelt*"],
};

/**
 * A line for this moment, or none (not every blow needs a comment). `roll` is 0…1.
 * Chance: dying and low always, hits and misses now and then.
 */
export function tauntFor(event: TauntEvent, monster: string, hero: string, crude: boolean, roll: number, pickRoll = Math.random()): string | undefined {
  const chance: Record<TauntEvent, number> = { dying: 0.85, low: 0.7, hit_hero: 0.45, hero_missed: 0.45, missed_hero: 0.25, hurt: 0.3 };
  if (roll >= chance[event]) return undefined;
  const pool = canTalk(monster) ? (crude ? [...CRUDE[event], ...CHEEKY[event].slice(0, 2)] : CHEEKY[event]) : GROWLS[event];
  if (!pool?.length) return undefined;
  return pool[Math.floor(pickRoll * pool.length) % pool.length]!.replaceAll("{hero}", hero);
}
