/** Reading the narration aloud (Web Speech API, German voice, can be switched off). */
const KEY = "couch-dungeon.speech";

export function speechEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSpeechEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // ignore
  }
  if (!on) window.speechSynthesis?.cancel();
}

function germanVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  return voices.find((v) => v.lang === "de-DE" && /google|natural|premium/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith("de"));
}

/** Speaks a text; resolves when done (or right away if speech is off/unavailable). */
export function speak(text: string, npc = false): Promise<void> {
  if (!speechEnabled() || !("speechSynthesis" in window)) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text.replace(/[🔎💾⏱️⬆️⚔️📖]/gu, ""));
    u.lang = "de-DE";
    const voice = germanVoice();
    if (voice) u.voice = voice;
    u.rate = 1.02;
    u.pitch = npc ? 0.85 : 1;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
    // Some browsers never fire onend: don't block the story.
    setTimeout(resolve, 2500 + text.length * 90);
  });
}
