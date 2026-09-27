import { describe, expect, it } from "vitest";
import { geminiSpeech, geminiVoiceFor, pcm16ToFloat, TTS_MODEL } from "./gemini-tts";

describe("storyteller voice (Gemini TTS)", () => {
  it("sends the key only in the header, asks for audio with a storyteller style, and decodes the PCM", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    // Two samples: 0x4000 (0.5) and 0xC000 (-0.5), little endian.
    const audio = btoa(String.fromCharCode(0x00, 0x40, 0x00, 0xc0));
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: audio } }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const pcm = await geminiSpeech("AQ.test-key", "Es war einmal ein Drache.", undefined, fake);
    expect(Array.from(pcm)).toEqual([0.5, -0.5]);
    expect(calls[0]!.url).toContain(`${TTS_MODEL}:generateContent`);
    expect(calls[0]!.url).not.toContain("AQ.");
    expect((calls[0]!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AQ.test-key");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(body.contents[0].parts[0].text).toContain("Märchenerzähler");
    // Cached: the same line is not asked for twice.
    await geminiSpeech("AQ.test-key", "Es war einmal ein Drache.", undefined, fake);
    expect(calls).toHaveLength(1);
  });

  it("gives monsters, women and the narrator different voices", () => {
    expect(geminiVoiceFor().voice).not.toBe(geminiVoiceFor("Oger").voice);
    expect(geminiVoiceFor("Wirtin Hilde").voice).not.toBe(geminiVoiceFor("Schmied Hagen").voice);
    expect(pcm16ToFloat(btoa(String.fromCharCode(0xff, 0x7f)))[0]).toBeCloseTo(1, 3);
  });
});
