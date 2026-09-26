/** "Was wirklich geschah": the ending, the secret truth, clues found and missed. */
import type { StoryResult } from "../dm/director";
import { h } from "../ui/dom";

const KIND_ICON: Record<string, string> = { sieg: "🏆", friedlich: "🕊️", bittersuess: "🥀", scheitern: "💫" };

export function endScreen(root: HTMLElement, r: StoryResult, onDone: () => void): () => void {
  const back = h("button", { class: "tv-btn primary big", type: "button", textContent: "Zurück zum Titel" });
  const el = h(
    "main",
    { class: "tv-screen end" },
    h(
      "section",
      { class: "end-inner" },
      h("div", { class: "end-icon" }, KIND_ICON[r.ending.kind] ?? "📖"),
      h("h1", {}, r.ending.title),
      ...r.ending.text.map((l) => h("p", { class: "end-text" }, l.text)),
      h("h2", {}, "Was wirklich geschah"),
      h("div", { class: "truth" }, h("strong", {}, r.truth.title), h("p", {}, r.truth.summary)),
      h(
        "div",
        { class: "clue-columns" },
        h("div", {}, h("h3", {}, `🔎 Gefunden (${r.found.length})`), ...r.found.map((c) => h("p", { class: c.falseLead ? "clue false" : "clue" }, `${c.falseLead ? "🌫️ Falsche Fährte: " : "✓ "}${c.text}`))),
        h("div", {}, h("h3", {}, `❔ Übersehen (${r.missed.length})`), ...r.missed.map((c) => h("p", { class: "clue missed" }, `✗ ${c.text}`))),
      ),
      h("p", { class: "muted" }, "Beim nächsten Spiel wird die Wahrheit neu ausgewürfelt – die Geschichte kann ganz anders ausgehen."),
      back,
    ),
  );
  back.addEventListener("click", onDone);
  root.append(el);
  queueMicrotask(() => back.focus());
  return () => el.remove();
}
