import type { Story } from "../../shared/story";
import drachenfels from "./drachenfels.json";
import rattenfaenger from "./rattenfaenger.json";
import walpurgisnacht from "./walpurgisnacht.json";
import wurstdiebe from "./wurstdiebe.json";
import { generateStory, isRandomStoryId, RANDOM_PREFIX } from "./random";

/** All playable stories, in menu order. */
export const STORIES: Story[] = [wurstdiebe as unknown as Story, drachenfels as unknown as Story, rattenfaenger as unknown as Story, walpurgisnacht as unknown as Story];

export function getStory(id: string): Story | undefined {
  // Random adventures are rebuilt from their seed.
  if (isRandomStoryId(id)) return generateStory(Number(id.slice(RANDOM_PREFIX.length)));
  return STORIES.find((s) => s.id === id);
}
