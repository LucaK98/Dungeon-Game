/** "Was wirklich geschah": the ending, the secret truth, clues found and missed. */
import type { StoryResult } from "../dm/director";
import { h } from "../ui/dom";
import { dollCanvas } from "../ui/atlas";
import { shareRecap } from "../ui/recap-image";

const KIND_ICON: Record<string, string> = { sieg: "🏆", friedlich: "🕊️", bittersuess: "🥀", scheitern: "💫" };

export function endScreen(root: HTMLElement, r: StoryResult, onDone: () => void): () => void {
  const back = h("button", { class: "tv-btn primary big", type: "button", textContent: "Zurück zum Titel" });
  const photo = h("button", { class: "tv-btn", type: "button", textContent: "📸 Bild speichern" });
  photo.addEventListener("click", () => void shareRecap(r.recap));
  const heroes = new Map(r.recap.heroes.map((x) => [x.id, x]));
  const highlights = r.recap.highlights.length
    ? h(
        "div",
        { class: "highlights" },
        ...r.recap.highlights.map((hl) => {
          const hero = heroes.get(hl.heroId);
          return h(
            "div",
            { class: "highlight", style: `--player:${hero?.color ?? "#888"}` },
            hero?.look ? dollCanvas(hero.look, 3, "hl-doll") : h("span", {}),
            h("div", {}, h("strong", {}, `${hl.icon} ${hl.title}`), h("span", { class: "hl-name" }, hero?.name ?? ""), h("span", { class: "muted" }, hl.text)),
          );
        }),
      )
    : "";
  const el = h(
    "main",
    { class: "tv-screen end" },
    h(
      "section",
      { class: "end-inner" },
      h("div", { class: "end-icon" }, KIND_ICON[r.ending.kind] ?? "📖"),
      h("h1", {}, r.ending.title),
      ...r.ending.text.map((l) => h("p", { class: "end-text" }, l.text)),
      r.village
        ? h(
            "div",
            { class: "end-home" },
            h("h2", {}, "🏘️ Heimkehr"),
            h("p", {}, `Das Heimatdorf bekommt ${r.village.income} Gold für die Dorfkasse (jetzt ${r.village.gold} Gold) – baut im Hauptmenü unter „Heimatdorf“ etwas Neues!`),
            r.village.ally ? h("p", {}, `🤝 ${r.village.ally} ist jetzt euer Freund – vielleicht hilft er euch im nächsten Abenteuer.`) : "",
            r.village.nemesis ? h("p", {}, `🗡️ ${r.village.nemesis} ist entkommen … und wird sich rächen wollen.`) : "",
          )
        : "",
      h("h2", {}, "🌟 Eure Highlights"),
      highlights,
      r.recap.bestIdea ? h("p", { class: "best-idea" }, `🎭 Beste Idee: „${r.recap.bestIdea}“`) : "",
      r.recap.badges?.length
        ? h(
            "div",
            { class: "end-goals" },
            h("h2", {}, "🏅 Neue Abzeichen fürs Heldenbuch"),
            ...r.recap.badges.map((b) => h("p", { class: "goal-reveal done", style: `--player:${b.color}` }, `${b.icon} `, h("strong", {}, b.name), ` – ${b.title}`)),
          )
        : "",
      r.recap.finalBlow
        ? h("div", { class: "end-blow" }, h("h2", {}, `⚔️ Der letzte Schlag: ${r.recap.finalBlow.name} gegen ${r.recap.finalBlow.boss}`), h("p", { class: "blow-quote" }, `„${r.recap.finalBlow.text}“`), r.recap.finalBlow.narration ? h("p", { class: "end-text" }, r.recap.finalBlow.narration) : "")
        : "",
      r.recap.goals?.length
        ? h(
            "div",
            { class: "end-goals" },
            h("h2", {}, "🤫 Die geheimen Ziele"),
            ...r.recap.goals.map((g) => h("p", { class: `goal-reveal${g.done ? " done" : ""}`, style: `--player:${g.color}` }, `${g.done ? "✅" : "❌"} ${g.icon} `, h("strong", {}, g.name), ` ${g.reveal}${g.done ? " – geschafft! 💰 +25" : ""}`)),
          )
        : "",
      h("h2", {}, "Was wirklich geschah"),
      h("div", { class: "truth" }, h("strong", {}, r.truth.title), h("p", {}, r.truth.summary)),
      h(
        "div",
        { class: "clue-columns" },
        h("div", {}, h("h3", {}, `🔎 Gefunden (${r.found.length})`), ...r.found.map((c) => h("p", { class: c.falseLead ? "clue false" : "clue" }, `${c.falseLead ? "🌫️ Falsche Fährte: " : "✓ "}${c.text}`))),
        h("div", {}, h("h3", {}, `❔ Übersehen (${r.missed.length})`), ...r.missed.map((c) => h("p", { class: "clue missed" }, `✗ ${c.text}`))),
      ),
      h("p", { class: "muted" }, "Beim nächsten Spiel wird die Wahrheit neu ausgewürfelt – die Geschichte kann ganz anders ausgehen."),
      h("div", { class: "tv-row" }, photo, back),
    ),
  );
  back.addEventListener("click", onDone);
  root.append(el);
  queueMicrotask(() => back.focus());
  return () => el.remove();
}
