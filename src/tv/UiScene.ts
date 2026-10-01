import { BULLET_COLOR, BULLET_ICON } from "../shared/bullets";
import Phaser from "phaser";
import { dollFrames } from "../shared/doll";
import type { Narration } from "../shared/story";
import type { ExplainedLine, OrderEntry, RollOutcome, RollPrompt } from "../shared/view";
import type { Reward } from "../shared/reward";
import type { DollLook } from "../shared/doll";
import { prefetchSpeech, speak, speechRate, stopSpeaking } from "./speech";
import { BOARD_HEIGHT, BOARD_WIDTH, LOG_PANEL } from "./DungeonScene";

import type { AiStatus } from "../dm/ai/aidm";
import { crisp, RES, TILES, UP } from "./render";
import { mergeSummary, rollVerdict, summaryOf, TONE } from "./tv-text";

const FONT = "system-ui, sans-serif";

/** Screen-space overlay on top of the zoomed dungeon: room names, turn, initiative bar, roll results. */
export class UiScene extends Phaser.Scene {
  private banner!: Phaser.GameObjects.Text;
  private turnText!: Phaser.GameObjects.Text;
  private logLines: ExplainedLine[] = [];
  private notes: { tasks: { text: string; done: boolean }[]; more: number; clues: string[] } = { tasks: [], more: 0, clues: [] };
  private notesKey = "";
  private sceneCardAt = 0;
  private goal!: Phaser.GameObjects.Text;
  /** "Runde 3 · danach: Brunhild, Ole" above the name. */
  private turnInfo!: Phaser.GameObjects.Text;
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
  /** The full log column is only shown on demand (key L); otherwise the map takes the whole width. */
  private logOpen = false;
  private logCloseTimer: Phaser.Time.TimerEvent | undefined;
  /** Log closed: the newest line in one row at the bottom. */
  private ticker!: Phaser.GameObjects.Container;
  /** Log closed: tasks and clues as one short line under the goal. */
  private notesLine!: Phaser.GameObjects.Text;
  /** Messages in the middle of the screen, one after the other. */
  private bannerQueue: { text: string; color?: string; small?: boolean }[] = [];
  private bannerBusy = false;
  /** Small things (EP, gold, elemental states) are collected and shown once per round. */
  private summary: string[] = [];
  private summaryTimer: Phaser.Time.TimerEvent | undefined;
  private round: number | undefined;
  private rollUntil = 0;
  /** Things placed relative to the right edge of the map (it moves when the log opens). */
  private anchors: [Phaser.GameObjects.Components.Transform, (right: number) => number][] = [];

  /** Right edge of the map on the TV (the log column is next to it while open). */
  private mapRight(): number {
    return BOARD_WIDTH - (this.logOpen ? LOG_PANEL : 0);
  }

  private anchor<T extends Phaser.GameObjects.Components.Transform>(obj: T, x: (right: number) => number): T {
    this.anchors.push([obj, x]);
    obj.x = x(this.mapRight());
    return obj;
  }

  create(): void {
    // A fresh start (new map): no card is on screen any more.
    this.rewardShowing = false;
    this.rewardTimer = undefined;
    this.anchors = [];
    this.bannerQueue = [];
    this.bannerBusy = false;
    // Board pixels → screen pixels.
    this.cameras.main.setOrigin(0, 0).setZoom(RES);
    this.orderBar = this.add.container(20, 190);
    this.banner = this.add
      // In the middle of the screen: at the top the dice card would cover it during fights.
      .text(0, BOARD_HEIGHT * 0.42, "", crisp({ fontFamily: FONT, fontSize: "64px", color: "#f3e9d2", stroke: "#000", strokeThickness: 12 }))
      .setOrigin(0.5)
      .setAlpha(0);
    this.anchor(this.banner, (r) => r / 2);
    this.turnBox = this.add.graphics();
    this.turnText = this.add.text(40, BOARD_HEIGHT - 70, "", crisp({ fontFamily: FONT, fontSize: "44px", color: "#fff", stroke: "#000", strokeThickness: 8 })).setOrigin(0, 0.5);
    this.turnInfo = this.add.text(44, BOARD_HEIGHT - 128, "", crisp({ fontFamily: FONT, fontSize: "26px", color: "#e0c68a", stroke: "#000", strokeThickness: 6 })).setOrigin(0, 0.5);
    this.rollBox = this.anchor(this.add.container(0, 40), (r) => r - 30);
    this.logBox = this.add.container(0, 0);
    this.chapter = this.add.text(24, 20, "", crisp({ fontFamily: FONT, fontSize: "26px", color: "#b3a58a", stroke: "#000", strokeThickness: 5 }));
    this.goal = this.add.text(24, 54, "", crisp({ fontFamily: FONT, fontSize: "30px", color: "#ffe08a", fontStyle: "bold", stroke: "#000", strokeThickness: 6, wordWrap: { width: BOARD_WIDTH - 900 } }));
    this.notesLine = this.add.text(26, 98, "", crisp({ fontFamily: FONT, fontSize: "22px", color: "#b3a58a", stroke: "#000", strokeThickness: 5 }));
    this.ticker = this.add.container(0, 0).setDepth(20);
    this.narrationBox = this.anchor(this.add.container(0, 0).setAlpha(0), (r) => r - BOARD_WIDTH);
    this.aiBadge = this.add.text(0, BOARD_HEIGHT - 20, "", crisp({ fontFamily: FONT, fontSize: "22px", color: "#8f8574", stroke: "#000", strokeThickness: 4 })).setOrigin(1, 1);
    this.anchor(this.aiBadge, (r) => r - 24);

    // The scene card already names the place: no second title right after it.
    const onRoom = (name: string) => {
      if (Date.now() - this.sceneCardAt < 6000) return;
      this.showBanner(name);
    };
    const onTurn = (name: string, color?: string, free?: boolean, info?: string) => this.showTurn(name, color, free, info);
    const onRoll = (r: RollOutcome, tumble = 0) => {
      // Its lines are on the roll card: the ticker does not repeat them.
      this.rollUntil = Date.now() + tumble + 1500;
      this.tweens.killTweensOf(this.ticker);
      this.ticker.removeAll(true);
      this.rollIn(r, tumble);
    };
    const onAsked = (prompt: RollPrompt, name: string, color?: string) => this.showAsk(prompt, name, color);
    const onOrder = (entries: OrderEntry[]) => this.showOrder(entries);
    const onCombat = (started: boolean) => started && this.showBanner("⚔️ Kampf!");
    const onNarration = (lines: Narration[]) => {
      this.queue.push(...lines);
      if (!this.telling) void this.tell();
    };
    // Top left: the chapter, and below it the goal right now in one line (always in sight).
    // Exploring in turns: the seconds left for a silent player, and a short note when a round is over.
    const onClock = (seconds?: number) => {
      const base = this.turnInfo.getData("base") as string | undefined;
      if (base === undefined) return;
      this.turnInfo.setText(seconds !== undefined && seconds <= 60 ? `${base} · ⏱ ${seconds} s` : base);
      this.turnInfo.setColor(seconds !== undefined && seconds <= 15 ? "#ff8a7e" : "#e0c68a");
    };
    // One message per round: "Runde 3 vorbei", with what happened on the side.
    const onRound = (ended: number) => {
      if (!this.flushSummary(ended)) this.showBanner(`🔔 Runde ${ended} vorbei`, undefined, true);
    };
    const onFlash = (text: string) => this.showBanner(text, flashColor(text));
    this.game.events.on("flash", onFlash);
    this.events.once("shutdown", () => this.game.events.off("flash", onFlash));
    // A new scene: title and goal big in the middle for a few seconds.
    const sceneCard = this.anchor(this.add.container(0, BOARD_HEIGHT * 0.24).setDepth(45).setAlpha(0), (r) => r / 2);
    const onSceneCard = (title: string, goal: string) => {
      this.sceneCardAt = Date.now();
      this.banner.setAlpha(0);
      this.tweens.killTweensOf(sceneCard);
      sceneCard.removeAll(true);
      const t = this.add.text(0, -30, title, crisp({ fontFamily: FONT, fontSize: "64px", fontStyle: "bold", color: "#ffd75e", stroke: "#000", strokeThickness: 10, align: "center", wordWrap: { width: 1100 } })).setOrigin(0.5, 1);
      const g = this.add.text(0, 10, `🎯 ${goal}`, crisp({ fontFamily: FONT, fontSize: "36px", color: "#f3e9d2", stroke: "#000", strokeThickness: 8, align: "center", wordWrap: { width: 1100 } })).setOrigin(0.5, 0);
      const w = Math.max(t.width, g.width) + 120;
      const bg = this.add.graphics();
      bg.fillStyle(0x0d0b09, 0.88).fillRoundedRect(-w / 2, -t.height - 70, w, t.height + g.height + 120, 26);
      bg.lineStyle(5, 0xe0a526, 1).strokeRoundedRect(-w / 2, -t.height - 70, w, t.height + g.height + 120, 26);
      sceneCard.add([bg, t, g]);
      sceneCard.setAlpha(0).setScale(0.9);
      this.tweens.add({ targets: sceneCard, alpha: 1, scale: 1, duration: 450, ease: "Back.easeOut" });
      this.tweens.add({ targets: sceneCard, alpha: 0, delay: 3800, duration: 700 });
    };
    this.game.events.on("scene-card", onSceneCard);
    this.events.once("shutdown", () => this.game.events.off("scene-card", onSceneCard));
    this.game.events.on("clock", onClock);
    this.game.events.on("round", onRound);
    this.events.once("shutdown", () => {
      this.game.events.off("clock", onClock);
      this.game.events.off("round", onRound);
    });
    const onChapter = (text: string, goal?: string) => {
      this.chapter.setText(text);
      this.goal.setText(goal ? `🎯 ${goal}` : "");
      // The notes line sits right under the goal (which may take two lines).
      this.notesLine.setY(this.goal.y + Math.max(36, this.goal.height) + 4);
    };
    // A short note under the chapter: the game was saved (with the code for another device).
    const saved = this.add.text(24, 126, "", crisp({ fontFamily: FONT, fontSize: "22px", color: "#8f8574", stroke: "#000", strokeThickness: 4 })).setAlpha(0);
    const onSaved = (code?: string) => {
      saved.setText(code ? `💾 Gespeichert · Code zum Weiterspielen: ${code}` : "💾 Gespeichert").setAlpha(1);
      saved.setY(this.notesLine.y + (this.notesLine.text ? 28 : 0));
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
    const onAskCancel = () => {
      if (!this.asking) return;
      this.asking = false;
      this.clearRollBox();
    };
    this.game.events.on("ask-cancel", onAskCancel);
    this.events.once("shutdown", () => this.game.events.off("ask-cancel", onAskCancel));
    const onLog = (lines: ExplainedLine[], added = 0) => {
      this.logLines = lines;
      this.showLog(lines, added);
      this.takeNews(lines.slice(lines.length - Math.min(added, lines.length)).map((l) => l.text));
    };
    // L: the whole log for a moment (it folds away again by itself).
    const onKeyL = () => this.setLogOpen(!this.logOpen);
    this.input.keyboard?.on("keydown-L", onKeyL);
    const onLogPanel = (open: boolean) => this.setLogOpen(open);
    this.game.events.on("log-panel", onLogPanel);
    this.events.once("shutdown", () => {
      this.input.keyboard?.off("keydown-L", onKeyL);
      this.game.events.off("log-panel", onLogPanel);
      this.logCloseTimer?.remove(false);
      this.summaryTimer?.remove(false);
    });
    // Tasks and clues at the top of the right column (redrawn only when they change).
    const onNotes = (tasks: { text: string; done: boolean }[], more: number, clues: string[]) => {
      const key = JSON.stringify([tasks, more, clues.slice(-3)]);
      if (key === this.notesKey) return;
      this.notesKey = key;
      this.notes = { tasks, more, clues };
      this.showLog(this.logLines, 0);
      this.showNotesLine();
    };
    this.game.events.on("notes", onNotes);
    this.events.once("shutdown", () => this.game.events.off("notes", onNotes));
    this.game.events.on("log", onLog);
    // The campfire rest: a warm panel at the top while the phones tell and shop.
    const campBox = this.anchor(this.add.container(0, 96).setDepth(40), (r) => r / 2 + 60);
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
    const voteBox = this.anchor(this.add.container(0, 96).setDepth(41), (r) => r / 2 + 60);
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
    const infoBox = this.anchor(this.add.container(0, 96).setDepth(42), (r) => r / 2 + 60);
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
    const travelBox = this.anchor(this.add.container(0, 410).setDepth(30), (r) => r / 2 + 60);
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

  /** The roll card slides in softly instead of popping up. */
  private popRollBox(): void {
    this.rollBox.setAlpha(0).setY(26);
    this.tweens.add({ targets: this.rollBox, alpha: 1, y: 40, duration: 220, ease: "Sine.easeOut" });
  }

  /** Tells the queued narration line by line with a typewriter effect (and reads it aloud). */
  private async tell(): Promise<void> {
    this.telling = true;
    // While the story is told, the phones wait (the game hears it through the board).
    this.game.events.emit("narrating", true);
    let first = true;
    while (this.queue.length) {
      const line = this.queue.shift()!;
      // A breath between two lines (shorter when many are waiting).
      if (!first) await new Promise<void>((r) => this.time.delayedCall((this.queue.length >= 2 ? 150 : 380) / speechRate(), () => r()));
      first = false;
      await this.fadeLineOut();
      await this.showLine(line);
    }
    this.telling = false;
    this.game.events.emit("narrating", false);
    this.tweens.add({ targets: this.narrationBox, alpha: 0, delay: 4000, duration: 800 });
  }

  /** The line on screen gives way softly (instead of being swapped from one frame to the next). */
  private fadeLineOut(): Promise<void> {
    const box = this.narrationBox;
    if (!box.length || box.alpha < 0.05) return Promise.resolve();
    this.tweens.killTweensOf(box);
    return new Promise((resolve) => this.tweens.add({ targets: box, alpha: 0, duration: 160, ease: "Sine.easeIn", onComplete: () => resolve() }));
  }

  private showLine(line: Narration): Promise<void> {
    const box = this.narrationBox;
    box.removeAll(true);
    this.tweens.killTweensOf(box);
    // The new line glides in from slightly below.
    box.setAlpha(0).setY(14);
    this.tweens.add({ targets: box, alpha: 1, y: 0, duration: 260, ease: "Sine.easeOut" });
    // Between the initiative bar (left, in fights) and the log column.
    const width = 1060;
    // (The box moves with the right edge of the map, see anchor.)
    const x = BOARD_WIDTH - width - 30;
    const speaker = line.npc ? this.add.text(x + 30, 0, line.npc, crisp({ fontFamily: FONT, fontSize: "30px", color: "#e0a526", fontStyle: "bold" })) : undefined;
    const text = this.add.text(x + 30, 0, "", crisp({ fontFamily: FONT, fontSize: "34px", color: "#f3e9d2", wordWrap: { width: width - 60 }, lineSpacing: 8, fontStyle: line.npc ? "italic" : "normal" }));
    // Measure the full height first.
    text.setText(line.text);
    // Tips are for the phones: the TV shows only what is read aloud.
    const bodyH = (speaker ? 42 : 0) + text.height;
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
    const full = text.text;
    text.setText("");
    // Lines piling up: type faster – but every line is still read aloud in full.
    const waiting = this.queue.length;
    const pace = waiting >= 4 ? 0.5 : waiting >= 2 ? 0.75 : 1;
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
      // Reading time follows the speech tempo setting.
      const minTime = new Promise<void>((r) => this.time.delayedCall(((1800 + full.length * 45) * pace) / speechRate(), () => r()));
      // Fetch the next line's voice while this one is spoken.
      for (const upcoming of this.queue.slice(0, 2)) prefetchSpeech(upcoming.text, upcoming.npc);
      const voice = speak(line.text, line.npc);
      void Promise.all([minTime, voice]).then(finish);
    });
  }

  /** Messages come one after the other (never on top of each other); the same one twice is shown once. */
  private showBanner(text: string, color?: string, small = false): void {
    if (this.bannerQueue.some((b) => b.text === text)) return;
    this.bannerQueue.push({ text, ...(color ? { color } : {}), small });
    if (!this.bannerBusy) this.nextBanner();
  }

  private nextBanner(): void {
    const b = this.bannerQueue.shift();
    if (!b) {
      this.bannerBusy = false;
      return;
    }
    this.bannerBusy = true;
    this.tweens.killTweensOf(this.banner);
    this.banner
      .setText(b.text)
      .setColor(b.color ?? "#f3e9d2")
      .setFontSize(b.small ? 40 : 64)
      .setAlpha(1)
      .setScale(0.85);
    // Waiting messages make the one on screen go faster.
    // Every message gets time to be read, even when more are waiting.
    const hold = (this.bannerQueue.length ? 1700 : 2200) + Math.min(1500, b.text.length * 25);
    this.tweens.add({ targets: this.banner, scale: 1, duration: 220, ease: "Back.easeOut" });
    this.tweens.add({ targets: this.banner, alpha: 0, delay: hold, duration: 350, onComplete: () => this.nextBanner() });
  }

  /** Opens or closes the log column; the map and everything on it moves along. */
  private setLogOpen(open: boolean): void {
    this.logCloseTimer?.remove(false);
    this.logCloseTimer = undefined;
    if (open) this.logCloseTimer = this.time.delayedCall(20_000, () => this.setLogOpen(false));
    if (open === this.logOpen) return;
    this.logOpen = open;
    const right = this.mapRight();
    for (const [obj, x] of this.anchors) obj.x = x(right);
    const dungeon = this.scene.get("dungeon") as unknown as { setLogOpen?: (open: boolean) => void } | undefined;
    dungeon?.setLogOpen?.(open);
    this.showLog(this.logLines, 0);
    if (!open) this.logBox.removeAll(true);
    this.showNotesLine();
    this.ticker.setVisible(!open);
  }

  /** Log closed: the open task and the clues in one small line under the goal. */
  private showNotesLine(): void {
    const n = this.notes;
    if (this.logOpen || (!n.tasks.length && !n.clues.length)) {
      this.notesLine.setText("");
      return;
    }
    const total = n.tasks.length + n.more;
    const done = n.tasks.filter((t) => t.done).length;
    const parts = [
      total > 1 ? `☑️ ${done} von ${total} erledigt` : "",
      n.clues.length ? `🧩 ${n.clues.length} ${n.clues.length === 1 ? "Hinweis" : "Hinweise"}` : "",
      "📜 Taste L: Protokoll",
    ].filter(Boolean);
    this.notesLine.setText(parts.join("   ·   "));
  }

  /**
   * New log lines while the log is closed: small things (EP, gold, elemental states) wait for the
   * round summary, the rest shows in the one-line ticker at the bottom.
   */
  private takeNews(texts: string[]): void {
    let last: string | undefined;
    for (const t of texts) {
      // Foes' remarks already show as a bubble over the figure.
      if (t.startsWith("💬")) continue;
      const small = summaryOf(t);
      if (small) this.summary.push(small);
      else last = t;
    }
    if (last && Date.now() > this.rollUntil) this.showTicker(last);
    // Without rounds (free exploring) the summary comes after a quiet moment.
    if (this.summary.length && this.round === undefined) {
      this.summaryTimer?.remove(false);
      this.summaryTimer = this.time.delayedCall(6000, () => this.flushSummary());
    }
  }

  private showTicker(text: string): void {
    const box = this.ticker;
    this.tweens.killTweensOf(box);
    box.removeAll(true);
    if (this.logOpen) return;
    const right = this.mapRight();
    const t = this.add.text(right - 40, BOARD_HEIGHT - 70, text.length > 110 ? `${text.slice(0, 107)} …` : text, crisp({ fontFamily: FONT, fontSize: "28px", color: logColor(text), stroke: "#000", strokeThickness: 6 })).setOrigin(1, 1);
    const bg = this.add.graphics();
    bg.fillStyle(0x0d0b09, 0.7).fillRoundedRect(t.x - t.width - 18, t.y - t.height - 8, t.width + 36, t.height + 16, 12);
    box.add([bg, t]);
    box.setAlpha(1);
    this.tweens.add({ targets: box, alpha: 0, delay: 6000, duration: 800 });
  }

  /** "📋 Runde 3: +20 EP · 12 Gold · Goblin 2 brennt" – once, at the end of the round. */
  private flushSummary(round?: number): boolean {
    this.summaryTimer?.remove(false);
    this.summaryTimer = undefined;
    if (!this.summary.length) return false;
    const text = mergeSummary(this.summary);
    this.summary = [];
    this.showBanner(`🔔 ${round !== undefined ? `Runde ${round} vorbei · ` : ""}${text}`, "#ffd75e", true);
    return true;
  }

  private showTurn(name: string, color?: string, free?: boolean, info?: string): void {
    // A roll that was asked for and never thrown (the turn moved on): take the waiting die away.
    if (this.asking) this.clearRollBox();
    this.turnText.setText(free ? `🧭 ${name}` : `▶ ${name} ist dran`);
    // A new round: what happened on the side comes as one short summary.
    const round = /Runde (\d+)/.exec(info ?? "")?.[1];
    const now = round ? Number(round) : undefined;
    if (this.round !== undefined && now !== this.round) this.flushSummary(this.round);
    this.round = now;
    this.turnInfo.setText(info ?? "").setColor("#e0c68a").setData("base", info);
    const w = Math.max(this.turnText.width, this.turnInfo.width + (info ? 130 : 0)) + 60;
    const top = info ? BOARD_HEIGHT - 150 : BOARD_HEIGHT - 110;
    const h = info ? 120 : 80;
    this.turnBox.clear();
    this.turnBox.fillStyle(0x000000, 0.65).fillRoundedRect(20, top, w, h, 16);
    if (color) this.turnBox.fillStyle(Phaser.Display.Color.HexStringToColor(color).color, 1).fillRoundedRect(20, top, 12, h, 6);
  }

  /** Initiative bar on the left edge: portraits in turn order, the active one highlighted. */
  private showOrder(entries: OrderEntry[]): void {
    this.orderBar.removeAll(true);
    // Up to 6 heroes plus their foes: rows shrink so everything fits on the screen.
    const visible = entries.slice(0, 14);
    const row = Math.min(92, Math.floor((BOARD_HEIGHT - 330) / Math.max(1, visible.length)));
    const scale = row / 92;
    visible.forEach((e, i) => {
      const y = i * row;
      const bg = this.add.graphics();
      const edge = e.active ? 0xe0a526 : e.world ? 0x4a6f8f : e.enemy ? 0x8a2a2a : e.color ? Phaser.Display.Color.HexStringToColor(e.color).color : 0x5a4d42;
      bg.fillStyle(e.world ? 0x0f1620 : 0x14110f, e.active ? 0.95 : 0.8).fillRoundedRect(0, y, e.active ? 320 : 290, row - 6, 12);
      bg.lineStyle(e.active ? 5 : 3, edge, 1).strokeRoundedRect(0, y, e.active ? 320 : 290, row - 6, 12);
      this.orderBar.add(bg);
      const frames = e.look ? dollFrames(e.look) : e.monsterId ? [`monster.${e.monsterId}`] : [];
      // (Right at the start the upscaled tiles may not be ready yet: the portrait comes with the next update.)
      const atlas = this.textures.exists(TILES) ? this.textures.get(TILES) : undefined;
      for (const f of frames) if (atlas?.has(f)) this.orderBar.add(this.add.image(44, y + (row - 6) / 2, TILES, f).setScale((2 * scale) / UP));
      if (e.id === "world") this.orderBar.add(this.add.text(44, y + (row - 6) / 2, "🌍", crisp({ fontSize: `${Math.round(44 * scale)}px` })).setOrigin(0.5));
      const name = this.add.text(88, y + 8 * scale, e.id === "world" ? "Die Welt" : e.name, crisp({ fontFamily: FONT, fontSize: `${Math.round(26 * Math.max(0.75, scale))}px`, color: e.health <= 0 ? "#8d8172" : "#f3e9d2", fontStyle: e.active ? "bold" : "normal" }));
      this.orderBar.add(name);
      if (e.initiative !== undefined) this.orderBar.add(this.add.text(e.active ? 300 : 270, y + 8 * scale, String(e.initiative), crisp({ fontFamily: FONT, fontSize: `${Math.round(24 * Math.max(0.75, scale))}px`, color: "#b3a58a" })).setOrigin(1, 0));
      // People and the world: no health bar, just what they are.
      if (e.world) {
        this.orderBar.add(this.add.text(88, y + row - 6 - 30 * Math.max(0.6, scale), e.id === "world" ? "am Rundenende" : "in der Nähe", crisp({ fontFamily: FONT, fontSize: `${Math.round(18 * Math.max(0.75, scale))}px`, color: "#8fb3d0" })));
        return;
      }
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
    // A die still tumbling would keep writing on its (removed) number.
    this.tumbleFlips?.remove(false);
    this.tumbleFlips = undefined;
    clearTimeout(this.tumbling);
    this.tumbling = undefined;
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
    const cx = this.mapRight() / 2 + 60;
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
    if (!this.logOpen) return;
    const x = this.mapRight() + 10;
    const width = LOG_PANEL - 30;
    const top = 20;
    const bottom = BOARD_HEIGHT - 20;
    const bg = this.add.graphics();
    bg.fillStyle(0x0d0b09, 0.88).fillRoundedRect(x, top, width, bottom - top, 18);
    bg.lineStyle(3, 0x5a4d42, 1).strokeRoundedRect(x, top, width, bottom - top, 18);
    box.add(bg);
    // At the top: the scene as a checklist, and the clues found (as small notes).
    let ny = top + 18;
    const n = this.notes;
    if (n.tasks.length) {
      // One line: the task that is open now (and how many are done).
      const open = n.tasks.find((t) => !t.done);
      const done = n.tasks.filter((t) => t.done).length;
      const text = open ? `🎯 ${open.text}` : "🎯 Alles erledigt!";
      const line = this.add.text(x + 22, ny, text, crisp({ fontFamily: FONT, fontSize: "24px", color: "#ffe08a", fontStyle: "bold", wordWrap: { width: width - 44 }, maxLines: 2 }));
      box.add(line);
      ny += line.height + 4;
      const total = n.tasks.length + n.more;
      if (total > 1) {
        box.add(this.add.text(x + 22, ny, `${done} von ${total} erledigt`, crisp({ fontFamily: FONT, fontSize: "18px", color: "#8f8574" })));
        ny += 26;
      }
      ny += 10;
    }
    if (n.clues.length) {
      box.add(this.add.text(x + 22, ny, `🧩 Hinweise (${n.clues.length})`, crisp({ fontFamily: FONT, fontSize: "26px", color: "#e0a526", fontStyle: "bold" })));
      ny += 38;
      for (const c of n.clues.slice(-3)) {
        const t = this.add.text(x + 36, ny + 6, c, crisp({ fontFamily: FONT, fontSize: "19px", color: "#2b2013", wordWrap: { width: width - 72 }, lineSpacing: 2 }));
        const paper = this.add.graphics();
        paper.fillStyle(0xf1dfa6, 0.95).fillRoundedRect(x + 24, ny, width - 48, t.height + 12, 6);
        box.add([paper, t]);
        ny += t.height + 20;
      }
      ny += 4;
    }
    const title = this.add.text(x + 22, ny, "📜 Was ist passiert?", crisp({ fontFamily: FONT, fontSize: "28px", color: "#e0a526", fontStyle: "bold" }));
    box.add(title);
    const texts = lines.map((l) => l.text);
    const fresh = Math.min(added, texts.length);
    let y = bottom - 18;
    const limit = ny + 52;
    // Opened on purpose: the newest twelve, older ones fade.
    for (let i = texts.length - 1; i >= Math.max(0, texts.length - 12); i--) {
      const text = texts[i]!;
      const age = texts.length - 1 - i;
      const t = this.add.text(x + 30, 0, text, crisp({ fontFamily: FONT, fontSize: "22px", color: logColor(text), wordWrap: { width: width - 48 }, lineSpacing: 4 }));
      if (y - t.height < limit) {
        t.destroy();
        break;
      }
      y -= t.height;
      t.setY(y).setAlpha(age === 0 ? 1 : Math.max(0.35, 0.9 - age * 0.14));
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
    if (prompt.plan) {
      const plan = this.add.text(-width + left, y + 4, `🎯 Wenn's klappt: ${prompt.plan}`, crisp({ fontFamily: FONT, fontSize: "26px", color: "#f3e9d2", wordWrap: { width: width - left - 30 } }));
      parts.push(plan);
      y += plan.height + 10;
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
    this.popRollBox();
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
    this.popRollBox();
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

  /**
   * The result as one short card: "🎲 17 → Treffer! · −9 Schaden an Goblin 1 · 💥 Sehr effektiv".
   * The arithmetic stays on the phone of whoever rolled.
   */
  private showRoll(r: RollOutcome): void {
    this.tumbleFlips?.remove(false);
    this.tumbleFlips = undefined;
    this.clearRollBox();
    const width = 780;
    const hasDie = r.dice.length > 0;
    const left = hasDie ? 150 : 30;
    const title = this.add.text(-width + left, 20, r.title, crisp({ fontFamily: FONT, fontSize: "26px", color: "#b3a58a", fontStyle: "bold", wordWrap: { width: width - left - 30 } }));
    const verdict = rollVerdict(r);
    const head = this.add.text(-width + left, 24 + title.height, verdict.text, crisp({ fontFamily: FONT, fontSize: "46px", color: verdict.color, fontStyle: "bold", stroke: "#000", strokeThickness: 6 }));
    const parts: Phaser.GameObjects.Text[] = [head];
    let y = 30 + title.height + head.height;
    // What it did: at most three short points (the rest is in the log and on the phone).
    const points = (r.bullets?.length ? r.bullets.map((b) => ({ text: `${BULLET_ICON[b.tone]} ${b.text}`, color: BULLET_COLOR[b.tone] })) : r.lines.filter((l) => !/= \d+ gegen (RK|SG)/.test(l.text)).slice(0, 1).map((l) => ({ text: l.text, color: TONE.text })))
      .concat(r.lines.filter((l) => /^(💥 Sehr effektiv|🛡️ Nicht sehr effektiv|🚫 Wirkt nicht)/u.test(l.text)).slice(0, 1).map((l) => ({ text: l.text.replace(/ – das merkt ihr euch!$/, ""), color: l.text.startsWith("💥") ? TONE.good : TONE.danger })))
      .slice(0, 3);
    for (const p of points) {
      const t = this.add.text(-width + left, y, p.text, crisp({ fontFamily: FONT, fontSize: "28px", color: p.color, fontStyle: "bold", wordWrap: { width: width - left - 30 } }));
      parts.push(t);
      y += t.height + 4;
    }
    const height = Math.max(hasDie ? 150 : 110, y + 18);
    const bg = this.add.graphics();
    const edge = Phaser.Display.Color.HexStringToColor(verdict.color).color;
    bg.fillStyle(0x14110f, 0.92).fillRoundedRect(-width, 0, width, height, 18);
    bg.lineStyle(6, edge, 1).strokeRoundedRect(-width, 0, width, height, 18);
    this.rollBox.add([bg, title, ...parts]);
    if (hasDie) {
      // The die that counts, big enough to read from the sofa.
      const die = this.add.graphics();
      die.fillStyle(r.crit ? 0xb8860b : 0x7a2e22, 1).fillRoundedRect(-width + 20, 20, 110, 110, 18);
      die.lineStyle(4, 0xf3e9d2, 1).strokeRoundedRect(-width + 20, 20, 110, 110, 18);
      const n = this.add.text(-width + 75, 68, String(r.kept), crisp({ fontFamily: FONT, fontSize: r.kept >= 10 ? "52px" : "62px", fontStyle: "bold", color: "#fff", stroke: "#000", strokeThickness: 6 })).setOrigin(0.5);
      const sides = this.add.text(-width + 75, 116, `W${r.sides}`, crisp({ fontFamily: FONT, fontSize: "18px", color: "#f3e9d2" })).setOrigin(0.5);
      this.rollBox.add([die, n, sides]);
      n.setScale(1.6);
      this.tweens.add({ targets: n, scale: 1, duration: 300, ease: "Back.easeOut" });
    }
    this.popRollBox();
    this.tweens.add({ targets: this.rollBox, alpha: 0, delay: 3200 + points.length * 700, duration: 600 });
  }
}

/** Colour of a log line: green for hits and successes, red for misses and failures. */
function logColor(text: string): string {
  const bullet = (Object.keys(BULLET_ICON) as (keyof typeof BULLET_ICON)[]).find((k) => text.startsWith(`${BULLET_ICON[k]} `));
  if (bullet) return BULLET_COLOR[bullet];
  if (/nicht geschafft|verfehlt|daneben|misslingt|fehlschlag|→ kein treffer|nicht sehr effektiv|wirkt nicht/i.test(text)) return TONE.danger;
  if (/treffer|geschafft|erfolg|kritisch|sehr effektiv/i.test(text)) return TONE.good;
  if (/^(⬆️|✨|💰|🎁|🏆)/u.test(text)) return TONE.reward;
  if (/^(ℹ️|💡|🔎|📚)/u.test(text)) return TONE.info;
  return TONE.text;
}

/** Flash messages in the colour of what they mean. */
function flashColor(text: string): string | undefined {
  if (/Sehr effektiv|Kombo|Stark beschrieben|geschafft/i.test(text)) return TONE.good;
  if (/Nicht sehr effektiv|Wirkt nicht|Gefahr|Achtung/i.test(text)) return TONE.danger;
  return undefined;
}
