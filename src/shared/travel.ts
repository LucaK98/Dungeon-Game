/**
 * The Harz travel map between chapters: the group votes for a route, and something happens on the way –
 * herbs, a trader, wolves, a stray animal, an old mine, a wayside shrine, fog or a thunderstorm.
 */
export type TravelEvent = "kraeuter" | "haendler" | "woelfe" | "streuner" | "stollen" | "schrein" | "nebel" | "gewitter";

export interface TravelRoute {
  id: string;
  event: TravelEvent;
  icon: string;
  /** "Durchs Bodetal" */
  name: string;
  /** What the heroes expect there (honest: risk and reward). */
  text: string;
  /** A place on the drawn map (0..1 across, 0..1 down). */
  x: number;
  y: number;
}

const EVENTS: Record<TravelEvent, { icon: string; text: string }> = {
  kraeuter: { icon: "🌿", text: "Blühende Wiesen – hier wachsen Heilkräuter und Pilze." },
  haendler: { icon: "🛒", text: "Die Handelsstraße: Vielleicht trefft ihr einen fahrenden Händler." },
  woelfe: { icon: "🐺", text: "Gefährlich! Wolfsspuren überall – aber auch Beute für Mutige." },
  streuner: { icon: "🐾", text: "Ein verlassener Hof. Irgendwo bellt es …" },
  stollen: { icon: "⛏️", text: "Ein alter Bergwerksstollen – vielleicht liegt noch Silber darin." },
  schrein: { icon: "⛩️", text: "Ein Wegkreuz mit Kerzen: Ein Gebet schadet nie." },
  nebel: { icon: "🌫️", text: "Der Nebelpfad ist unheimlich, aber Raben kreisen darüber." },
  gewitter: { icon: "⛈️", text: "Über den Pass zieht ein Gewitter auf. Nass, aber schnell." },
};

/** Real places in the Harz, placed roughly where they are (west left, east right). */
const PLACES: { name: string; x: number; y: number; via: string }[] = [
  { name: "Goslar", x: 0.12, y: 0.35, via: "Über Goslar" },
  { name: "Okertal", x: 0.2, y: 0.55, via: "Durchs Okertal" },
  { name: "Torfhaus", x: 0.32, y: 0.42, via: "Über Torfhaus" },
  { name: "Brocken", x: 0.42, y: 0.3, via: "Über den Brocken" },
  { name: "Schierke", x: 0.48, y: 0.45, via: "Durch Schierke" },
  { name: "Ilsenburg", x: 0.45, y: 0.15, via: "Über Ilsenburg" },
  { name: "Wernigerode", x: 0.58, y: 0.2, via: "Über Wernigerode" },
  { name: "Elend", x: 0.55, y: 0.6, via: "Durch Elend" },
  { name: "Rübeland", x: 0.66, y: 0.55, via: "Über Rübeland" },
  { name: "Blankenburg", x: 0.72, y: 0.3, via: "Über Blankenburg" },
  { name: "Teufelsmauer", x: 0.8, y: 0.25, via: "An der Teufelsmauer entlang" },
  { name: "Bodetal", x: 0.84, y: 0.5, via: "Durchs Bodetal" },
  { name: "Hexentanzplatz", x: 0.88, y: 0.62, via: "Über den Hexentanzplatz" },
  { name: "Rosstrappe", x: 0.9, y: 0.4, via: "Über die Rosstrappe" },
];

/** Three different routes (own dice: the pick does not change the story's dice). */
export function pickRoutes(pick: (n: number) => number): TravelRoute[] {
  const events = Object.keys(EVENTS) as TravelEvent[];
  const places = [...PLACES];
  const out: TravelRoute[] = [];
  for (let k = 0; k < 3; k++) {
    const event = events.splice(pick(events.length), 1)[0]!;
    const place = places.splice(pick(places.length), 1)[0]!;
    out.push({ id: `travel:${event}`, event, icon: EVENTS[event].icon, name: place.via, text: EVENTS[event].text, x: place.x, y: place.y });
  }
  return out;
}

export function eventInfo(event: TravelEvent): { icon: string; text: string } {
  return EVENTS[event];
}
