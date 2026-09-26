import Phaser from "phaser";
import { dollFrames } from "../shared/doll";
import type { Narration } from "../shared/story";
import type { OrderEntry, RollOutcome } from "../shared/view";
import { speak } from "./speech";
import { BOARD_HEIGHT, BOARD_WIDTH } from "./DungeonScene";
import type { AiStatus } from "../dm/ai/aidm";

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

  create(): void {
    this.orderBar = this.add.container(20, 150);
    this.banner = this.add
      // In the middle of the screen: at the top the dice card would cover it during fights.
      .text(BOARD_WIDTH / 2, BOARD_HEIGHT * 0.42, "", { fontFamily: FONT, fontSize: "64px", color: "#f3e9d2", stroke: "#000", strokeThickness: 12 })
      .setOrigin(0.5)
      .setAlpha(0);
    this.turnBox = this.add.graphics();
    this.turnText = this.add.text(40, BOARD_HEIGHT - 70, "", { fontFamily: FONT, fontSize: "44px", color: "#fff", stroke: "#000", strokeThickness: 8 }).setOrigin(0, 0.5);
    this.rollBox = this.add.container(BOARD_WIDTH - 40, 40);
    this.chapter = this.add.text(24, 20, "", { fontFamily: FONT, fontSize: "26px", color: "#b3a58a", stroke: "#000", strokeThickness: 5 });
    this.narrationBox = this.add.container(0, 0).setAlpha(0);
    this.aiBadge = this.add.text(BOARD_WIDTH - 24, BOARD_HEIGHT - 20, "", { fontFamily: FONT, fontSize: "22px", color: "#8f8574", stroke: "#000", strokeThickness: 4 }).setOrigin(1, 1);

    const onRoom = (name: string) => this.showBanner(name);
    const onTurn = (name: string, color?: string, free?: boolean) => this.showTurn(name, color, free);
    const onRoll = (r: RollOutcome) => this.showRoll(r);
    const onOrder = (entries: OrderEntry[]) => this.showOrder(entries);
    const onCombat = (started: boolean) => started && this.showBanner("⚔️ Kampf!");
    const onNarration = (lines: Narration[]) => {
      this.queue.push(...lines);
      if (!this.telling) void this.tell();
    };
    const onChapter = (text: string) => this.chapter.setText(text);
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
    const speaker = line.npc ? this.add.text(x + 30, 0, line.npc, { fontFamily: FONT, fontSize: "30px", color: "#e0a526", fontStyle: "bold" }) : undefined;
    const text = this.add.text(x + 30, 0, "", { fontFamily: FONT, fontSize: "34px", color: "#f3e9d2", wordWrap: { width: width - 60 }, lineSpacing: 8, fontStyle: line.npc ? "italic" : "normal" });
    // Measure the full height first.
    text.setText(line.text);
    const tipText = line.tip ? this.add.text(x + 30, 0, `💡 ${line.tip.text}`, { fontFamily: FONT, fontSize: "26px", color: "#1b1208", wordWrap: { width: width - 90 }, lineSpacing: 6 }) : undefined;
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
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
        finish();
      };
      const minTime = new Promise<void>((r) => this.time.delayedCall((1800 + full.length * 45 + (line.tip ? 2500 : 0)) * pace, () => r()));
      const voice = waiting >= 3 ? Promise.resolve() : speak(line.text, !!line.npc);
      void Promise.all([minTime, voice]).then(finish);
    });
  }

  private showBanner(name: string): void {
    this.banner.setText(name).setAlpha(1);
    this.tweens.killTweensOf(this.banner);
    this.tweens.add({ targets: this.banner, alpha: 0, delay: 2500, duration: 1200 });
  }

  private showTurn(name: string, color?: string, free?: boolean): void {
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
      for (const f of frames) this.orderBar.add(this.add.image(44, y + (row - 6) / 2, "tiles", f).setScale(2 * scale));
      const name = this.add.text(88, y + 8 * scale, e.name, { fontFamily: FONT, fontSize: `${Math.round(26 * Math.max(0.75, scale))}px`, color: e.health <= 0 ? "#8d8172" : "#f3e9d2", fontStyle: e.active ? "bold" : "normal" });
      this.orderBar.add(name);
      if (e.initiative !== undefined) this.orderBar.add(this.add.text(e.active ? 300 : 270, y + 8 * scale, String(e.initiative), { fontFamily: FONT, fontSize: `${Math.round(24 * Math.max(0.75, scale))}px`, color: "#b3a58a" }).setOrigin(1, 0));
      const hp = this.add.graphics();
      const hpY = y + row - 6 - 20 * Math.max(0.6, scale);
      hp.fillStyle(0x3a2f27, 1).fillRect(88, hpY, 180, 10);
      const pct = Math.max(0, Math.min(1, e.health));
      hp.fillStyle(pct > 0.5 ? 0x4caf50 : pct > 0.25 ? 0xe0b030 : 0xe04040, 1).fillRect(88, hpY, 180 * pct, 10);
      this.orderBar.add(hp);
    });
  }

  /** Big result card with the breakdown, e.g. "🎲 14 + 3 (Stärke) + 2 (Übung) = 19 gegen RK 15 → Treffer!". */
  private showRoll(r: RollOutcome): void {
    this.rollBox.removeAll(true);
    this.tweens.killTweensOf(this.rollBox);
    const width = 860;
    const hasDie = r.dice.length > 0;
    const left = hasDie ? 170 : 30;
    const title = this.add.text(-width + left, 24, r.title, { fontFamily: FONT, fontSize: "36px", color: "#e0a526", fontStyle: "bold" });
    const body = this.add.text(-width + left, 80, r.lines.map((l) => l.text).join("\n"), {
      fontFamily: FONT,
      fontSize: "28px",
      color: "#f3e9d2",
      wordWrap: { width: width - left - 30 },
      lineSpacing: 8,
    });
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
      const n = this.add.text(-width + 84, 76, String(r.kept), { fontFamily: FONT, fontSize: "68px", fontStyle: "bold", color: "#fff", stroke: "#000", strokeThickness: 6 }).setOrigin(0.5);
      const sides = this.add.text(-width + 84, 128, `W${r.sides}`, { fontFamily: FONT, fontSize: "20px", color: "#f3e9d2" }).setOrigin(0.5);
      this.rollBox.add([die, n, sides]);
      if (r.dice.length > 1) {
        const other = r.dice.find((d, i) => d !== r.kept || i > 0 && r.dice[0] === r.kept) ?? r.dice[1]!;
        this.rollBox.add(this.add.text(-width + 84, 162, `(auch: ${other})`, { fontFamily: FONT, fontSize: "20px", color: "#b3a58a" }).setOrigin(0.5));
      }
      n.setScale(1.6);
      this.tweens.add({ targets: n, scale: 1, duration: 300, ease: "Back.easeOut" });
    }
    this.rollBox.setAlpha(1);
    this.tweens.add({ targets: this.rollBox, alpha: 0, delay: 5000 + r.lines.length * 700, duration: 800 });
  }
}
