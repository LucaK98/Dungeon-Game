import type { DmContext } from "../shared/dm";

/** Ordinary enemies may be scared off or tricked into running – never while a boss stands. */
export function canFlee(ctx: DmContext): boolean {
  return !!ctx.combat?.enemies.length && !ctx.combat.enemies.some((e) => e.boss);
}
