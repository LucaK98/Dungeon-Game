/**
 * The scripted Dungeon Master: tells the story from the JSON and decides with fixed rules
 * (twist at the marked step, an event when the group is quick or things were too easy,
 * the ending by a simple table).
 */
import type { DmContext, DmResponse, DmTrigger, DungeonMaster } from "../shared/dm";
import type { Ending, Narration, Story } from "../shared/story";
import { getSkill } from "../engine/data";
import { canFlee } from "./combat-tricks";
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

const ATTACK_WORDS = /greif|schlag|hau |haue|stech|schieß|schiess|angriff|attack|töte|kämpf/;
const SCARE_WORDS = /einschücht|droh|brüll|erschreck|verjag|verscheuch/;
const TRICK_WORDS = /ablenk|täusch|trick|bluff|verwirr|lock|list|werf.*sand|stolper/;

/** Free actions during a fight: attacks go through the buttons, tricks get a roll and a real effect. */
function combatFreeText(text: string, hero: string, playerId: string): DmResponse {
  const t = text.toLowerCase();
  if (SCARE_WORDS.test(t) || TRICK_WORDS.test(t)) {
    const skill = SCARE_WORDS.test(t) ? "intimidation" : "deception";
    return respond([{ text: `${hero} versucht es mit einem Trick. Gelingt die Probe?` }], {
      request_roll: { playerId, ability: getSkill(skill).ability, skill, dc: 13 },
      next: "await_roll",
    });
  }
  if (ATTACK_WORDS.test(t)) {
    return respond([
      {
        text: `${hero} will angreifen – dafür gibt es den Knopf „⚔️ Angreifen“ auf dem Handy. Nur so wird der Schaden richtig ausgewürfelt.`,
        tip: { key: "angriffswurf", text: "Freie Aktionen eignen sich im Kampf für Tricks: ablenken, täuschen oder einschüchtern." },
      },
    ]);
  }
  return respond([{ text: `${hero} versucht: „${text.slice(0, 80)}“ – doch mitten im Kampf bewirkt das nichts.` }, { text: "Im Kampf helfen Tricks wie Ablenken, Täuschen oder Einschüchtern." }]);
}

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
        if (ctx.combat?.enemies.length) return combatFreeText(trigger.text, trigger.heroName, trigger.playerId);
        const hit = (scene.keywords ?? []).find((k) => k.words.some((w) => said.some((s) => s.startsWith(w))));
        if (hit) {
          return respond(hit.response, {
            ...(hit.set ? { set_flags: hit.set } : {}),
            ...(hit.clue ? { reveal_clue: hit.clue } : {}),
          });
        }
        // Without an AI the narrator can only acknowledge the idea and point at the buttons.
        return respond([
          { text: `${trigger.heroName} versucht es: „${trigger.text.slice(0, 80)}“ – doch nichts Besonderes geschieht.` },
          { text: "Vielleicht hilft eine der Möglichkeiten auf dem Handy weiter." },
        ]);
      }

      case "roll_result":
        if (ctx.combat?.enemies.length && trigger.success) {
          if (trigger.skill === "intimidation" && canFlee(ctx)) {
            return respond([{ text: `${trigger.heroName} brüllt so furchterregend, dass die Gegner Hals über Kopf davonlaufen!` }], { combat_effect: { kind: "flee" } });
          }
          const target = ctx.combat.enemies[0]!;
          return respond([{ text: `Der Trick gelingt! ${target.name} ist abgelenkt – der nächste Angriff auf ${target.name} hat Vorteil.` }], {
            combat_effect: { kind: "distract", target: target.id },
          });
        }
        return respond([
          trigger.success
            ? { text: `Geschafft! ${trigger.heroName} gelingt es.` }
            : { text: `Leider nicht. ${trigger.heroName} versucht es, aber es klappt nicht.` },
        ]);

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

      case "story_end": {
        const ending = pickEnding(this.story, ctx.truth, ctx.flags);
        return respond(ending.text, { choose_ending: ending.id, next: "end_scene" });
      }
    }
  }
}
