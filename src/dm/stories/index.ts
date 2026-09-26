import type { Story } from "../../shared/story";
import drachenfels from "./drachenfels.json";

/** All playable stories, in menu order. */
export const STORIES: Story[] = [drachenfels as unknown as Story];

export function getStory(id: string): Story | undefined {
  return STORIES.find((s) => s.id === id);
}
