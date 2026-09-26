import type { DungeonMap } from "../shared/map";

/** Debug view of a map: # wall, . floor, ~ water, objects by letter. */
export function mapToAscii(map: DungeonMap): string {
  const rows: string[] = [];
  for (let y = 0; y < map.height; y++) {
    let row = "";
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      const obj = map.objects.find((o) => o.x === x && o.y === y);
      const k = map.cells[i];
      row += obj ? (obj.blocking ? "o" : "*") : k === "wall" ? "#" : k === "floor" ? (map.roomOf[i] === -1 ? ":" : ".") : k === "water" ? "-" : k === "deep" ? "~" : " ";
    }
    rows.push(row);
  }
  return rows.join("\n");
}
