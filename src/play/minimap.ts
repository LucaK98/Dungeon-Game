/**
 * The small map on the phone: shows the surroundings, highlights reachable squares.
 * Tapping a square reports it to the controller: walk there (with a route preview first),
 * or act on what stands there (an enemy, a table, a stray dog …).
 */
import { dollFrames } from "../shared/doll";
import type { GridPos } from "../shared/game";
import type { MiniMap } from "../shared/view";
import { drawFrame, loadAtlas } from "../ui/atlas";
import { h } from "../ui/dom";

const TILE = 32;

export interface MapMarks {
  /** A planned route (drawn as dots) ending at the selected square. */
  route?: GridPos[];
  /** A square that is selected (ring). */
  selected?: GridPos;
  /** Possible targets (tap one to pick it). */
  targets?: GridPos[];
}

/**
 * Holding a finger on an element (about half a second) calls `fn` instead of the normal tap.
 * The click that follows the hold is swallowed.
 */
export function onHold(el: HTMLElement, fn: (e: PointerEvent) => void, ms = 550): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number } | undefined;
  let held = false;
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  el.addEventListener("pointerdown", (e) => {
    held = false;
    start = { x: e.clientX, y: e.clientY };
    stop();
    timer = setTimeout(() => {
      held = true;
      if ("vibrate" in navigator) navigator.vibrate(20);
      fn(e);
    }, ms);
  });
  el.addEventListener("pointermove", (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12) stop();
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) el.addEventListener(type, stop);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  el.addEventListener(
    "click",
    (e) => {
      if (!held) return;
      held = false;
      e.stopImmediatePropagation();
      e.preventDefault();
    },
    true,
  );
}

export function minimapView(map: MiniMap, onTap: (p: GridPos) => void, marks: MapMarks = {}, cls = "minimap", onLongPress?: (p: GridPos) => void): HTMLCanvasElement {
  const canvas = h("canvas", { class: cls, width: map.w * TILE, height: map.h * TILE, dataset: { help: "minikarte" } }) as HTMLCanvasElement;
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
      for (const g of map.ground?.[i]?.split("|") ?? []) if (g) drawFrame(ctx, atlas, g, x, y, 1);
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
    // Reachable squares: bright with a frame; difficult ground striped, fire red.
    for (const p of map.reachable) {
      const x = (p.x - map.x0) * TILE;
      const y = (p.y - map.y0) * TILE;
      const mark = map.marks?.[(p.y - map.y0) * map.w + (p.x - map.x0)];
      ctx.fillStyle = mark === "f" ? "rgba(255, 80, 40, 0.35)" : "rgba(255, 235, 150, 0.22)";
      ctx.fillRect(x, y, TILE, TILE);
      if (mark === "d" || mark === "i") {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, TILE, TILE);
        ctx.clip();
        ctx.strokeStyle = "rgba(255, 170, 60, 0.75)";
        ctx.lineWidth = 2;
        for (let k = -TILE; k < TILE; k += 8) {
          ctx.beginPath();
          ctx.moveTo(x + k, y + TILE);
          ctx.lineTo(x + k + TILE, y);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.strokeStyle = "rgba(255, 235, 150, 0.6)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
    }
    // High places get a small arrow.
    map.marks?.split("").forEach((m, i) => {
      if (m !== "h") return;
      const x = (i % map.w) * TILE;
      const y = Math.floor(i / map.w) * TILE;
      ctx.fillStyle = "rgba(120, 220, 255, 0.95)";
      ctx.beginPath();
      ctx.moveTo(x + 26, y + 3);
      ctx.lineTo(x + 31, y + 10);
      ctx.lineTo(x + 21, y + 10);
      ctx.fill();
    });
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
    // The planned route: dots from here to there, and a ring on the goal.
    if (marks.route?.length) {
      ctx.fillStyle = "#ffd75e";
      for (const p of marks.route.slice(0, -1)) {
        ctx.beginPath();
        ctx.arc((p.x - map.x0 + 0.5) * TILE, (p.y - map.y0 + 0.5) * TILE, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const t of marks.targets ?? []) {
      const x = (t.x - map.x0) * TILE;
      const y = (t.y - map.y0) * TILE;
      ctx.strokeStyle = "#ff5a5a";
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3);
      ctx.setLineDash([]);
    }
    if (marks.selected) {
      const x = (marks.selected.x - map.x0) * TILE;
      const y = (marks.selected.y - map.y0) * TILE;
      ctx.strokeStyle = "#ffd75e";
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
    }
  });
  const cellAt = (e: MouseEvent): GridPos => {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.floor(((e.clientX - rect.left) / rect.width) * map.w) + map.x0, y: Math.floor(((e.clientY - rect.top) / rect.height) * map.h) + map.y0 };
  };
  if (onLongPress) onHold(canvas, (e) => onLongPress(cellAt(e)));
  canvas.addEventListener("click", (e) => onTap(cellAt(e)));
  return canvas;
}

/**
 * Cheapest way to a reachable square (8 directions, difficult ground counts double),
 * worked out on the phone for the route preview. Returns the squares (without the start) and the cost.
 */
export function planRoute(map: MiniMap, to: GridPos): { path: GridPos[]; cost: number; difficult: number } | undefined {
  const me = map.creatures.find((c) => c.me);
  if (!me) return undefined;
  const key = (p: GridPos) => `${p.x},${p.y}`;
  const open = new Set(map.reachable.map(key));
  // Squares with an ally may be crossed (the TV has already checked where you may end).
  for (const c of map.creatures) if (!c.enemy && !c.me) open.add(key(c));
  if (!map.reachable.some((p) => p.x === to.x && p.y === to.y)) return undefined;
  const mark = (p: GridPos) => map.marks?.[(p.y - map.y0) * map.w + (p.x - map.x0)];
  const cost = (p: GridPos) => (mark(p) === "d" || mark(p) === "i" ? 2 : 1);
  const start = { x: me.x, y: me.y };
  const best = new Map<string, number>([[key(start), 0]]);
  const prev = new Map<string, GridPos>();
  const queue: GridPos[] = [start];
  while (queue.length) {
    queue.sort((a, b) => best.get(key(a))! - best.get(key(b))!);
    const p = queue.shift()!;
    if (p.x === to.x && p.y === to.y) break;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const q = { x: p.x + dx, y: p.y + dy };
        if (!open.has(key(q))) continue;
        const c = best.get(key(p))! + cost(q);
        if (best.has(key(q)) && best.get(key(q))! <= c) continue;
        best.set(key(q), c);
        prev.set(key(q), p);
        queue.push(q);
      }
    }
  }
  if (!best.has(key(to))) return undefined;
  const path: GridPos[] = [];
  let cur: GridPos | undefined = to;
  while (cur && key(cur) !== key(start)) {
    path.unshift(cur);
    cur = prev.get(key(cur));
  }
  return { path, cost: best.get(key(to))!, difficult: path.filter((p) => cost(p) === 2).length };
}

/** Enemies next to you now that you would walk away from (they get a free swing). */
export function provokedBy(map: MiniMap, to: GridPos): string[] {
  const me = map.creatures.find((c) => c.me);
  if (!me) return [];
  const near = (a: GridPos, b: GridPos) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;
  return map.creatures.filter((c) => c.enemy && !c.down && near(c, me) && !near(c, to)).map((c) => c.name);
}

/** A short key under the map: only for what is in sight right now. */
export function minimapLegend(map: MiniMap): HTMLElement | null {
  const m = map.marks ?? "";
  const items: [string, string, string][] = [];
  if (m.includes("d") || m.includes("i")) items.push(["▨", "Schwieriges Gelände: 2 Schritte pro Feld", "schwieriges_gelaende"]);
  if (m.includes("c")) items.push(["🛡️", "Deckung: daneben stehen = +2 RK gegen Fernangriffe", "deckung"]);
  if (m.includes("h")) items.push(["▲", "Erhöht: Vorteil beim Schießen nach unten", "erhoeht"]);
  if (m.includes("f")) items.push(["🔥", "Feuer: 1W6 Schaden, wer hineinläuft", "feuer"]);
  if (!items.length) return null;
  return h("div", { class: "map-legend" }, ...items.map(([icon, text, key]) => h("span", { class: "legend-item", dataset: { help: key } }, h("b", {}, icon), ` ${text}`)));
}
