/**
 * TV settings: who tells the story (script or AI), the API key and the model.
 * The key is stored only in this device's localStorage. It is never sent to the phones
 * and never ends up in the repo. No format check: Gemini keys may start with "AQ." too.
 */
import { SYSTEM_PROMPT } from "../dm/ai/prompt";
import { GeminiProvider, GroqProvider, LlmError, type ProviderId } from "../dm/ai/provider";
import { aiCallsToday, countAiCall, loadAiSettings, saveAiSettings, type AiSettings } from "../dm/ai/settings";
import { h } from "../ui/dom";

const PROVIDERS: { id: AiSettings["provider"]; label: string; detail: string }[] = [
  { id: "off", label: "📜 Drehbuch", detail: "Ohne KI. Der Erzähler folgt der Geschichte, freie Aktionen versteht er nur bei Stichworten." },
  { id: "gemini", label: "🧠 Gemini (Google)", detail: "Kostenloser Schlüssel aus Google AI Studio (aistudio.google.com). Die KI erzählt frei und reagiert auf eure Ideen." },
  { id: "groq", label: "⚡ Groq", detail: "Ersatz-Anbieter mit Gratis-Stufe (console.groq.com)." },
];

export function settingsScreen(root: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const s = loadAiSettings();
    const status = h("p", { class: "settings-status" });
    const calls = h("p", { class: "muted" });
    const renderCalls = () => (calls.textContent = `KI-Aufrufe heute: ${aiCallsToday()}`);
    renderCalls();

    const providerRow = h("div", { class: "settings-providers" });
    const keyInput = h("input", { class: "settings-input", type: "password", autocomplete: "off", spellcheck: false, placeholder: "API-Schlüssel hier einfügen" }) as HTMLInputElement;
    const showKey = h("button", { class: "tv-btn small", type: "button", textContent: "👁 Zeigen" });
    const modelInput = h("input", { class: "settings-input", type: "text", spellcheck: false }) as HTMLInputElement;
    const fallbackInput = h("input", { class: "settings-input", type: "text", spellcheck: false }) as HTMLInputElement;
    const models = h("datalist", { id: "ai-models" });
    modelInput.setAttribute("list", "ai-models");
    fallbackInput.setAttribute("list", "ai-models");
    const test = h("button", { class: "tv-btn", type: "button", textContent: "🔌 Verbindung testen" });
    const clearKey = h("button", { class: "tv-btn small", type: "button", textContent: "🗑 Schlüssel löschen" });
    const done = h("button", { class: "tv-btn primary", type: "button", textContent: "✔ Speichern & zurück" });
    const aiPart = h(
      "div",
      { class: "settings-ai" },
      h("label", {}, "Schlüssel", h("div", { class: "tv-row" }, keyInput, showKey)),
      h("label", {}, "Modell", modelInput),
      h("label", {}, "Ausweich-Modell (wenn das Gratis-Limit erreicht ist)", fallbackInput),
      models,
      h("div", { class: "tv-row" }, test, clearKey),
      status,
      h("p", { class: "settings-warn" }, "🔒 Nur auf eigenen Geräten verwenden. Der Schlüssel bleibt nur auf diesem Gerät gespeichert und wird nie an die Handys geschickt."),
    );

    // The key field shows the key of the chosen provider.
    const current = (): ProviderId | undefined => (s.provider === "off" ? undefined : s.provider);
    const pull = () => {
      const p = current();
      if (!p) return;
      const key = keyInput.value.trim();
      if (key) s.keys[p] = key;
      else delete s.keys[p];
      if (modelInput.value.trim()) s.models[p] = modelInput.value.trim();
      s.fallbackModels[p] = fallbackInput.value.trim();
    };
    const render = () => {
      providerRow.replaceChildren(
        ...PROVIDERS.map((p) => {
          const b = h("button", { class: `story-card provider${s.provider === p.id ? " selected" : ""}`, type: "button" }, h("h2", {}, p.label), h("p", {}, p.detail));
          b.addEventListener("click", () => {
            pull();
            s.provider = p.id;
            status.textContent = "";
            render();
          });
          return b;
        }),
      );
      const p = current();
      aiPart.hidden = !p;
      if (p) {
        keyInput.value = s.keys[p] ?? "";
        modelInput.value = s.models[p];
        fallbackInput.value = s.fallbackModels[p];
      }
    };

    showKey.addEventListener("click", () => {
      keyInput.type = keyInput.type === "password" ? "text" : "password";
      showKey.textContent = keyInput.type === "password" ? "👁 Zeigen" : "🙈 Verbergen";
    });
    clearKey.addEventListener("click", () => {
      keyInput.value = "";
      pull();
      saveAiSettings(s);
      status.textContent = "Schlüssel gelöscht.";
    });
    test.addEventListener("click", async () => {
      pull();
      const p = current();
      const key = p && s.keys[p];
      if (!p || !key) {
        status.textContent = "Bitte zuerst einen Schlüssel einfügen.";
        return;
      }
      test.disabled = true;
      status.textContent = "Teste …";
      const provider = p === "gemini" ? new GeminiProvider(key, s.models[p]) : new GroqProvider(key, s.models[p]);
      try {
        const list = await provider.listModels();
        models.replaceChildren(...list.map((m) => h("option", { value: m })));
        const started = performance.now();
        countAiCall();
        renderCalls();
        const answer = (await provider.complete({
          system: SYSTEM_PROMPT,
          prompt: "Begrüße die Heldengruppe in einem Satz zu ihrem ersten Abenteuer.",
          schema: { type: "OBJECT", properties: { narration: { type: "STRING" } }, required: ["narration"] },
          maxTokens: 512,
        })) as { narration?: string };
        const secs = ((performance.now() - started) / 1000).toFixed(1).replace(".", ",");
        status.textContent = `✅ Verbindung klappt. ${s.models[p]} antwortet in ${secs} s: „${answer.narration ?? "…"}“ (${list.length} Modelle verfügbar)`;
        saveAiSettings(s);
      } catch (err) {
        const msg = err instanceof LlmError ? err.message : String(err);
        status.textContent = `❌ ${msg}`;
      } finally {
        test.disabled = false;
      }
    });

    const el = h(
      "main",
      { class: "tv-screen" },
      h("section", { class: "pick settings" }, h("h1", {}, "⚙️ Einstellungen: Wer erzählt?"), providerRow, aiPart, calls, h("div", { class: "tv-row" }, done)),
    );
    done.addEventListener("click", () => {
      pull();
      saveAiSettings(s);
      el.remove();
      resolve();
    });
    render();
    root.append(el);
  });
}
