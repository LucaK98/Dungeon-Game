/**
 * The scripted Dungeon Master: tells the story from the JSON and decides with fixed rules
 * (twist at the marked step, an event when the group is quick or things were too easy,
 * the ending by a simple table).
 */
import type { DmContext, DmResponse, DmTrigger, DungeonMaster } from "../shared/dm";
import type { Ending, Narration, Story } from "../shared/story";
import { glossaryAnswer } from "./rules-help";
import { intentOf, scriptedFreeText, scriptedIdeas, scriptedRollResult } from "./free-actions";
import { sceneById } from "./planner";

export function narrationText(lines: Narration[]): string {
  return lines.map((l) => (l.npc ? `${l.npc}: ${l.text}` : l.text)).join(" ");
}

function respond(script: Narration[], extra: Partial<DmResponse> = {}): DmResponse {
  return { narration: narrationText(script), script, next: "await_action", ...extra };
}

/** Normalizes text for keyword matching ("Ich biete ihm Brot an" → words). */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zäöüß ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function pickEnding(story: Story, truth: string, flags: string[]): Ending {
  const has = (f: string) => flags.includes(f);
  return (
    story.endings.find(
      (e) =>
        (!e.truths || e.truths.includes(truth)) &&
        (e.requires ?? []).every(has) &&
        !(e.unless ?? []).some(has),
    ) ?? story.endings[story.endings.length - 1]!
  );
}

/** The narrator nudges a quiet group with a small happening (no rules involved). */
const IDLE_LINES = [
  "Irgendwo knackt ein Ast. Dann ist es wieder still.",
  "Ein kühler Luftzug streicht an euch vorbei, als wolle er euch weiterschieben.",
  "In der Ferne ruft jemand – oder war es nur der Wind?",
  "Ein Käfer krabbelt über eure Stiefel und verschwindet in einer Ritze.",
  "Die Schatten scheinen sich ein kleines Stück bewegt zu haben.",
  "Ihr hört euren eigenen Herzschlag. Worauf wartet ihr noch?",
];

/** After the campfire tales (without AI). */
const CAMP_LINES = [
  "Das Feuer knistert. Für eine Weile sagt niemand etwas – aber ihr kennt euch jetzt ein Stück besser.",
  "Funken steigen in den Nachthimmel. Morgen geht es weiter, und ihr geht es gemeinsam an.",
  "Einer nach dem anderen schläft ein. Die Wache am Feuer lächelt über das, was sie heute gehört hat.",
];

export class ScriptedDM implements DungeonMaster {
  constructor(private story: Story) {}

  async respond(ctx: DmContext, trigger: DmTrigger): Promise<DmResponse> {
    const scene = sceneById(this.story, ctx.sceneId);
    switch (trigger.kind) {
      case "scene_start":
        return respond(scene.travel ? [{ text: scene.travel }] : []);

      case "step_start": {
        const step = scene.steps.find((s) => s.id === ctx.stepId);
        if (!step) return respond([]);
        if (step.twist && !ctx.twistRevealed) {
          const truth = this.story.truths.find((t) => t.id === ctx.truth)!;
          return respond([...(step.enter ?? []), ...truth.reveal], { reveal_twist: true });
        }
        return respond(step.enter ?? []);
      }

      case "step_done": {
        const step = scene.steps.find((s) => s.id === ctx.stepId);
        return respond(step?.done ?? []);
      }

      case "free_text": {
        const said = words(trigger.text);
        const hit = (scene.keywords ?? []).find((k) => k.words.some((w) => said.some((s) => s.startsWith(w))));
        if (hit) {
          return respond(hit.response, {
            ...(hit.set ? { set_flags: hit.set } : {}),
            ...(hit.clue ? { reveal_clue: hit.clue } : {}),
          });
        }
        const known = scriptedFreeText(ctx, trigger);
        if (known) return known;
        if (ctx.combat?.enemies.length) {
          return respond([
            { text: `${trigger.heroName} versucht: „${trigger.text.slice(0, 80)}“ – doch mitten im Kampf bewirkt das nichts.` },
            { text: "Probiert Tricks wie Sand werfen, umstoßen, bestechen, betören oder einschüchtern – oder tippt auf „💡 Ideen“." },
          ]);
        }
        // Without an AI the narrator can only acknowledge the idea and point at the buttons.
        return respond([
          { text: `${trigger.heroName} versucht es: „${trigger.text.slice(0, 80)}“ – doch nichts Besonderes geschieht.` },
          { text: "Vielleicht hilft eine der Möglichkeiten auf dem Handy weiter." },
        ]);
      }

      case "roll_result": {
        const res = scriptedRollResult(ctx, trigger);
        // Gifts and kind words win a character of this scene over.
        const fighting = !!ctx.combat?.enemies.length;
        if (trigger.success && !fighting && intentOf(trigger.text, false)?.intent === "befriend") {
          const said = trigger.text.toLowerCase();
          const npc = (scene.npcs ?? []).map((n) => this.story.npcs.find((x) => x.id === n.npc)!).find((n) => said.includes(n.name.toLowerCase().split(" ").pop()!));
          if (npc) res.npc_attitude = { npc: npc.id, change: 1 };
        }
        return res;
      }

      case "suggest":
        return { ...respond([]), ideas: scriptedIdeas(ctx) };

      case "rules_question": {
        const best = trigger.glossary[0];
        return { ...respond([]), answer: best ? `${best.title}: ${best.text}` : glossaryAnswer(trigger.question) };
      }

      case "idle": {
        // Something small happens and the goal is repeated.
        const atmo = IDLE_LINES[Math.floor(ctx.minutesPlayed * 7) % IDLE_LINES.length]!;
        const step = scene.steps.find((s) => s.id === ctx.stepId);
        const npc = step?.kind === "reach" && step.target && step.target !== "exit" ? this.story.npcs.find((n) => n.id === step.target) : undefined;
        return respond([
          { text: atmo },
          npc ? { text: `${npc.name} wartet schon auf euch.` } : { text: `Euer Ziel: ${scene.ziel}` },
        ].map((l, i) => (i === 1 ? { ...l, tip: { key: "freie_aktion", text: "Keine Idee? Tippt auf dem Handy auf „💡 Ideen“ – oder lauft einfach los." } } : l)));
      }

      case "scene_end": {
        // Improvised event: after the big fight, if it was too easy, or if the group is well ahead of time.
        const events = this.story.events ?? [];
        const unused = events.filter((e) => !ctx.eventsUsed.includes(e.id));
        const last = ctx.sceneIndex === ctx.sceneCount - 1;
        const tooEasy = last && ctx.hardship < 0.5;
        const ahead = ctx.minutesPlanned > 0 && ctx.minutesPlayed < ctx.minutesPlanned * 0.6 && ctx.sceneIndex >= 2;
        if (unused.length && (tooEasy || ahead)) {
          return respond([], { trigger_event: unused[0]!.id });
        }
        return respond([]);
      }

      case "campfire": {
        // Without AI: the fire answers with a quiet line; the tales stay in the chronicle.
        const line = CAMP_LINES[(ctx.sceneIndex + trigger.tales.length) % CAMP_LINES.length]!;
        return respond([{ text: line }]);
      }

      case "story_end": {
        const ending = pickEnding(this.story, ctx.truth, ctx.flags);
        return respond(ending.text, { choose_ending: ending.id, next: "end_scene" });
      }
    }
  }
}
