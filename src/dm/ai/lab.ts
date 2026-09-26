/**
 * #/dm-lab: sends the same game moment to several providers/models and shows the answers
 * side by side (German style, speed, JSON errors). Uses the keys from the TV settings.
 */
import type { DmContext, DmTrigger } from "../../shared/dm";
import type { Story } from "../../shared/story";
import { h } from "../../ui/dom";
import { allScenes } from "../planner";
import { ScriptedDM } from "../scripted";
import { STORIES } from "../stories";
import { AiDM } from "./aidm";
import { buildPrompt } from "./prompt";
import { DM_FUNCTION_URL, SUPABASE_ANON_JWT } from "../../net/supabase";
import { GeminiProvider, GroqProvider, ServerProvider, type LlmProvider } from "./provider";
import { countAiCall, loadAiSettings } from "./settings";

function candidates(): LlmProvider[] {
  const s = loadAiSettings();
  const out: LlmProvider[] = [];
  const add = (make: (m: string) => LlmProvider, models: string[]) => {
    for (const m of new Set(models.filter(Boolean))) out.push(make(m));
  };
  if (s.keys.gemini) add((m) => new GeminiProvider(s.keys.gemini!, m), [s.models.gemini, s.fallbackModels.gemini]);
  if (s.keys.groq) add((m) => new GroqProvider(s.keys.groq!, m), [s.models.groq, s.fallbackModels.groq]);
  out.push(new ServerProvider(DM_FUNCTION_URL, SUPABASE_ANON_JWT, "LAB"));
  return out;
}

export function startDmLab(root: HTMLElement): () => void {
  const storySel = h("select", {}) as HTMLSelectElement;
  const sceneSel = h("select", {}) as HTMLSelectElement;
  const truthSel = h("select", {}) as HTMLSelectElement;
  const triggerSel = h("select", {}, ...["free_text", "scene_start", "roll_result", "story_end"].map((t) => h("option", { value: t }, t))) as HTMLSelectElement;
  const text = h("input", { class: "settings-input", value: "Ich frage den Wirt nach dem Drachen und biete ihm ein Goldstück an." }) as HTMLInputElement;
  const run = h("button", { class: "tv-btn primary", type: "button", textContent: "▶ An alle schicken" });
  const promptBox = h("pre", { class: "lab-prompt" });
  const results = h("div", { class: "lab-results" });
  const info = h("p", { class: "muted" });

  const story = (): Story => STORIES.find((s) => s.id === storySel.value) ?? STORIES[0]!;
  const fillStory = () => {
    const st = story();
    sceneSel.replaceChildren(...allScenes(st).map((s) => h("option", { value: s.id }, s.title)));
    truthSel.replaceChildren(...st.truths.map((t) => h("option", { value: t.id }, t.title)));
  };
  storySel.replaceChildren(...STORIES.map((s) => h("option", { value: s.id }, s.title)));
  storySel.addEventListener("change", fillStory);
  fillStory();

  const ctx = (): DmContext => ({
    storyId: story().id,
    duration: "mittel",
    truth: truthSel.value,
    sceneId: sceneSel.value,
    sceneIndex: Math.max(0, sceneSel.selectedIndex),
    sceneCount: sceneSel.options.length,
    players: [
      { id: "p1", name: "Brunhild", classId: "fighter", hp: 12, maxHp: 12 },
      { id: "p2", name: "Ilmarin", classId: "wizard", hp: 5, maxHp: 8 },
    ],
    actingPlayer: "p1",
    flags: [],
    cluesFound: [],
    twistRevealed: false,
    minutesPlayed: 20,
    minutesPlanned: 30,
    hardship: 0.3,
    eventsUsed: [],
  });
  const trigger = (): DmTrigger => {
    const t = triggerSel.value;
    if (t === "free_text") return { kind: "free_text", text: text.value, playerId: "p1", heroName: "Brunhild" };
    if (t === "roll_result") return { kind: "roll_result", text: text.value, playerId: "p1", heroName: "Brunhild", skill: "persuasion", dc: 13, total: 15, success: true };
    return { kind: t as "scene_start" | "story_end" };
  };

  run.addEventListener("click", async () => {
    const list = candidates();
    const c = ctx();
    const t = trigger();
    const scripted = await new ScriptedDM(story()).respond(c, t);
    promptBox.textContent = buildPrompt(story(), c, t, scripted);
    info.textContent = list.length ? `${list.length} Modelle, ca. ${Math.round(promptBox.textContent.length / 4)} Tokens Kontext` : "Kein Schlüssel hinterlegt: am Fernseher unter ⚙️ Einstellungen eintragen.";
    const cards = [
      { name: "📜 Drehbuch", run: async () => ({ answer: scripted, raw: scripted as unknown, ms: 0, error: "" }) },
      ...list.map((p) => ({
        name: `${p.id} · ${p.model}`,
        run: async () => {
          let raw: unknown;
          let error = "";
          let ms = 0;
          // One provider only, no fallback, short cooldown: we want to see its own errors.
          const dm = new AiDM(story(), [p], {
            cooldownMs: 0,
            onCall: countAiCall,
            onExchange: (e) => {
              raw = e.raw ?? raw;
              error = e.error ?? error;
              ms = e.ms;
            },
          });
          const answer = await dm.respond(c, t);
          return { answer, raw, ms, error };
        },
      })),
    ];
    results.replaceChildren(
      ...cards.map((card) => {
        const body = h("div", { class: "lab-card" }, h("h3", {}, card.name), h("p", { class: "muted" }, "…"));
        void card.run().then(({ answer, raw, ms, error }) => {
          body.replaceChildren(
            h("h3", {}, card.name),
            h("p", { class: "muted" }, `${ms ? `${(ms / 1000).toFixed(1)} s` : ""} ${error ? `⚠️ ${error}` : ""}`),
            h("p", {}, answer.narration),
            answer.npc_say ? h("p", {}, h("b", {}, `${answer.npc_say.name}: `), answer.npc_say.text) : "",
            h("pre", {}, JSON.stringify({ ...answer, narration: undefined, script: undefined }, null, 1)),
            h("details", {}, h("summary", {}, "Roh-Antwort"), h("pre", {}, JSON.stringify(raw, null, 1))),
          );
        });
        return body;
      }),
    );
  });

  const el = h(
    "main",
    { class: "dm-lab" },
    h("h1", {}, "🧪 DM-Labor"),
    h("p", { class: "muted" }, "Derselbe Spielmoment an alle eingerichteten KI-Modelle. Schlüssel kommen aus den TV-Einstellungen dieses Geräts."),
    h("div", { class: "lab-form" }, storySel, sceneSel, truthSel, triggerSel, text, run),
    info,
    results,
    h("details", {}, h("summary", {}, "Prompt ansehen"), promptBox),
  );
  root.append(el);
  return () => el.remove();
}
