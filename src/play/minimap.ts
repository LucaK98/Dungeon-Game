/**
 * The small map on the phone: shows the surroundings, highlights reachable squares, tap to walk.
 */
import { dollFrames } from "../shared/doll";
import type { GridPos } from "../shared/game";
import type { MiniMap } from "../shared/view";
import { drawFrame, loadAtlas } from "../ui/atlas";
import { h } from "../ui/dom";

const TILE = 32;

export function minimapView(map: MiniMap, onTap: (p: GridPos) => void): HTMLElement {
  const canvas = h("canvas", { class: "minimap", width: map.w * TILE, height: map.h * TILE, dataset: { help: "minikarte" } });
  const reachable = new Set(map.reachable.map((p) => `${p.x},${p.y}`));
  void loadAtlas().then((atlas) => {
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    map.frames.forEach((frame, i) => {
      if (!frame) return;
      const x = (i % map.w) * TILE;
      const y = Math.floor(i / map.w) * TILE;
      drawFrame(ctx, atlas, frame, x, y, 1);
      const overlay = map.overlays[i];
      if (overlay) drawFrame(ctx, atlas, overlay, x, y, 1);
    });
    for (const o of map.objects) drawFrame(ctx, atlas, o.frame, (o.x - map.x0) * TILE, (o.y - map.y0) * TILE, 1);
    // Night: darkness outside the light, dim within the own darkvision.
    if (map.light) {
      for (let i = 0; i < map.light.length; i++) {
        const level = map.light[i];
        if (level === "0" || !map.frames[i]) continue;
        ctx.fillStyle = level === "1" ? "rgba(10, 12, 25, 0.5)" : "rgba(0, 0, 0, 0.9)";
        ctx.fillRect((i % map.w) * TILE, Math.floor(i / map.w) * TILE, TILE, TILE);
      }
    }
    // Reachable squares: bright with a frame.
    for (const p of map.reachable) {
      const x = (p.x - map.x0) * TILE;
      const y = (p.y - map.y0) * TILE;
      ctx.fillStyle = "rgba(255, 235, 150, 0.28)";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = "rgba(255, 235, 150, 0.7)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
    }
    for (const c of map.creatures) {
      const x = (c.x - map.x0) * TILE;
      const y = (c.y - map.y0) * TILE;
      ctx.save();
      ctx.lineWidth = c.me ? 3 : 2;
      ctx.strokeStyle = c.enemy ? "#ff4040" : (c.color ?? "#fff");
      ctx.beginPath();
      ctx.ellipse(x + 16, y + 27, 13, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (c.down) ctx.globalAlpha = 0.5;
      if (c.look) for (const f of dollFrames(c.look)) drawFrame(ctx, atlas, f, x, y, 1);
      else if (c.monsterId) drawFrame(ctx, atlas, `monster.${c.monsterId}`, x, y, 1);
      ctx.globalAlpha = 1;
      if (c.enemy && c.health < 1) {
        ctx.fillStyle = "#000";
        ctx.fillRect(x + 4, y + 1, 24, 4);
        ctx.fillStyle = c.health > 0.5 ? "#5bd15b" : c.health > 0.25 ? "#e0c040" : "#e04040";
        ctx.fillRect(x + 5, y + 2, 22 * c.health, 2);
      }
    }
  });
  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * map.w) + map.x0;
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * map.h) + map.y0;
    if (reachable.has(`${x},${y}`)) onTap({ x, y });
  });
  return canvas;
}
