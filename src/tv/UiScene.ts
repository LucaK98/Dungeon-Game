import Phaser from "phaser";
import { dollFrames } from "../shared/doll";
import type { Narration } from "../shared/story";
import type { ExplainedLine, OrderEntry, RollOutcome, RollPrompt } from "../shared/view";
import type { Reward } from "../shared/reward";
import type { DollLook } from "../shared/doll";
import { prefetchSpeech, speak, stopSpeaking } from "./speech";
import { BOARD_HEIGHT, BOARD_WIDTH, LOG_PANEL } from "./DungeonScene";

/** Right edge of the map on the TV (the log column is next to it). */
const MAP_RIGHT = BOARD_WIDTH - LOG_PANEL;
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
  private rewards: { r: Reward; look?: DollLook }[] = [];
  private rewardTimer: Phaser.Time.TimerEvent | undefined;
  private rewardShowing = false;
  private logBox!: Phaser.GameObjects.Container;
  private tumbling: ReturnType<typeof setTimeout> | undefined;
  private tumbleFlips: Phaser.Time.TimerEvent | undefined;

  create(): void {
    // A fresh start (new map): no card is on screen any more.
    this.rewardShowing = false;
    this.rewardTimer = undefined;
    // Board pixels → screen pixels.
    this.cameras.main.setOrigin(0, 0).setZoom(RES);
    this.orderBar = this.add.container(20, 150);
    this.banner = this.add
      // In the middle of the screen: at the top the dice card would cover it during fights.
      .text(MAP_RIGHT / 2, BOARD_HEIGHT * 0.42, "", crisp({ fontFamily: FONT, fontSize: "64px", color: "#f3e9d2", stroke: "#000", strokeThickness: 12 }))
      .setOrigin(0.5)
      .setAlpha(0);
    this.turnBox = this.add.graphics();
    this.turnText = this.add.text(40, BOARD_HEIGHT - 70, "", crisp({ fontFamily: FONT, fontSize: "44px", color: "#fff", stroke: "#000", strokeThickness: 8 })).setOrigin(0, 0.5);
    this.rollBox = this.add.container(MAP_RIGHT - 30, 40);
    this.logBox = this.add.container(0, 0);
    this.chapter = this.add.text(24, 20, "", crisp({ fontFamily: FONT, fontSize: "26px", color: "#b3a58a", stroke: "#000", strokeThickness: 5 }));
    this.narrationBox = this.add.container(0, 0).setAlpha(0);
    this.aiBadge = this.add.text(MAP_RIGHT - 24, BOARD_HEIGHT - 20, "", crisp({ fontFamily: FONT, fontSize: "22px", color: "#8f8574", stroke: "#000", strokeThickness: 4 })).setOrigin(1, 1);

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
    const onLog = (lines: ExplainedLine[], added = 0) => this.showLog(lines, added);
    this.game.events.on("log", onLog);
    // The campfire rest: a warm panel at the top while the phones tell and shop.
    const campBox = this.add.container(MAP_RIGHT / 2 + 60, 96).setDepth(40);
    const onCamp = (state?: { ready: number; total: number }) => {
      this.tweens.killTweensOf(campBox.list);
      campBox.removeAll(true);
      if (!state) return;
      const w = 760;
      const bg = this.add.graphics();
      bg.fillStyle(0x2a160a, 0.94).fillRoundedRect(-w / 2, 0, w, 130, 22);
      bg.lineStyle(5, 0xff8a1e, 1).strokeRoundedRect(-w / 2, 0, w, 130, 22);
      const fire = this.add.text(-w / 2 + 70, 65, "🔥", crisp({ fontSize: "72px" })).setOrigin(0.5);
      this.tweens.add({ targets: fire, scale: { from: 0.92, to: 1.08 }, angle: { from: -4, to: 4 }, duration: 420, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      const title = this.add.text(-w / 2 + 130, 18, "Rast am Lagerfeuer", crisp({ fontFamily: FONT, fontSize: "40px", fontStyle: "bold", color: "#ffd75e" }));
      const info = this.add.text(-w / 2 + 130, 74, `Erzählt euch etwas und kauft ein · ${state.ready} von ${state.total} bereit`, crisp({ fontFamily: FONT, fontSize: "26px", color: "#f3e9d2" }));
      campBox.add([bg, fire, title, info]);
    };
    this.game.events.on("camp", onCamp);
    // A group vote: one bar per option, filled with the colours of who voted for it.
    const voteBox = this.add.container(MAP_RIGHT / 2 + 60, 96).setDepth(41);
    const onVote = (state?: { total: number; cast: number; options: { label: string; voters: { name: string; color: string }[] }[] }) => {
      voteBox.removeAll(true);
      if (!state) return;
      const w = 900;
      const rowH = 70;
      const height = 90 + state.options.length * rowH;
      const bg = this.add.graphics();
      bg.fillStyle(0x14110f, 0.94).fillRoundedRect(-w / 2, 0, w, height, 22);
      bg.lineStyle(5, 0x7fd88a, 1).strokeRoundedRect(-w / 2, 0, w, height, 22);
      const title = this.add.text(-w / 2 + 30, 18, `🗳️ Abstimmung · ${state.cast} von ${state.total} haben abgestimmt`, crisp({ fontFamily: FONT, fontSize: "34px", fontStyle: "bold", color: "#a8e6a3" }));
      voteBox.add([bg, title]);
      state.options.forEach((o, i) => {
        const y = 80 + i * rowH;
        const bar = this.add.graphics();
        bar.fillStyle(0x2a241e, 1).fillRoundedRect(-w / 2 + 30, y, w - 60, rowH - 14, 12);
        const seg = (w - 60) / Math.max(1, state.total);
        o.voters.forEach((v, j) => {
          bar.fillStyle(Phaser.Display.Color.HexStringToColor(v.color).color, 0.85).fillRoundedRect(-w / 2 + 30 + j * seg, y, seg - 4, rowH - 14, 12);
        });
        const label = this.add.text(-w / 2 + 48, y + (rowH - 14) / 2, o.label, crisp({ fontFamily: FONT, fontSize: "26px", color: "#fff", stroke: "#000", strokeThickness: 5, fixedWidth: w - 220 })).setOrigin(0, 0.5);
        const n = this.add.text(w / 2 - 48, y + (rowH - 14) / 2, String(o.voters.length), crisp({ fontFamily: FONT, fontSize: "32px", fontStyle: "bold", color: "#ffd75e", stroke: "#000", strokeThickness: 5 })).setOrigin(1, 0.5);
        voteBox.add([bar, label, n]);
      });
    };
    this.game.events.on("vote", onVote);
    // A big note while the table waits for one phone (e.g. the final blow).
    const infoBox = this.add.container(MAP_RIGHT / 2 + 60, 96).setDepth(42);
    const onInfo = (info?: { icon: string; title: string; text: string }) => {
      this.tweens.killTweensOf(infoBox.list);
      infoBox.removeAll(true);
      if (!info) return;
      const w = 900;
      const title = this.add.text(-w / 2 + 140, 22, info.title, crisp({ fontFamily: FONT, fontSize: "40px", fontStyle: "bold", color: "#ffd75e", wordWrap: { width: w - 170 } }));
      const text = this.add.text(-w / 2 + 140, 30 + title.height, info.text, crisp({ fontFamily: FONT, fontSize: "26px", color: "#f3e9d2", wordWrap: { width: w - 170 } }));
      const height = Math.max(140, 50 + title.height + text.height);
      const bg = this.add.graphics();
      bg.fillStyle(0x1a0f0a, 0.95).fillRoundedRect(-w / 2, 0, w, height, 22);
      bg.lineStyle(6, 0xe0a526, 1).strokeRoundedRect(-w / 2, 0, w, height, 22);
      const icon = this.add.text(-w / 2 + 75, height / 2, info.icon, crisp({ fontSize: "76px" })).setOrigin(0.5);
      this.tweens.add({ targets: icon, angle: { from: -10, to: 10 }, duration: 500, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      infoBox.add([bg, icon, title, text]);
    };
    this.game.events.on("info-banner", onInfo);
    // The Harz travel map between chapters: three routes, the chosen one is ridden along.
    const travelBox = this.add.container(MAP_RIGHT / 2 + 60, 410).setDepth(30);
    const onTravel = (t?: { from: string; to: string; routes: { icon: string; name: string; text: string; x: number; y: number }[]; chosen?: number }) => {
      this.tweens.killTweensOf(travelBox.list);
      travelBox.removeAll(true);
      if (!t) return;
      const w = 1100;
      const hgt = 470;
      const pad = 60;
      const bg = this.add.graphics();
      bg.fillStyle(0x000000, 0.4).fillRoundedRect(-w / 2 + 8, 10, w, hgt, 26);
      bg.fillStyle(0xe9d7aa, 1).fillRoundedRect(-w / 2, 0, w, hgt, 26);
      bg.lineStyle(6, 0x6b4a24, 1).strokeRoundedRect(-w / 2, 0, w, hgt, 26);
      // Hills of the Harz, drawn softly.
      bg.fillStyle(0xcdb886, 1);
      for (const [hx, hy, r] of [[0.35, 0.4, 70], [0.45, 0.3, 90], [0.6, 0.5, 60], [0.25, 0.6, 50], [0.75, 0.35, 55]] as const) bg.fillEllipse(-w / 2 + hx * w, hy * hgt, r * 2.4, r);
      bg.fillStyle(0x8fa36a, 0.5);
      for (let k = 0; k < 26; k++) bg.fillCircle(-w / 2 + pad + ((k * 197) % (w - 2 * pad)), 60 + ((k * 131) % (hgt - 120)), 8);
      const title = this.add.text(0, 22, "🗺️ Reise durch den Harz", crisp({ fontFamily: FONT, fontSize: "36px", fontStyle: "bold", color: "#4a2c12" })).setOrigin(0.5, 0);
      travelBox.add([bg, title]);
      const pos = (x: number, y: number) => ({ x: -w / 2 + pad + x * (w - 2 * pad), y: 90 + y * (hgt - 150) });
      const start = pos(0, 0.55);
      const end = pos(1, 0.55);
      const curve = (via: { x: number; y: number }) => new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(start.x, start.y), new Phaser.Math.Vector2(via.x * 2 - (start.x + end.x) / 2, via.y * 2 - (start.y + end.y) / 2), new Phaser.Math.Vector2(end.x, end.y));
      const colors = [0xb03a2e, 0x2e6fb0, 0x2e8b57];
      t.routes.forEach((r, i) => {
        const via = pos(r.x, r.y);
        const c = curve(via);
        const g = this.add.graphics();
        const chosen = t.chosen === i;
        const faded = t.chosen !== undefined && !chosen;
        const pts = c.getSpacedPoints(60);
        for (let k = 0; k + 1 < pts.length; k += 2) g.lineStyle(chosen ? 9 : 6, colors[i]!, faded ? 0.25 : 1).lineBetween(pts[k]!.x, pts[k]!.y, pts[k + 1]!.x, pts[k + 1]!.y);
        const icon = this.add.text(via.x, via.y - 8, r.icon, crisp({ fontSize: "46px" })).setOrigin(0.5).setAlpha(faded ? 0.35 : 1);
        const label = this.add.text(via.x, via.y + 30, r.name, crisp({ fontFamily: FONT, fontSize: "22px", fontStyle: "bold", color: "#2a1a08", backgroundColor: "#f3e6c2", padding: { x: 6, y: 2 } })).setOrigin(0.5, 0).setAlpha(faded ? 0.35 : 1);
        travelBox.add([g, icon, label]);
        if (chosen) {
          const rider = this.add.text(start.x, start.y, "🐎", crisp({ fontSize: "44px" })).setOrigin(0.5);
          travelBox.add(rider);
          const tracker = { p: 0 };
          this.tweens.add({ targets: tracker, p: 1, duration: 4000, ease: "Sine.easeInOut", onUpdate: () => {
            const pt = c.getPoint(tracker.p);
            rider.setPosition(pt.x, pt.y - 10);
          } });
        } else if (t.chosen === undefined) this.tweens.add({ targets: icon, scale: 1.15, duration: 700 + i * 120, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      });
      const dot = this.add.graphics();
      dot.fillStyle(0x4a2c12, 1).fillCircle(start.x, start.y, 12).fillCircle(end.x, end.y, 12);
      const from = this.add.text(start.x, start.y + 20, `🔥 ${t.from}`, crisp({ fontFamily: FONT, fontSize: "22px", color: "#2a1a08", wordWrap: { width: 220 }, align: "center" })).setOrigin(0.5, 0);
      const to = this.add.text(end.x, end.y + 20, `🏁 ${t.to}`, crisp({ fontFamily: FONT, fontSize: "22px", color: "#2a1a08", wordWrap: { width: 220 }, align: "center" })).setOrigin(0.5, 0);
      travelBox.add([dot, from, to]);
    };
    this.game.events.on("travel", onTravel);
    const onReward = (r: Reward, look?: DollLook) => this.queueReward(r, look);
    this.game.events.on("reward", onReward);
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
      this.game.events.off("asked", onAsked);
      this.game.events.off("log", onLog);
      this.game.events.off("reward", onReward);
      this.game.events.off("camp", onCamp);
      this.game.events.off("vote", onVote);
      this.game.events.off("info-banner", onInfo);
      this.game.events.off("travel", onTravel);
      clearTimeout(this.tumbling);
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
    // Between the initiative bar (left, in fights) and the log column.
    const width = 1060;
    const x = MAP_RIGHT - width - 30;
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
      // Fetch the next line's voice while this one is spoken.
      const upcoming = this.queue[0];
      if (upcoming && waiting < 3) prefetchSpeech(upcoming.text, upcoming.npc);
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

  /** Rewards are shown one card at a time; level-ups of the whole group share one card. */
  private queueReward(r: Reward, look?: DollLook): void {
    this.rewards.push({ r, ...(look ? { look } : {}) });
    if (this.rewardShowing || this.rewardTimer) return;
    // Wait a moment: all heroes level up at once and should land on the same card.
    this.rewardTimer = this.time.delayedCall(350, () => {
      this.rewardTimer = undefined;
      this.nextReward();
    });
  }

  private nextReward(): void {
    const first = this.rewards.shift();
    if (!first) {
      this.rewardShowing = false;
      return;
    }
    this.rewardShowing = true;
    let items = [first];
    if (first.r.kind === "level") {
      items = [first, ...this.rewards.filter((x) => x.r.kind === "level")];
      this.rewards = this.rewards.filter((x) => x.r.kind !== "level");
    }
    const card = this.rewardCard(items);
    card.setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: card, scale: 1, alpha: 1, duration: 450, ease: "Back.easeOut" });
    const stay = first.r.kind === "level" ? 7000 + items.length * 1200 : 5000;
    this.tweens.add({
      targets: card,
      alpha: 0,
      y: card.y - 40,
      delay: stay,
      duration: 700,
      onComplete: () => {
        this.tweens.killTweensOf(card.list);
        card.destroy();
        this.nextReward();
      },
    });
  }

  /** The celebration card: a golden frame with rays, the heroes and what they gained. */
  private rewardCard(items: { r: Reward; look?: DollLook }[]): Phaser.GameObjects.Container {
    const width = 900;
    const cx = MAP_RIGHT / 2 + 60;
    const card = this.add.container(cx, BOARD_HEIGHT * 0.36).setDepth(50);
    const parts: Phaser.GameObjects.GameObject[] = [];
    const first = items[0]!.r;
    const head = first.kind === "level" ? `⬆️ Stufe ${first.level}!` : "🎁 Beute!";
    const sub = first.kind === "level" ? "Ihr seid stärker geworden" : first.kind === "gear" ? first.how : "";
    let y = 0;
    const title = this.add.text(0, 40, head, crisp({ fontFamily: FONT, fontSize: "60px", fontStyle: "bold", color: "#ffd75e", stroke: "#3a2400", strokeThickness: 10 })).setOrigin(0.5, 0);
    parts.push(title);
    y = 40 + title.height;
    if (sub) {
      const t = this.add.text(0, y, sub, crisp({ fontFamily: FONT, fontSize: "26px", color: "#e8dcc4" })).setOrigin(0.5, 0);
      parts.push(t);
      y += t.height + 16;
    }
    for (const { r, look } of items) {
      const rowTop = y;
      // Level-ups show the hero, loot shows the piece itself.
      const portrait = look && r.kind === "level" ? dollFrames(look) : [];
      for (const f of portrait) parts.push(this.add.image(-width / 2 + 80, rowTop + 50, TILES, f).setScale(3 / UP));
      const tx = -width / 2 + 150;
      if (r.kind === "level") {
        const name = this.add.text(tx, rowTop, r.name, crisp({ fontFamily: FONT, fontSize: "34px", fontStyle: "bold", color: r.color ?? "#f3e9d2", stroke: "#000", strokeThickness: 5 }));
        const gains = r.gains.slice(0, 4).map((g) => `${g.icon} ${g.label} ${g.from} → ${g.to}`).join("    ");
        const g = this.add.text(tx, rowTop + 46, gains || "Neue Kräfte", crisp({ fontFamily: FONT, fontSize: "26px", color: "#a8e6a3", wordWrap: { width: width - 190 }, lineSpacing: 6 }));
        parts.push(name, g);
        let rowH = 46 + g.height;
        const news = [...r.features, ...r.spells].map((f) => f.name);
        if (news.length) {
          const n = this.add.text(tx, rowTop + rowH + 6, `✨ Neu: ${news.slice(0, 4).join(", ")}${news.length > 4 ? " …" : ""}`, crisp({ fontFamily: FONT, fontSize: "24px", color: "#ffd75e", wordWrap: { width: width - 190 } }));
          parts.push(n);
          rowH += 6 + n.height;
        }
        y += Math.max(100, rowH) + 18;
      } else if (r.kind === "gear") {
        const icon = this.add.text(-width / 2 + 80, rowTop + 50, r.icon, crisp({ fontSize: "72px" })).setOrigin(0.5);
        const name = this.add.text(tx, rowTop, `${r.name} erhält`, crisp({ fontFamily: FONT, fontSize: "28px", color: r.color ?? "#f3e9d2", stroke: "#000", strokeThickness: 5 }));
        const what = this.add.text(tx, rowTop + 38, r.title, crisp({ fontFamily: FONT, fontSize: "42px", fontStyle: "bold", color: "#ffd75e", stroke: "#3a2400", strokeThickness: 6 }));
        const detail = this.add.text(tx, rowTop + 96, r.detail, crisp({ fontFamily: FONT, fontSize: "26px", color: "#e8dcc4", wordWrap: { width: width - 190 } }));
        parts.push(icon, name, what, detail);
        this.tweens.add({ targets: icon, angle: { from: -8, to: 8 }, duration: 600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
        y += 96 + detail.height + 24;
      }
    }
    const height = y + 20;
    // Rays behind the card, slowly turning.
    const rays = this.add.graphics();
    rays.fillStyle(0xffd75e, 0.09);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const b = a + Math.PI / 24;
      rays.fillTriangle(0, 0, Math.cos(a) * 640, Math.sin(a) * 640, Math.cos(b) * 640, Math.sin(b) * 640);
    }
    rays.setPosition(0, height / 2);
    this.tweens.add({ targets: rays, angle: 360, duration: 24000, repeat: -1 });
    const bg = this.add.graphics();
    bg.fillStyle(0x17110a, 0.96).fillRoundedRect(-width / 2, 0, width, height, 26);
    bg.lineStyle(6, 0xe0a526, 1).strokeRoundedRect(-width / 2, 0, width, height, 26);
    bg.lineStyle(2, 0xffe9a8, 0.6).strokeRoundedRect(-width / 2 + 10, 10, width - 20, height - 20, 20);
    const glow = this.add.graphics();
    glow.lineStyle(14, 0xffd75e, 0.35).strokeRoundedRect(-width / 2 - 6, -6, width + 12, height + 12, 30);
    this.tweens.add({ targets: glow, alpha: 0.2, duration: 700, yoyo: true, repeat: -1 });
    card.add([rays, glow, bg, ...parts]);
    card.setY(Math.max(40, BOARD_HEIGHT * 0.42 - height / 2));
    card.setSize(width, height);
    return card;
  }

  /**
   * "📜 Was ist passiert?" in the right column: the newest lines at the bottom, older ones fade.
   * Hits and successes are green, misses red, so the sofa can follow at a glance.
   */
  private showLog(lines: ExplainedLine[], added: number): void {
    const box = this.logBox;
    this.tweens.killTweensOf(box.list);
    box.removeAll(true);
    const x = MAP_RIGHT + 10;
    const width = LOG_PANEL - 30;
    const top = 20;
    const bottom = BOARD_HEIGHT - 20;
    const bg = this.add.graphics();
    bg.fillStyle(0x0d0b09, 0.88).fillRoundedRect(x, top, width, bottom - top, 18);
    bg.lineStyle(3, 0x5a4d42, 1).strokeRoundedRect(x, top, width, bottom - top, 18);
    const title = this.add.text(x + 22, top + 18, "📜 Was ist passiert?", crisp({ fontFamily: FONT, fontSize: "28px", color: "#e0a526", fontStyle: "bold" }));
    box.add([bg, title]);
    const texts = lines.map((l) => l.text);
    const fresh = Math.min(added, texts.length);
    let y = bottom - 18;
    const limit = top + 70;
    for (let i = texts.length - 1; i >= 0; i--) {
      const text = texts[i]!;
      const age = texts.length - 1 - i;
      const t = this.add.text(x + 30, 0, text, crisp({ fontFamily: FONT, fontSize: "22px", color: logColor(text), wordWrap: { width: width - 48 }, lineSpacing: 4 }));
      if (y - t.height < limit) {
        t.destroy();
        break;
      }
      y -= t.height;
      t.setY(y).setAlpha(age === 0 ? 1 : Math.max(0.45, 0.92 - age * 0.06));
      const mark = this.add.graphics();
      mark.fillStyle(age < fresh ? 0xe0a526 : 0x3b322b, 1).fillRoundedRect(x + 14, y + 3, 5, Math.max(18, t.height - 6), 2);
      box.add([mark, t]);
      if (age < fresh) {
        // New lines slide in (always readable, even if the next update comes quickly).
        t.setX(x + 50);
        this.tweens.add({ targets: t, x: x + 30, duration: 300, ease: "Cubic.easeOut" });
      }
      y -= 12;
    }
  }

  /** A die drawn at (x, y) (its top-left), `size` wide, with a number on it. */
  private drawDie(x: number, y: number, size: number, fill: number, label: string, sides: number): { die: Phaser.GameObjects.Graphics; n: Phaser.GameObjects.Text; s: Phaser.GameObjects.Text } {
    const die = this.add.graphics();
    die.fillStyle(fill, 1).fillRoundedRect(x, y, size, size, size / 6);
    die.lineStyle(4, 0xf3e9d2, 1).strokeRoundedRect(x, y, size, size, size / 6);
    const n = this.add.text(x + size / 2, y + size * 0.43, label, crisp({ fontFamily: FONT, fontSize: `${Math.round(size * 0.46)}px`, fontStyle: "bold", color: "#fff", stroke: "#000", strokeThickness: 6 })).setOrigin(0.5);
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
      const n = this.add.text(-width + 84, 76, String(r.kept), crisp({ fontFamily: FONT, fontSize: r.kept >= 10 ? "56px" : "68px", fontStyle: "bold", color: "#fff", stroke: "#000", strokeThickness: 6 })).setOrigin(0.5);
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

/** Colour of a log line: green for hits and successes, red for misses and failures. */
function logColor(text: string): string {
  if (/nicht geschafft|verfehlt|daneben|misslingt|fehlschlag|→ kein treffer/i.test(text)) return "#f0a3a3";
  if (/treffer|geschafft|erfolg|kritisch/i.test(text)) return "#a8e6a3";
  if (/^(⬆️|✨|💰|🎁|🏆)/u.test(text)) return "#ffd75e";
  return "#e8dcc4";
}
