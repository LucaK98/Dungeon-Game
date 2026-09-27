/**
 * Brewing and tinkering: simple recipes from ingredients the heroes collect on the map.
 * Always allowed (even when it is someone else's turn) and it costs no action.
 */
export interface Recipe {
  id: string;
  icon: string;
  name: string;
  /** Ingredient item id → how many. */
  needs: Record<string, number>;
  gives: { itemId: string; qty: number };
  /** What it does, for the phone. */
  text: string;
}

export const RECIPES: Recipe[] = [
  { id: "heiltrank", icon: "🧪", name: "Heiltrank", needs: { heilkraut: 2 }, gives: { itemId: "potion-of-healing", qty: 1 }, text: "Heilt 2W4 + 2 Trefferpunkte" },
  { id: "staerketrank", icon: "🐻", name: "Bärenkraft-Trank", needs: { pilz: 1, heilkraut: 1 }, gives: { itemId: "staerketrank", qty: 1 }, text: "Trinken: dein nächster Angriff hat Vorteil" },
  { id: "leuchttrank", icon: "✨", name: "Leuchttrank", needs: { leuchtpilz: 1, heilkraut: 1 }, gives: { itemId: "leuchttrank", qty: 1 }, text: "Trinken: du leuchtest wie eine Fackel" },
  { id: "brandflasche", icon: "🔥", name: "Brandflasche", needs: { oelflasche: 1, spinnenseide: 1 }, gives: { itemId: "brandflasche", qty: 1 }, text: "Werfen: 2W6 Feuer, der Boden brennt" },
  { id: "stolperdraht", icon: "🪢", name: "Stolperdraht", needs: { spinnenseide: 2 }, gives: { itemId: "stolperdraht", qty: 1 }, text: "Aufstellen: Gegner stolpern und fallen hin" },
];

/** Items that only exist to be brewed with (shown as ingredients). */
export const INGREDIENTS = ["heilkraut", "pilz", "leuchtpilz", "knochen", "spinnenseide", "oelflasche"];

export function recipeById(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}

export function canCraft(recipe: Recipe, inventory: { itemId: string; qty: number }[]): boolean {
  return Object.entries(recipe.needs).every(([id, n]) => (inventory.find((i) => i.itemId === id)?.qty ?? 0) >= n);
}

/** Takes the ingredients and adds the result. Returns false if something is missing. */
export function craft(recipe: Recipe, inventory: { itemId: string; qty: number }[]): boolean {
  if (!canCraft(recipe, inventory)) return false;
  for (const [id, n] of Object.entries(recipe.needs)) inventory.find((i) => i.itemId === id)!.qty -= n;
  const have = inventory.find((i) => i.itemId === recipe.gives.itemId);
  if (have) have.qty += recipe.gives.qty;
  else inventory.push({ ...recipe.gives });
  // Empty stacks disappear.
  for (let k = inventory.length - 1; k >= 0; k--) if (inventory[k]!.qty <= 0 && inventory[k]!.itemId !== "gold") inventory.splice(k, 1);
  return true;
}
