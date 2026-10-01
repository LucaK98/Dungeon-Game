/**
 * TV settings: who tells the story (script or AI), the API key and the model.
 * The key is stored only in this device's localStorage. It is never sent to the phones
 * and never ends up in the repo. No format check: Gemini keys may start with "AQ." too.
 */
import { SYSTEM_PROMPT } from "../dm/ai/prompt";
import { GeminiProvider, GroqProvider, LlmError, ServerProvider, type ProviderId } from "../dm/ai/provider";
import { aiUsageToday, BUDGET_CALLS, budgetState, countAiCall, countAiUsage, loadAiBudget, loadAiSettings, providersFrom, saveAiBudget, saveAiSettings, type AiBudget, type AiSettings } from "../dm/ai/settings";
import { h } from "../ui/dom";
import { loadCrude, loadGraphicsMode, loadLookMode, loadTempo, saveCrude, saveGraphicsMode, saveLookMode, saveTempo, type GraphicsMode, type LookMode, type Tempo } from "./render";
import { prepareVoice, setSpeechRate, setVoiceEngine, speak, speechRate, stopSpeaking, storytellerProblem, voiceEngine, type VoiceEngine } from "./speech";

const VOICES: { id: VoiceEngine; label: string; detail: string }[] = [
  { id: "natural", label: "✨ Natürliche Stimmen (Standard)", detail: "Kostenlos, jede Figur klingt anders. Lädt einmalig ca. 200 MB (danach offline)." },
  { id: "storyteller", label: "📖 Erzähler (Gemini)", detail: "Klingt wie ein echter Märchenerzähler – Figuren mit eigenen Stimmen. Braucht einen eigenen Gemini-Schlüssel und Internet; beim Gratis-Limit springt kurz die natürliche Stimme ein." },
  { id: "browser", label: "🌐 Browser-Stimme", detail: "Sofort da. Am natürlichsten in Microsoft Edge („Natural“-Stimmen) oder Chrome." },
];

const GRAPHICS: { id: GraphicsMode; label: string }[] = [
  { id: "hd", label: "✨ HD (glatte Kanten)" },
  { id: "pixel", label: "👾 Pixel (klassisch)" },
];

const RATES: { rate: number; label: string }[] = [
  { rate: 1, label: "🐢 Langsam" },
  { rate: 1.2, label: "Normal" },
  { rate: 1.35, label: "Zügig" },
  { rate: 1.5, label: "🐇 Schnell" },
];

const LOOKS: { id: LookMode; label: string }[] = [
  { id: "stimmung", label: "🕯️ Stimmungsvoll (Licht, Schatten, Details)" },
  { id: "klassisch", label: "🗺️ Klassisch (hell, schont schwache Geräte)" },
];

/** Three choices: the server AI (standard), an own key, or only the script. */
type Mode = "server" | "own" | "off";
const MODES: { id: Mode; label: string; detail: string }[] = [
  { id: "server", label: "🌐 Server-KI (Standard)", detail: "Läuft einfach: Kein Schlüssel auf diesem Gerät nötig. Die KI erzählt frei und reagiert auf eure Ideen." },
  { id: "own", label: "🔑 Eigener API-Schlüssel", detail: "Mit deinem eigenen Gemini- oder Groq-Schlüssel (Gratis-Stufen: aistudio.google.com, console.groq.com)." },
  { id: "off", label: "📜 Nur Drehbuch", detail: "Ohne KI. Der Erzähler folgt der Geschichte, freie Aktionen versteht er nur bei Stichworten." },
];
const OWN: { id: Exclude<ProviderId, "server">; label: string }[] = [
  { id: "gemini", label: "🧠 Gemini (Google)" },
  { id: "groq", label: "⚡ Groq" },
];
const modeOf = (p: AiSettings["provider"]): Mode => (p === "gemini" || p === "groq" ? "own" : p);

export function settingsScreen(root: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const s = loadAiSettings();
    const status = h("p", { class: "settings-status" });
    const calls = h("p", { class: "muted" });
    const num = (n: number) => n.toLocaleString("de-DE");
    const renderCalls = () => {
      const u = aiUsageToday();
      const tokens = u.input + u.output;
      const brake = budgetState();
      calls.textContent =
        `KI heute: ${u.count} Aufrufe${tokens ? ` · ${num(tokens)} Tokens (${num(u.input)} gesendet${u.cached ? `, davon ${num(u.cached)} günstiger aus dem Zwischenspeicher` : ""}, ${num(u.output)} Antwort)` : ""}` +
        (brake === "important" ? " · 🟡 Sparmodus: nur noch wichtige Momente" : brake === "none" ? " · 🔴 Tagesbudget aufgebraucht: das Drehbuch erzählt" : "");
    };
    renderCalls();
    // The saving brake: AI calls per day on this TV.
    const budgetRow = h("div", { class: "tv-row" });
    const renderBudget = () => {
      const now = loadAiBudget();
      budgetRow.replaceChildren(
        ...([
          ["small", `🪙 Sparsam (${BUDGET_CALLS.small})`],
          ["medium", `💰 Normal (${BUDGET_CALLS.medium})`],
          ["large", `💎 Großzügig (${BUDGET_CALLS.large})`],
          ["open", "♾️ Ohne Grenze"],
        ] as const).map(([value, label]) => {
          const b = h("button", { class: `tv-btn${now === value ? " primary" : ""}`, type: "button", textContent: label });
          b.addEventListener("click", () => {
            saveAiBudget(value as AiBudget);
            renderBudget();
            renderCalls();
          });
          return b;
        }),
      );
    };
    renderBudget();

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
    const ownRow = h("div", { class: "tv-row" });
    const aiPart = h(
      "div",
      { class: "settings-ai" },
      h("label", {}, "Anbieter", ownRow),
      h("label", {}, "Schlüssel", h("div", { class: "tv-row" }, keyInput, showKey)),
      h("label", {}, "Modell", modelInput),
      h("label", {}, "Ausweich-Modell (wenn das Gratis-Limit erreicht ist)", fallbackInput),
      models,
      h("div", { class: "tv-row" }, test, clearKey),
      h("p", { class: "settings-warn" }, "🔒 Nur auf eigenen Geräten verwenden. Der Schlüssel bleibt nur auf diesem Gerät gespeichert und wird nie an die Handys geschickt."),
    );

    // The key field shows the key of the chosen provider (the server needs none).
    const current = (): Exclude<ProviderId, "server"> | undefined => (s.provider === "off" || s.provider === "server" ? undefined : s.provider);
    // An old backup key (from earlier versions) keeps working until it is removed here.
    const dropBackup = h("button", { class: "tv-btn small", type: "button", textContent: "🗑 Alten Ausweich-Schlüssel entfernen" });
    dropBackup.addEventListener("click", () => {
      delete s.backupKey;
      saveAiSettings(s);
      dropBackup.remove();
      status.textContent = "Ausweich-Schlüssel entfernt.";
    });
    const serverPart = h(
      "div",
      { class: "settings-ai" },
      h("div", { class: "tv-row" }, h("button", { class: "tv-btn", type: "button", textContent: "🔌 Server testen", onclick: () => void testServer() }), ...(s.backupKey ? [dropBackup] : [])),
    );
    const testServer = async () => {
      status.textContent = "Teste den Server …";
      const provider = providersFrom({ ...s, provider: "server" }, "TEST")![0] as ServerProvider;
      try {
        if (!(await provider.ping())) {
          status.textContent = "❌ Der Server ist erreichbar, aber dort ist noch kein GEMINI_API_KEY hinterlegt.";
          return;
        }
        const started = performance.now();
        countAiCall();
        renderCalls();
        const answer = (await provider.complete({
          system: SYSTEM_PROMPT,
          prompt: "Begrüße die Heldengruppe in einem Satz zu ihrem ersten Abenteuer.",
          schema: { type: "OBJECT", properties: { narration: { type: "STRING" } }, required: ["narration"] },
          maxTokens: 512,
        })) as { narration?: string };
        if (provider.lastUsage) countAiUsage(provider.lastUsage);
        const secs = ((performance.now() - started) / 1000).toFixed(1).replace(".", ",");
        status.textContent = `✅ Server-KI antwortet in ${secs} s: „${answer.narration ?? "…"}“`;
        saveAiSettings(s);
      } catch (err) {
        status.textContent = `❌ ${err instanceof LlmError ? err.message : String(err)}`;
      }
    };
    const pull = () => {
      const p = current();
      if (!p) return;
      const key = keyInput.value.trim();
      if (key) s.keys[p] = key;
      else delete s.keys[p];
      if (modelInput.value.trim()) s.models[p] = modelInput.value.trim();
      s.fallbackModels[p] = fallbackInput.value.trim();
    };
    /** The own provider last used (the one with a key, else Gemini). */
    let ownChoice: Exclude<ProviderId, "server"> = s.provider === "groq" || (!s.keys.gemini && s.keys.groq) ? "groq" : "gemini";
    const render = () => {
      providerRow.replaceChildren(
        ...MODES.map((m) => {
          const b = h("button", { class: `story-card provider${modeOf(s.provider) === m.id ? " selected" : ""}`, type: "button" }, h("h2", {}, m.label), h("p", {}, m.detail));
          b.addEventListener("click", () => {
            pull();
            s.provider = m.id === "own" ? ownChoice : m.id;
            // The choice counts at once (the game uses what is saved).
            saveAiSettings(s);
            status.textContent = "";
            render();
          });
          return b;
        }),
      );
      ownRow.replaceChildren(
        ...OWN.map((o) => {
          const b = h("button", { class: `tv-btn small${s.provider === o.id ? " primary" : ""}`, type: "button", textContent: o.label });
          b.addEventListener("click", () => {
            pull();
            ownChoice = o.id;
            s.provider = o.id;
            saveAiSettings(s);
            render();
          });
          return b;
        }),
      );
      const p = current();
      aiPart.hidden = !p;
      serverPart.hidden = s.provider !== "server";
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
        if (provider.lastUsage) countAiUsage(provider.lastUsage);
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

    const graphicsRow = h("div", { class: "tv-row" });
    const renderGraphics = () => {
      const mode = loadGraphicsMode();
      graphicsRow.replaceChildren(
        ...GRAPHICS.map((g) => {
          const b = h("button", { class: `tv-btn${mode === g.id ? " primary" : ""}`, type: "button", textContent: g.label });
          b.addEventListener("click", () => {
            saveGraphicsMode(g.id);
            renderGraphics();
          });
          return b;
        }),
      );
    };
    renderGraphics();

    const lookRow = h("div", { class: "tv-row" });
    const renderLook = () => {
      const mode = loadLookMode();
      lookRow.replaceChildren(
        ...LOOKS.map((g) => {
          const b = h("button", { class: `tv-btn${mode === g.id ? " primary" : ""}`, type: "button", textContent: g.label });
          b.addEventListener("click", () => {
            saveLookMode(g.id);
            renderLook();
          });
          return b;
        }),
      );
    };
    renderLook();

    const crudeRow = h("div", { class: "tv-row" });
    const renderCrude = () => {
      const on = loadCrude();
      crudeRow.replaceChildren(
        ...([
          [true, "🤬 Derbe Sprache (Gegner fluchen)"],
          [false, "😇 Jugendfrei (Gegner sind nur frech)"],
        ] as const).map(([value, label]) => {
          const b = h("button", { class: `tv-btn${on === value ? " primary" : ""}`, type: "button", textContent: label });
          b.addEventListener("click", () => {
            saveCrude(value);
            renderCrude();
          });
          return b;
        }),
      );
    };
    renderCrude();

    const tempoRow = h("div", { class: "tv-row" });
    const renderTempo = () => {
      const now = loadTempo();
      tempoRow.replaceChildren(
        ...([
          ["slow", "🐢 Gemütlich"],
          ["normal", "🚶 Normal"],
          ["fast", "🏃 Zügig"],
        ] as const).map(([value, label]) => {
          const b = h("button", { class: `tv-btn${now === value ? " primary" : ""}`, type: "button", textContent: label });
          b.addEventListener("click", () => {
            saveTempo(value as Tempo);
            renderTempo();
          });
          return b;
        }),
      );
    };
    renderTempo();

    const voiceRow = h("div", { class: "tv-row" });
    const voiceStatus = h("p", { class: "muted" });
    // The storyteller needs a Gemini key on this TV (also when the AI runs on the server).
    const ttsKey = h("input", { class: "settings-input", type: "password", autocomplete: "off", spellcheck: false, placeholder: "Gemini-Schlüssel für die Erzählerstimme" }) as HTMLInputElement;
    const ttsKeyRow = h("label", {}, "Gemini-Schlüssel (nur auf diesem Gerät gespeichert)", ttsKey);
    ttsKey.addEventListener("change", () => {
      const k = ttsKey.value.trim();
      if (k) s.keys.gemini = k;
      saveAiSettings(s);
      renderVoices();
    });
    const renderVoices = () => {
      const engine = voiceEngine();
      ttsKey.value = s.keys.gemini ?? "";
      ttsKeyRow.hidden = engine !== "storyteller" || !!s.keys.gemini;
      voiceRow.replaceChildren(
        ...VOICES.map((v) => {
          const b = h("button", { class: `tv-btn${engine === v.id ? " primary" : ""}`, type: "button", textContent: v.label, title: v.detail });
          b.addEventListener("click", () => {
            setVoiceEngine(v.id);
            renderVoices();
          });
          return b;
        }),
        h("button", { class: "tv-btn small", type: "button", textContent: "🔊 Stimmen testen", onclick: () => void testVoices() }),
      );
      voiceStatus.textContent = VOICES.find((v) => v.id === engine)!.detail;
    };
    const testVoices = async () => {
      if (voiceEngine() === "natural") {
        // Download first (with progress), so the test sounds like the game.
        let ok = true;
        for (const [who, label] of [[undefined, "Erzähler"], ["Wirtin Hilde", "Frauenstimme"], ["Schmied Hagen", "Männerstimme"]] as const) {
          ok = await prepareVoice(who, (loaded, total) => {
            voiceStatus.textContent = `⏬ Lade ${label}: ${total ? `${Math.round((loaded / total) * 100)} %` : `${Math.round(loaded / 1e6)} MB`}`;
          });
          if (!ok) break;
        }
        voiceStatus.textContent = ok ? "✅ Alle Stimmen geladen." : "❌ Die natürlichen Stimmen konnten nicht geladen werden (Internet?). Es spricht die Browser-Stimme.";
      }
      if (voiceEngine() === "storyteller") voiceStatus.textContent = "⏳ Der Erzähler räuspert sich …";
      await speak("Willkommen, Helden! Heute Nacht beginnt euer Abenteuer.");
      if (voiceEngine() === "storyteller") voiceStatus.textContent = storytellerProblem ? `⚠️ ${storytellerProblem}` : "✅ Der Erzähler ist bereit.";
      await speak("Ein Krug Met für die müden Wanderer? Setzt euch!", "Wirtin Hilde");
      await speak("Ich schmiede euch die besten Klingen im ganzen Land.", "Schmied Hagen");
      await speak("Wer wagt es, meine Höhle zu betreten?", "Oger");
    };
    renderVoices();

    // Speaking tempo (all voices; also how long a line stays on the TV).
    const rateRow = h("div", { class: "tv-row" });
    const renderRate = () => {
      const now = speechRate();
      rateRow.replaceChildren(
        ...RATES.map((r) => {
          const b = h("button", { class: `tv-btn${Math.abs(now - r.rate) < 0.01 ? " primary" : ""}`, type: "button", textContent: r.label });
          b.addEventListener("click", () => {
            setSpeechRate(r.rate);
            renderRate();
            stopSpeaking();
            void speak("So schnell erzähle ich euch die Geschichte.");
          });
          return b;
        }),
      );
    };
    renderRate();

    const el = h(
      "main",
      { class: "tv-screen" },
      h("section", { class: "pick settings" }, h("h1", {}, "⚙️ Einstellungen: Wer erzählt?"), providerRow, serverPart, aiPart, status, calls, h("p", { class: "muted" }, "KI-Aufrufe pro Tag (ab 80 % nur noch wichtige Momente, danach erzählt das Drehbuch):"), budgetRow, h("h2", {}, "🗣️ Stimmen"), voiceRow, ttsKeyRow, voiceStatus, h("p", { class: "muted" }, "Sprechtempo (antippen zum Anhören):"), rateRow, h("h2", {}, "🖼 Grafik"), graphicsRow, h("p", { class: "muted" }, "Aussehen des Spielbretts (gilt ab der nächsten Karte):"), lookRow, h("h2", {}, "⏱️ Spieltempo"), h("p", { class: "muted" }, "Wie lange das Spiel zwischen den Zügen wartet (Gemütlich ist gut für Einsteiger):"), tempoRow, h("h2", {}, "💬 Sprüche der Gegner"), crudeRow, h("div", { class: "tv-row" }, done)),
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
