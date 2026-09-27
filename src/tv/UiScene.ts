import Phaser from "phaser";
import { dollFrames } from "../shared/doll";
import type { Narration } from "../shared/story";
import type { OrderEntry, RollOutcome, RollPrompt } from "../shared/view";
import { speak, stopSpeaking } from "./speech";
import { BOARD_HEIGHT, BOARD_WIDTH } from "./DungeonScene";
import type { AiStatus } from "../dm/ai/aidm";
import { crisp, RES, TILES, UP } from "./render";

const FONT = "system-ui, sans-serif";

/** Screen-space overlay on top of the zoomed dungeon: room names, turn, initiative bar, roll results. */
export class UiScene extends Phaser.Scene {
  private banner!: Phaser.GameObjects.Text;
  private turnText!: Phaser.GameObjects.Text;
  private turnBox!: Phaser.GameObjects.Graphics;
  private rollBox!: Phaser.GameObjects.Container;
  private orderBar!: Phaser.GameObjects.Container;
  private chapter!: Phaser.GameObjects.Text;
  private narrationBox!: Phaser.GameObjects.Container;
  private queue: Narration[] = [];
  private telling = false;

  constructor() {
    super({ key: "ui", active: true });
  }

  // The tile atlas is loaded by the DungeonScene; the initiative bar (the only user here) appears after it is ready.

  private aiBadge: Phaser.GameObjects.Text | undefined;
  private skipLine: (() => void) | undefined;
  private asking = false;
  private tumbling: ReturnType<typeof setTimeout> | undefined;
  private tumbleFlips: Phaser.Time.TimerEvent | undefined;

  create(): void {
    // Board pixels → screen pixels.
    this.cameras.main.setOrigin(0, 0).setZoom(RES);
    this.orderBar = this.add.container(20, 150);
    this.banner = this.add
      // In the middle of the screen: at the top the dice card would cover it during fights.
      .text(BOARD_WIDTH / 2, BOARD_HEIGHT * 0.42, "", crisp({ fontFamily: FONT, fontSize: "64px", color: "#f3e9d2", stroke: "#000", strokeThickness: 12 }))
      .setOrigin(0.5)
      .setAlpha(0);
    this.turnBox = this.add.graphics();
    this.turnText = this.add.text(40, BOARD_HEIGHT - 70, "", crisp({ fontFamily: FONT, fontSize: "44px", color: "#fff", stroke: "#000", strokeThickness: 8 })).setOrigin(0, 0.5);
    this.rollBox = this.add.container(BOARD_WIDTH - 40, 40);
    this.chapter = this.add.text(24, 20, "", crisp({ fontFamily: FONT, fontSize: "26px", color: "#b3a58a", stroke: "#000", strokeThickness: 5 }));
    this.narrationBox = this.add.container(0, 0).setAlpha(0);
    this.aiBadge = this.add.text(BOARD_WIDTH - 24, BOARD_HEIGHT - 20, "", crisp({ fontFamily: FONT, fontSize: "22px", color: "#8f8574", stroke: "#000", strokeThickness: 4 })).setOrigin(1, 1);

    const onRoom = (name: string) => this.showBanner(name);
    const onTurn = (name: string, color?: string, free?: boolean) => this.showTurn(name, color, free);
    const onRoll = (r: RollOutcome, tumble = 0) => this.rollIn(r, tumble);
    const onAsked = (prompt: RollPrompt, name: string, color?: string) => this.showAsk(prompt, name, color);
    const onOrder = (entries: OrderEntry[]) => this.showOrder(entries);
    const onCombat = (started: boolean) => started && this.showBanner("⚔️ Kampf!");
    const onNarration = (lines: Narration[]) => {
      this.queue.push(...lines);
      if (!this.telling) void this.tell();
    };
    const onChapter = (text: string) => this.chapter.setText(text);
    // A short note under the chapter: the game was saved (with the code for another device).
    const saved = this.add.text(24, 58, "", crisp({ fontFamily: FONT, fontSize: "22px", color: "#8f8574", stroke: "#000", strokeThickness: 4 })).setAlpha(0);
    const onSaved = (code?: string) => {
      saved.setText(code ? `💾 Gespeichert · Code zum Weiterspielen: ${code}` : "💾 Gespeichert").setAlpha(1);
      this.tweens.killTweensOf(saved);
      this.tweens.add({ targets: saved, alpha: 0, delay: 9000, duration: 1500 });
    };
    this.game.events.on("saved", onSaved);
    const onAi = (s: AiStatus | undefined) => this.showAiStatus(s);
    this.game.events.on("ai-status", onAi);
    const onSkip = () => this.skipLine?.();
    this.input.keyboard?.on("keydown-SPACE", onSkip);
    this.input.keyboard?.on("keydown-ENTER", onSkip);
    this.game.events.on("narration", onNarration);
    this.game.events.on("chapter", onChapter);
    this.game.events.on("room-name", onRoom);
    this.game.events.on("turn", onTurn);
    this.game.events.on("roll", onRoll);
    this.game.events.on("asked", onAsked);
    this.game.events.on("order", onOrder);
    this.game.events.on("combat", onCombat);
    // Ask the board for the current state (turn) now that we can show it.
    this.game.events.emit("ui-ready");
    this.events.once("shutdown", () => {
      this.game.events.off("room-name", onRoom);
      this.game.events.off("turn", onTurn);
      this.game.events.off("roll", onRoll);
      this.game.events.off("order", onOrder);
      this.game.events.off("combat", onCombat);
      this.game.events.off("narration", onNarration);
      this.game.events.off("chapter", onChapter);
      this.game.events.off("ai-status", onAi);
      this.game.events.off("saved", onSaved);
    });
  }

  /** Small corner note: is the AI telling the story, or is it taking a break (limit/offline)? */
  private showAiStatus(s: AiStatus | undefined): void {
    if (!this.aiBadge) return;
    this.tweens.killTweensOf(this.aiBadge);
    if (!s) {
      this.aiBadge.setText("");
      return;
    }
    if (s.kind === "thinking") {
      this.aiBadge.setText("🧠 Der Spielleiter denkt nach …").setColor("#f3e9d2").setAlpha(1);
      return;
    }
    if (s.kind === "ok") {
      this.aiBadge.setText("🧠 KI-Spielleitung").setColor("#8f8574").setAlpha(0.8);
      return;
    }
    this.aiBadge.setText("☕ Der Spielleiter macht kurz Pause – das Drehbuch erzählt weiter").setColor("#e0a526").setAlpha(1);
    this.tweens.add({ targets: this.aiBadge, alpha: 0.6, delay: 8000, duration: 1000 });
  }

  /** Tells the queued narration line by line with a typewriter effect (and reads it aloud). */
  private async tell(): Promise<void> {
    this.telling = true;
    while (this.queue.length) {
      const line = this.queue.shift()!;
      await this.showLine(line);
    }
    this.telling = false;
    this.tweens.add({ targets: this.narrationBox, alpha: 0, delay: 4000, duration: 800 });
  }

  private showLine(line: Narration): Promise<void> {
    const box = this.narrationBox;
    box.removeAll(true);
    this.tweens.killTweensOf(box);
    box.setAlpha(1);
    const width = 1180;
    const x = (BOARD_WIDTH - width) / 2 + 180;
    const speaker = line.npc ? this.add.text(x + 30, 0, line.npc, crisp({ fontFamily: FONT, fontSize: "30px", color: "#e0a526", fontStyle: "bold" })) : undefined;
    const text = this.add.text(x + 30, 0, "", crisp({ fontFamily: FONT, fontSize: "34px", color: "#f3e9d2", wordWrap: { width: width - 60 }, lineSpacing: 8, fontStyle: line.npc ? "italic" : "normal" }));
    // Measure the full height first.
    text.setText(line.text);
    const tipText = line.tip ? this.add.text(x + 30, 0, `💡 ${line.tip.text}`, crisp({ fontFamily: FONT, fontSize: "26px", color: "#1b1208", wordWrap: { width: width - 90 }, lineSpacing: 6 })) : undefined;
    const bodyH = (speaker ? 42 : 0) + text.height + (tipText ? tipText.height + 40 : 0);
    const top = BOARD_HEIGHT - 150 - bodyH;
    const bg = this.add.graphics();
    bg.fillStyle(0x0d0b09, 0.9).fillRoundedRect(x, top - 20, width, bodyH + 40, 18);
    bg.lineStyle(3, 0x5a4d42, 1).strokeRoundedRect(x, top - 20, width, bodyH + 40, 18);
    box.add(bg);
    let y = top;
    if (speaker) {
      speaker.setY(y);
      box.add(speaker);
      y += 42;
    }
    text.setY(y);
    box.add(text);
    y += text.height + 20;
    if (tipText) {
      const tipBg = this.add.graphics();
      tipBg.fillStyle(0xe0a526, 1).fillRoundedRect(x + 18, y - 6, width - 36, tipText.height + 16, 12);
      tipText.setY(y + 2);
      box.add([tipBg, tipText]);
    }
    const full = text.text;
    text.setText("");
    // Catch up when lines pile up: type faster, shorter pauses, no reading aloud for a long backlog.
    const waiting = this.queue.length;
    const pace = waiting >= 4 ? 0.3 : waiting >= 2 ? 0.6 : 1;
    return new Promise((resolve) => {
      let i = 0;
      let done = false;
      const typing = this.time.addEvent({
        delay: 24,
        loop: true,
        callback: () => {
          i = Math.min(full.length, i + (pace < 1 ? 6 : 2));
          text.setText(full.slice(0, i));
          if (i >= full.length) typing.remove();
        },
      });
      const finish = () => {
        if (done) return;
        done = true;
        this.skipLine = undefined;
        typing.remove();
        text.setText(full);
        resolve();
      };
      // Space or Enter on the TV skips the current line.
      this.skipLine = () => {
        stopSpeaking();
        finish();
      };
      const minTime = new Promise<void>((r) => this.time.delayedCall((1800 + full.length * 45 + (line.tip ? 2500 : 0)) * pace, () => r()));
      const voice = waiting >= 3 ? Promise.resolve() : speak(line.text, line.npc);
      void Promise.all([minTime, voice]).then(finish);
    });
  }

  private showBanner(name: string): void {
    this.banner.setText(name).setAlpha(1);
    this.tweens.killTweensOf(this.banner);
    this.tweens.add({ targets: this.banner, alpha: 0, delay: 2500, duration: 1200 });
  }

  private showTurn(name: string, color?: string, free?: boolean): void {
    // A roll that was asked for and never thrown (the turn moved on): take the waiting die away.
    if (this.asking) this.clearRollBox();
    this.turnText.setText(free ? `🧭 ${name}` : `▶ ${name} ist dran`);
    const w = this.turnText.width + 60;
    this.turnBox.clear();
    this.turnBox.fillStyle(0x000000, 0.65).fillRoundedRect(20, BOARD_HEIGHT - 110, w, 80, 16);
    if (color) this.turnBox.fillStyle(Phaser.Display.Color.HexStringToColor(color).color, 1).fillRoundedRect(20, BOARD_HEIGHT - 110, 12, 80, 6);
  }

  /** Initiative bar on the left edge: portraits in turn order, the active one highlighted. */
  private showOrder(entries: OrderEntry[]): void {
    this.orderBar.removeAll(true);
    // Up to 6 heroes plus their foes: rows shrink so everything fits on the screen.
    const visible = entries.slice(0, 14);
    const row = Math.min(92, Math.floor((BOARD_HEIGHT - 290) / Math.max(1, visible.length)));
    const scale = row / 92;
    visible.forEach((e, i) => {
      const y = i * row;
      const bg = this.add.graphics();
      const edge = e.active ? 0xe0a526 : e.enemy ? 0x8a2a2a : e.color ? Phaser.Display.Color.HexStringToColor(e.color).color : 0x5a4d42;
      bg.fillStyle(0x14110f, e.active ? 0.95 : 0.8).fillRoundedRect(0, y, e.active ? 320 : 290, row - 6, 12);
      bg.lineStyle(e.active ? 5 : 3, edge, 1).strokeRoundedRect(0, y, e.active ? 320 : 290, row - 6, 12);
      this.orderBar.add(bg);
      const frames = e.look ? dollFrames(e.look) : e.monsterId ? [`monster.${e.monsterId}`] : [];
      for (const f of frames) this.orderBar.add(this.add.image(44, y + (row - 6) / 2, TILES, f).setScale((2 * scale) / UP));
      const name = this.add.text(88, y + 8 * scale, e.name, crisp({ fontFamily: FONT, fontSize: `${Math.round(26 * Math.max(0.75, scale))}px`, color: e.health <= 0 ? "#8d8172" : "#f3e9d2", fontStyle: e.active ? "bold" : "normal" }));
      this.orderBar.add(name);
      if (e.initiative !== undefined) this.orderBar.add(this.add.text(e.active ? 300 : 270, y + 8 * scale, String(e.initiative), crisp({ fontFamily: FONT, fontSize: `${Math.round(24 * Math.max(0.75, scale))}px`, color: "#b3a58a" })).setOrigin(1, 0));
      const hp = this.add.graphics();
      const hpY = y + row - 6 - 20 * Math.max(0.6, scale);
      hp.fillStyle(0x3a2f27, 1).fillRect(88, hpY, 180, 10);
      const pct = Math.max(0, Math.min(1, e.health));
      hp.fillStyle(pct > 0.5 ? 0x4caf50 : pct > 0.25 ? 0xe0b030 : 0xe04040, 1).fillRect(88, hpY, 180 * pct, 10);
      this.orderBar.add(hp);
    });
  }

  private clearRollBox(): void {
    this.asking = false;
    this.tweens.killTweensOf(this.rollBox.list);
    this.tweens.killTweensOf(this.rollBox);
    this.rollBox.removeAll(true);
  }

  /** A die drawn at (x, y) (its top-left), `size` wide, with a number on it. */
  private drawDie(x: number, y: number, size: number, fill: number, label: string, sides: number): { die: Phaser.GameObjects.Graphics; n: Phaser.GameObjects.Text; s: Phaser.GameObjects.Text } {
    const die = this.add.graphics();
    die.fillStyle(fill, 1).fillRoundedRect(x, y, size, size, size / 6);
    die.lineStyle(4, 0xf3e9d2, 1).strokeRoundedRect(x, y, size, size, size / 6);
    const n = this.add.text(x + size / 2, y + size * 0.43, label, crisp({ fontFamily: FONT, fontSize: `${Math.round(size * 0.57)}px`, fontStyle: "bold", color: "#fff", stroke: "#000", strokeThickness: 6 })).setOrigin(0.5);
    const s = this.add.text(x + size / 2, y + size * 0.87, `W${sides}`, crisp({ fontFamily: FONT, fontSize: `${Math.round(size / 6)}px`, color: "#f3e9d2" })).setOrigin(0.5);
    return { die, n, s };
  }

  /**
   * A hero has to roll: everybody on the sofa sees who, which die and what number it takes.
   * "Mira würfelt: Angriff auf Goblin – braucht 12 oder mehr".
   */
  private showAsk(prompt: RollPrompt, name: string, color?: string): void {
    clearTimeout(this.tumbling);
    this.tumbling = undefined;
    this.clearRollBox();
    const width = 860;
    const left = 190;
    const hex = color ? Phaser.Display.Color.HexStringToColor(color).color : 0xe0a526;
    const who = this.add.text(-width + left, 22, `🎲 ${name} würfelt`, crisp({ fontFamily: FONT, fontSize: "36px", color: color ?? "#e0a526", fontStyle: "bold", stroke: "#000", strokeThickness: 5 }));
    const title = this.add.text(-width + left, 70, prompt.title, crisp({ fontFamily: FONT, fontSize: "28px", color: "#f3e9d2", wordWrap: { width: width - left - 30 } }));
    const parts: Phaser.GameObjects.GameObject[] = [who, title];
    let y = 70 + title.height + 12;
    const need = prompt.need;
    if (need) {
      const big = need.min <= 1 ? "Klappt sicher" : need.min >= 20 ? "Braucht eine 20!" : `Braucht ${need.min} oder mehr`;
      const line = this.add.text(-width + left, y, big, crisp({ fontFamily: FONT, fontSize: "46px", color: "#ffd75e", fontStyle: "bold", stroke: "#000", strokeThickness: 7 }));
      const why = this.add.text(-width + left, y + 58, `Ziel ${need.label} ${need.target} · Bonus ${need.bonus >= 0 ? "+" : ""}${need.bonus}`, crisp({ fontFamily: FONT, fontSize: "24px", color: "#b3a58a" }));
      parts.push(line, why);
      y += 96;
    }
    const tip = this.add.text(-width + left, y + 4, "👉 Auf dem Handy tippen", crisp({ fontFamily: FONT, fontSize: "26px", color: "#8fd18f" }));
    parts.push(tip);
    const height = Math.max(200, y + 50);
    const bg = this.add.graphics();
    bg.fillStyle(0x14110f, 0.94).fillRoundedRect(-width, 0, width, height, 18);
    bg.lineStyle(6, hex, 1).strokeRoundedRect(-width, 0, width, height, 18);
    const d = this.drawDie(-width + 30, 30, 136, 0x7a2e22, "?", prompt.sides);
    // The die bobs and wiggles: it is waiting to be thrown.
    const dieBox = this.add.container(0, 0, [d.die, d.n, d.s]);
    this.rollBox.add([bg, dieBox, ...parts]);
    this.asking = true;
    this.tweens.add({ targets: dieBox, y: -8, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.tweens.add({ targets: tip, alpha: 0.35, duration: 800, yoyo: true, repeat: -1 });
    this.rollBox.setAlpha(1);
    // The card goes away by itself if the roll never comes (turn skipped, scene changed).
    this.tweens.add({ targets: this.rollBox, alpha: 0, delay: 120_000, duration: 800 });
  }

  /** The die tumbles for `tumble` ms (random faces), then lands on the result card. */
  private rollIn(r: RollOutcome, tumble: number): void {
    clearTimeout(this.tumbling);
    this.tumbling = undefined;
    if (!tumble || !r.dice.length) {
      this.showRoll(r);
      return;
    }
    this.clearRollBox();
    const width = 860;
    const bg = this.add.graphics();
    bg.fillStyle(0x14110f, 0.94).fillRoundedRect(-width, 0, width, 200, 18);
    bg.lineStyle(6, 0x5a4d42, 1).strokeRoundedRect(-width, 0, width, 200, 18);
    const title = this.add.text(-width + 190, 30, r.title, crisp({ fontFamily: FONT, fontSize: "36px", color: "#e0a526", fontStyle: "bold" }));
    const rolling = this.add.text(-width + 190, 90, "Der Würfel rollt …", crisp({ fontFamily: FONT, fontSize: "30px", color: "#f3e9d2" }));
    const d = this.drawDie(-68, -68, 136, 0x7a2e22, String(1 + Math.floor(Math.random() * r.sides)), r.sides);
    const dieBox = this.add.container(-width + 98, 98, [d.die, d.n, d.s]);
    this.rollBox.add([bg, title, rolling, dieBox]);
    this.rollBox.setAlpha(1);
    this.tweens.add({ targets: dieBox, angle: 720, duration: tumble, ease: "Cubic.easeOut" });
    this.tweens.add({ targets: dieBox, y: 80, duration: tumble / 6, yoyo: true, repeat: 2, ease: "Sine.easeOut" });
    const flips = this.time.addEvent({
      delay: 70,
      loop: true,
      callback: () => d.n.setText(String(1 + Math.floor(Math.random() * r.sides))),
    });
    // Real time, not the scene clock: on a slow TV the die still lands when the hits appear.
    this.tumbling = setTimeout(() => {
      this.tumbling = undefined;
      if (this.sys.isActive()) this.showRoll(r);
    }, tumble);
    this.tumbleFlips = flips;
  }

  /** Big result card with the breakdown, e.g. "🎲 14 + 3 (Stärke) + 2 (Übung) = 19 gegen RK 15 → Treffer!". */
  private showRoll(r: RollOutcome): void {
    this.tumbleFlips?.remove(false);
    this.tumbleFlips = undefined;
    this.clearRollBox();
    const width = 860;
    const hasDie = r.dice.length > 0;
    const left = hasDie ? 170 : 30;
    const title = this.add.text(-width + left, 24, r.title, crisp({ fontFamily: FONT, fontSize: "36px", color: "#e0a526", fontStyle: "bold" }));
    const body = this.add.text(-width + left, 80, r.lines.map((l) => l.text).join("\n"), crisp({
      fontFamily: FONT,
      fontSize: "28px",
      color: "#f3e9d2",
      wordWrap: { width: width - left - 30 },
      lineSpacing: 8,
    }));
    const height = Math.max(180, 110 + body.height);
    const bg = this.add.graphics();
    const edge = r.crit ? 0xffd700 : r.success === true ? 0x4caf50 : r.success === false ? 0xe04040 : 0x5a4d42;
    bg.fillStyle(0x14110f, 0.92).fillRoundedRect(-width, 0, width, height, 18);
    bg.lineStyle(6, edge, 1).strokeRoundedRect(-width, 0, width, height, 18);
    this.rollBox.add([bg, title, body]);
    if (hasDie) {
      // The die that counts, big enough to read from the sofa.
      const die = this.add.graphics();
      die.fillStyle(r.crit ? 0xb8860b : 0x7a2e22, 1).fillRoundedRect(-width + 24, 24, 120, 120, 20);
      die.lineStyle(4, 0xf3e9d2, 1).strokeRoundedRect(-width + 24, 24, 120, 120, 20);
      const n = this.add.text(-width + 84, 76, String(r.kept), crisp({ fontFamily: FONT, fontSize: "68px", fontStyle: "bold", color: "#fff", stroke: "#000", strokeThickness: 6 })).setOrigin(0.5);
      const sides = this.add.text(-width + 84, 128, `W${r.sides}`, crisp({ fontFamily: FONT, fontSize: "20px", color: "#f3e9d2" })).setOrigin(0.5);
      this.rollBox.add([die, n, sides]);
      if (r.dice.length > 1) {
        const other = r.dice.find((d, i) => d !== r.kept || i > 0 && r.dice[0] === r.kept) ?? r.dice[1]!;
        this.rollBox.add(this.add.text(-width + 84, 162, `(auch: ${other})`, crisp({ fontFamily: FONT, fontSize: "20px", color: "#b3a58a" })).setOrigin(0.5));
      }
      n.setScale(1.6);
      this.tweens.add({ targets: n, scale: 1, duration: 300, ease: "Back.easeOut" });
    }
    this.rollBox.setAlpha(1);
    this.tweens.add({ targets: this.rollBox, alpha: 0, delay: 5000 + r.lines.length * 700, duration: 800 });
  }
}
