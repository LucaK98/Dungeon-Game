/**
 * Natural voices that run in the browser: Piper (neural text-to-speech, https://github.com/rhasspy/piper).
 * Free, no account, no limits. The voice models are downloaded once from Hugging Face and kept in
 * the browser cache; the speech engine (onnxruntime-web) and the German pronunciation
 * (piper-phonemize / espeak-ng) are loaded from jsDelivr when first needed – nothing of it is
 * bundled with the game.
 *
 * If anything fails (offline, old browser), the caller falls back to the browser's own voice.
 */
import { MODELS, type NeuralVoice } from "./cast";

/** Where everything comes from (tests point these at local copies). */
export const PIPER = {
  modelBase: "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/",
  ortBase: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/",
  phonemizeJs: "https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/dist/piper-o91UDS6e.js",
  phonemizeWasm: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm",
  phonemizeData: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data",
};
const CACHE = "couch-dungeon-voices-v1";

interface ModelConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  speaker_id_map?: Record<string, number>;
}

/* Minimal shapes of the loaded libraries. */
interface OrtTensor {
  data: Float32Array;
}
interface Ort {
  env: { wasm: { wasmPaths?: string; numThreads?: number } };
  Tensor: new (type: string, data: unknown, dims?: number[]) => OrtTensor;
  InferenceSession: { create(model: ArrayBuffer, opts: unknown): Promise<{ run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>> }> };
}
type Phonemize = (opts: Record<string, unknown>) => Promise<{ callMain(args: string[]): void }>;

type Progress = (loaded: number, total: number) => void;

let ort: Promise<Ort> | undefined;
let phonemizer: Promise<Phonemize> | undefined;
const models = new Map<string, Promise<{ config: ModelConfig; session: Awaited<ReturnType<Ort["InferenceSession"]["create"]>> }>>();

const load = (url: string) => import(/* @vite-ignore */ url);

function getOrt(): Promise<Ort> {
  ort ??= load(`${PIPER.ortBase}esm/ort.wasm.min.js`).then((m: { default?: Ort } & Ort) => {
    const o = (m.default ?? m) as Ort;
    o.env.wasm.wasmPaths = PIPER.ortBase;
    // GitHub Pages is not "cross-origin isolated": no threads.
    o.env.wasm.numThreads = 1;
    return o;
  });
  // Failed (offline?): try again next time.
  ort.catch(() => (ort = undefined));
  return ort;
}

function getPhonemizer(): Promise<Phonemize> {
  phonemizer ??= load(PIPER.phonemizeJs).then((m: { createPiperPhonemize: Phonemize }) => m.createPiperPhonemize);
  phonemizer.catch(() => (phonemizer = undefined));
  return phonemizer;
}

/** Fetches a file, keeping it in the browser cache for next time. */
async function cachedFetch(url: string, progress?: Progress): Promise<Response> {
  const cache = "caches" in window ? await caches.open(CACHE).catch(() => undefined) : undefined;
  const hit = await cache?.match(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: ${res.status}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    progress?.(loaded, total);
  }
  const blob = new Blob(chunks as BlobPart[]);
  const copy = new Response(blob, { headers: { "content-type": res.headers.get("content-type") ?? "application/octet-stream" } });
  await cache?.put(url, copy.clone()).catch(() => undefined);
  return copy;
}

/** Is this model already downloaded? */
export async function isCached(model: string): Promise<boolean> {
  const m = MODELS[model];
  if (!m || !("caches" in window)) return false;
  const cache = await caches.open(CACHE).catch(() => undefined);
  return !!(await cache?.match(PIPER.modelBase + m.path));
}

/** Loads (and downloads, the first time) a voice model. */
export function loadModel(model: string, progress?: Progress) {
  let p = models.get(model);
  if (!p) {
    const info = MODELS[model];
    if (!info) return Promise.reject(new Error(`unknown voice ${model}`));
    p = (async () => {
      const [o, configRes] = await Promise.all([getOrt(), cachedFetch(`${PIPER.modelBase}${info.path}.json`)]);
      const config = (await configRes.json()) as ModelConfig;
      const bytes = await (await cachedFetch(PIPER.modelBase + info.path, progress)).arrayBuffer();
      const session = await o.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
      return { config, session };
    })();
    // A failed download may be retried later.
    p.catch(() => models.delete(model));
    models.set(model, p);
  }
  return p;
}

async function phonemeIds(text: string, espeakVoice: string): Promise<number[]> {
  const create = await getPhonemizer();
  return new Promise((resolve, reject) => {
    void create({
      print: (data: string) => resolve((JSON.parse(data) as { phoneme_ids: number[] }).phoneme_ids),
      printErr: (msg: string) => reject(new Error(msg)),
      locateFile: (url: string) => (url.endsWith(".wasm") ? PIPER.phonemizeWasm : url.endsWith(".data") ? PIPER.phonemizeData : url),
    })
      .then((module) => module.callMain(["-l", espeakVoice, "--input", JSON.stringify([{ text }]), "--espeak_data", "/espeak-ng-data"]))
      .catch(reject);
  });
}

/** Speaks one sentence into raw audio samples. */
export async function synthesize(text: string, voice: NeuralVoice): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const [o, { config, session }] = await Promise.all([getOrt(), loadModel(voice.model)]);
  const ids = await phonemeIds(text, config.espeak.voice);
  const inf = config.inference;
  const feeds: Record<string, OrtTensor> = {
    input: new o.Tensor("int64", BigInt64Array.from(ids.map((i) => BigInt(i))), [1, ids.length]),
    input_lengths: new o.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new o.Tensor("float32", Float32Array.from([inf.noise_scale, inf.length_scale * voice.lengthScale, inf.noise_w]), [3]),
  };
  const speakers = config.speaker_id_map ?? {};
  if (Object.keys(speakers).length) {
    const sid = voice.speaker !== undefined ? (speakers[voice.speaker] ?? 0) : 0;
    feeds.sid = new o.Tensor("int64", BigInt64Array.from([BigInt(sid)]), [1]);
  }
  const out = await session.run(feeds);
  return { pcm: out.output!.data, sampleRate: config.audio.sample_rate };
}
