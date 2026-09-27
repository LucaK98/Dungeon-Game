/**
 * The look back as a picture (1200×675) to save or share: story, ending, the heroes with their
 * figures and the highlights. Used on the TV and on the phones.
 */
import type { Recap } from "../shared/recap";
import { drawDoll, loadAtlas } from "./atlas";

const ICON: Record<string, string> = { sieg: "🏆", friedlich: "🕊️", bittersuess: "🥀", scheitern: "💫" };
const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";

export async function recapImage(recap: Recap): Promise<HTMLCanvasElement> {
  const W = 1200;
  const H = 675;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#241a14");
  bg.addColorStop(1, "#0c0908");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#e0a526";
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, W - 24, H - 24);

  ctx.textBaseline = "top";
  ctx.fillStyle = "#b3a58a";
  ctx.font = `600 26px ${FONT}`;
  ctx.fillText(`Couch-Dungeon · ${recap.story}`, 44, 38);
  ctx.fillStyle = "#e0a526";
  ctx.font = `800 52px ${FONT}`;
  ctx.fillText(`${ICON[recap.ending.kind] ?? "📖"} ${recap.ending.title}`, 44, 76);
  ctx.fillStyle = "#8f8574";
  ctx.font = `24px ${FONT}`;
  ctx.fillText(`${recap.heroes.length} ${recap.heroes.length === 1 ? "Held" : "Helden"} · ${recap.minutes} Minuten`, 44, 142);

  // The heroes.
  const atlas = await loadAtlas().catch(() => undefined);
  const slot = Math.min(180, (W - 88) / Math.max(1, recap.heroes.length));
  recap.heroes.forEach((h, i) => {
    const x = 44 + i * slot;
    const y = 190;
    ctx.fillStyle = "#1d1814";
    ctx.fillRect(x, y, slot - 12, 150);
    ctx.fillStyle = h.color;
    ctx.fillRect(x, y, slot - 12, 6);
    if (atlas && h.look) {
      const doll = document.createElement("canvas");
      drawDoll(doll, atlas, h.look, 3);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(doll, x + (slot - 12) / 2 - 48, y + 12);
    }
    ctx.fillStyle = "#f3e9d2";
    ctx.font = `700 22px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(h.name.slice(0, 14), x + (slot - 12) / 2, y + 112);
    ctx.textAlign = "left";
  });

  // Highlights.
  ctx.font = `700 28px ${FONT}`;
  ctx.fillStyle = "#e0a526";
  ctx.fillText("🌟 Highlights", 44, 366);
  const byId = new Map(recap.heroes.map((h) => [h.id, h]));
  recap.highlights.slice(0, 6).forEach((hl, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 44 + col * 560;
    const y = 414 + row * 62;
    const hero = byId.get(hl.heroId);
    ctx.font = `30px ${FONT}`;
    ctx.fillStyle = "#fff";
    ctx.fillText(hl.icon, x, y);
    ctx.font = `700 22px ${FONT}`;
    ctx.fillStyle = hero?.color ?? "#f3e9d2";
    ctx.fillText(`${hl.title}: ${hero?.name ?? ""}`, x + 46, y);
    ctx.font = `20px ${FONT}`;
    ctx.fillStyle = "#cfc4ae";
    ctx.fillText(hl.text, x + 46, y + 28);
  });
  if (recap.bestIdea) {
    ctx.font = `italic 20px ${FONT}`;
    ctx.fillStyle = "#b3a58a";
    const text = `Beste Idee: „${recap.bestIdea}“`;
    ctx.fillText(text.length > 100 ? `${text.slice(0, 98)}…“` : text, 44, H - 58);
  }
  return c;
}

/** Saves the picture (or shares it on phones that can). */
export async function shareRecap(recap: Recap): Promise<"shared" | "saved"> {
  const canvas = await recapImage(recap);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) return "saved";
  const file = new File([blob], "couch-dungeon-rueckblick.png", { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: `Couch-Dungeon: ${recap.story}` });
      return "shared";
    } catch {
      // cancelled: fall back to saving
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return "saved";
}
