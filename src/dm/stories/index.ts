import type { Story } from "../../shared/story";
import drachenfels from "./drachenfels.json";
import rattenfaenger from "./rattenfaenger.json";
import walpurgisnacht from "./walpurgisnacht.json";
import wurstdiebe from "./wurstdiebe.json";

/** All playable stories, in menu order. */
export const STORIES: Story[] = [wurstdiebe as unknown as Story, drachenfels as unknown as Story, rattenfaenger as unknown as Story, walpurgisnacht as unknown as Story];

export function getStory(id: string): Story | undefined {
  return STORIES.find((s) => s.id === id);
}
