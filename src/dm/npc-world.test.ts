import { describe, expect, it } from "vitest";
import { BIRTH_AFTER, childrenOf, familyAfterAdventure, familyFarewell, familyView, nameChild, setChildWish, setSquire, squireOf, stageOf, TEEN_AT, holdWeddings, partnerOf, proposalAnswer, PROPOSE_BOND, PROPOSE_LOVE, attractedTo, bondLabel, bondOf, canDate, changeBond, changeLove, emptyWorld, flirtDc, flirtLine, flirtResult, genderOf, giftValue, greetingFor, loveLabel, loveOf, markDate, meet, mindPrompt, personaFor, remember, MAX_FACTS } from "./npc-world";

describe("npc world", () => {
  it("gives every character one personality for good (same name, same person)", () => {
    const a = personaFor("Gräfin Irmgard", "noble");
    const b = personaFor("Gräfin Irmgard", "noble");
    expect(a).toEqual(b);
    expect(a.gender).toBe("female");
    expect(a.traits).toHaveLength(3);
    expect(new Set(a.traits).size).toBe(3);
    expect(personaFor("Wirt Bartholomäus", "commoner")).not.toEqual(a);
  });

  it("tells women and men apart by title and name", () => {
    expect(genderOf("Müllerin Gerda")).toBe("female");
    expect(genderOf("Förster Ruprecht")).toBe("male");
    expect(genderOf("Wirt Bartholomäus")).toBe("male");
    expect(genderOf("Merlin der Weise")).toBe("male");
    expect(genderOf("Frau Holle")).toBe("female");
  });

  it("makes some people open to romance – mostly for the other sex, some for their own, some not at all", () => {
    const names = Array.from({ length: 400 }, (_, i) => `Bürger ${i}`);
    const personas = names.map((n) => personaFor(n, "commoner"));
    const closed = personas.filter((p) => !p.romance.open).length;
    const same = personas.filter((p) => p.romance.likes.includes(p.gender)).length;
    const other = personas.filter((p) => p.romance.likes.some((g) => g !== p.gender)).length;
    expect(closed).toBeGreaterThan(40);
    expect(same).toBeGreaterThan(10);
    expect(same).toBeLessThan(other / 2);
    // Wolves and skeletons never.
    expect(personaFor("Grauer Wolf", "wolf").romance.open).toBe(false);
  });

  it("remembers heroes across adventures and greets them again", () => {
    const world = emptyWorld();
    const first = meet(world, "Gräfin Irmgard", "noble", "abenteuer-1", 1);
    expect(first.returning).toBe(false);
    changeBond(first.mind, "Brunhild", 4);
    remember(first.mind, "Brunhild hat den Wolf von meinem Hof gejagt.");
    // Same adventure again: not "returning".
    expect(meet(world, "gräfin  irmgard", "noble", "abenteuer-1", 2).returning).toBe(false);
    const again = meet(world, "Gräfin Irmgard", "noble", "abenteuer-2", 3);
    expect(again.returning).toBe(true);
    expect(again.mind).toBe(first.mind);
    const hello = greetingFor(again.mind, ["Pip", "Brunhild"]);
    expect(hello).toContain("Brunhild");
    expect(hello).toContain("Wolf");
    expect(mindPrompt(again.mind, ["Brunhild", "Pip"])).toMatch(/Brunhild \+4 \(freundlich\).*Pip \+0/);
  });

  it("keeps feelings within −10 … +10 and only the newest facts", () => {
    const { mind } = meet(emptyWorld(), "Wirt Bartholomäus", "commoner", "a", 0);
    changeBond(mind, "Pip", 30);
    expect(bondOf(mind, "Pip")).toBe(10);
    expect(bondLabel(10)).toBe("sehr vertraut");
    changeBond(mind, "Pip", -40);
    expect(bondOf(mind, "Pip")).toBe(-10);
    for (let i = 0; i < 15; i++) remember(mind, `Ereignis ${i}`);
    expect(mind.facts).toHaveLength(MAX_FACTS);
    expect(mind.facts[mind.facts.length - 1]).toBe("Ereignis 14");
    remember(mind, "Ereignis 14");
    expect(mind.facts.filter((f) => f === "Ereignis 14")).toHaveLength(1);
  });
});

describe("romance with characters", () => {
  const withRomance = (open: boolean, likes: ("female" | "male")[]) => {
    const { mind } = meet(emptyWorld(), "Wirtin Rosa", "commoner", "a", 0);
    mind.persona.romance = { open, likes };
    return mind;
  };

  it("only works with characters who are into this hero", () => {
    expect(attractedTo(withRomance(true, ["male"]), "male")).toBe(true);
    expect(attractedTo(withRomance(true, ["male"]), "female")).toBe(false);
    expect(attractedTo(withRomance(false, []), "male")).toBe(false);
    // Not interested: no roll, no love – a friendly no.
    expect(flirtResult(withRomance(true, ["female"]), "male", { total: 30, dc: 10 })).toEqual({ outcome: "not_interested", love: 0, bond: 0 });
  });

  it("turns a good flirt into love, a clumsy one into a frown", () => {
    const mind = withRomance(true, ["male"]);
    expect(flirtResult(mind, "male", { total: 20, dc: 14 }).outcome).toBe("great");
    expect(flirtResult(mind, "male", { total: 14, dc: 14 })).toMatchObject({ outcome: "yes", love: 2 });
    expect(flirtResult(mind, "male", { total: 11, dc: 14 }).outcome).toBe("no");
    expect(flirtResult(mind, "male", { total: 5, dc: 14 })).toMatchObject({ outcome: "too_much", bond: -1 });
    // Friends are easier to win over.
    const dc = flirtDc(mind, "Pip");
    changeBond(mind, "Pip", 8);
    expect(flirtDc(mind, "Pip")).toBeLessThan(dc);
    expect(flirtLine(mind, "Pip", "great")).not.toContain("{hero}");
  });

  it("counts love from 0 to 10; in love from 5, one rendezvous per adventure", () => {
    const mind = withRomance(true, ["female"]);
    expect(loveLabel(0)).toBe("");
    changeLove(mind, "Brunhild", 4);
    expect(canDate(mind, "Brunhild", "a1")).toBe(false);
    changeLove(mind, "Brunhild", 20);
    expect(loveOf(mind, "Brunhild")).toBe(10);
    expect(loveLabel(10)).toBe("sehr verliebt");
    expect(canDate(mind, "Brunhild", "a1")).toBe(true);
    markDate(mind, "Brunhild", "a1");
    expect(canDate(mind, "Brunhild", "a1")).toBe(false);
    expect(canDate(mind, "Brunhild", "a2")).toBe(true);
    expect(mindPrompt(mind, ["Brunhild"])).toContain("Romantik: Brunhild sehr verliebt (10/10)");
  });

  it("values gifts she likes three times as much", () => {
    const mind = withRomance(true, ["male"]);
    mind.persona.likes = "Gold";
    expect(giftValue(mind, "gold", "10 Goldmünzen")).toEqual({ liked: true, bond: 3 });
    expect(giftValue(mind, "torch", "Fackel")).toEqual({ liked: false, bond: 1 });
  });
});

describe("proposals and weddings", () => {
  const couple = () => {
    const world = emptyWorld();
    const { mind } = meet(world, "Wirtin Rosa", "commoner", "a", 0);
    mind.persona.romance = { open: true, likes: ["male"] };
    return { world, mind };
  };

  it("says yes only when very much in love and fond of the hero; nobody marries twice", () => {
    const { world, mind } = couple();
    expect(proposalAnswer(world, mind, "Pip", "male")).toBe("too_soon");
    changeLove(mind, "Pip", PROPOSE_LOVE);
    changeBond(mind, "Pip", PROPOSE_BOND);
    expect(proposalAnswer(world, mind, "Pip", "female")).toBe("not_interested");
    expect(proposalAnswer(world, mind, "Pip", "male")).toBe("yes");
    mind.engaged = "Pip";
    expect(proposalAnswer(world, mind, "Ole", "male")).toBe("taken");
    // Pip is bound: another proposal elsewhere is not possible.
    const other = meet(world, "Müllerin Gerda", "commoner", "a", 0).mind;
    other.persona.romance = { open: true, likes: ["male"] };
    expect(proposalAnswer(world, other, "Pip", "male")).toBe("already_bound");
  });

  it("marries the engaged at home – if the hero came back alive", () => {
    const { world, mind } = couple();
    mind.engaged = "Pip";
    expect(holdWeddings(world, ["Brunhild"])).toEqual([]);
    expect(mind.engaged).toBe("Pip");
    expect(holdWeddings(world, ["Pip"])).toEqual([{ hero: "Pip", name: "Wirtin Rosa" }]);
    expect(mind.spouse).toBe("Pip");
    expect(mind.engaged).toBeUndefined();
    expect(partnerOf(world, "Pip")).toEqual({ mind, married: true });
    expect(mind.facts[mind.facts.length - 1]).toContain("geheiratet");
  });
});

describe("family and children", () => {
  const married = () => {
    const world = emptyWorld();
    const { mind } = meet(world, "Wirtin Rosa", "commoner", "a", 0);
    mind.persona.romance = { open: true, likes: ["male"] };
    mind.spouse = "Pip";
    return { world, mind };
  };

  it("only married couples wish for a child; the night is at home, the news next time, the birth two adventures later", () => {
    const { world, mind } = married();
    expect(setChildWish(world, "Ole", true)).toBe(false);
    expect(setChildWish(world, "Pip", true)).toBe(true);
    expect(familyView(world, "Pip")).toMatchObject({ spouse: "Wirtin Rosa", wish: true });
    // The hero fell? No night.
    expect(familyAfterAdventure(structuredClone(world), [], ["Pip"]).map((e) => e.kind)).toEqual(["mourn"]);
    expect(familyAfterAdventure(world, ["Pip"], []).map((e) => e.kind)).toEqual(["night"]);
    expect(mind.expecting).toBeTruthy();
    expect(familyView(world, "Pip")!.expecting).toBeUndefined();
    const hello = familyFarewell(world, ["Pip"]);
    expect(hello.map((l) => l.text).join(" ")).toContain("Kind");
    expect(familyView(world, "Pip")!.expecting).toBe(true);
    expect(familyFarewell(world, ["Pip"])).toEqual([]);
    for (let i = 1; i < BIRTH_AFTER; i++) expect(familyAfterAdventure(world, ["Pip"], [])).toEqual([]);
    const born = familyAfterAdventure(world, ["Pip"], []);
    expect(born.map((e) => e.kind)).toEqual(["birth"]);
    const kid = mind.children![0]!;
    expect(kid.hero).toBe("Pip");
    expect(kid.traits).toHaveLength(2);
    expect(mind.persona.traits).toContain(kid.traits[0]);
    expect(stageOf(kid, world.clock!)).toBe("baby");
  });

  it("lets the hero name a child once, and a teenager go along as squire", () => {
    const { world, mind } = married();
    world.clock = 10;
    mind.children = [{ name: "Liese", gender: "female", hero: "Pip", born: 9, traits: ["stolz", "mutig"], visits: 0 }];
    expect(nameChild(world, "Pip", 0, "<b>")).toBe(false);
    expect(nameChild(world, "Pip", 0, "Brunhilde")).toBe(true);
    expect(nameChild(world, "Pip", 0, "Anders")).toBe(false);
    expect(childrenOf(world, "Pip")[0]!.child.name).toBe("Brunhilde");
    expect(setSquire(world, "Pip", 0, true)).toBe(false);
    mind.children[0]!.born = 10 - TEEN_AT;
    expect(setSquire(world, "Pip", 0, true)).toBe(true);
    expect(squireOf(world, "Pip")?.name).toBe("Brunhilde");
    expect(familyView(world, "Pip")!.children![0]).toMatchObject({ stage: "Jugendlich", squire: true, named: true });
  });

  it("children remember visits and grow; a fallen hero is mourned, the children stay", () => {
    const { world, mind } = married();
    world.clock = 0;
    mind.children = [{ name: "Fritz", gender: "male", hero: "Pip", born: 0, traits: ["stolz", "mutig"], visits: 0 }];
    familyFarewell(world, ["Pip"]);
    familyFarewell(world, ["Pip", "Ole"]);
    expect(mind.children[0]!.visits).toBe(2);
    familyFarewell(world, ["Ole"]);
    expect(mind.children[0]!.visits).toBe(2);
    const grown = [1, 2, 3].flatMap(() => familyAfterAdventure(world, ["Pip"], []));
    expect(grown).toEqual([expect.objectContaining({ kind: "grown", stage: "kind" })]);
    familyAfterAdventure(world, [], ["Pip"]);
    expect(mind.spouse).toBeUndefined();
    expect(mind.widowOf).toBe("Pip");
    expect(mind.children).toHaveLength(1);
    expect(mind.facts.join(" ")).toContain("nicht heimgekehrt");
    // Mourning, she may love again one day.
    expect(proposalAnswer(world, mind, "Ole", "male")).toBe("too_soon");
  });
});
