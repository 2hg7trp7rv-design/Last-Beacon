import Phaser from "phaser";
import { gameAudio } from "./audio";
import { gameStore, type GameState, type StoreAction } from "./state";

const WORLD_WIDTH = 390;
const WORLD_HEIGHT = 693;
const RENDER_SCALE = window.devicePixelRatio >= 1.5 ? 2 : 1;
const RENDER_WIDTH = WORLD_WIDTH * RENDER_SCALE;
const RENDER_HEIGHT = WORLD_HEIGHT * RENDER_SCALE;

export class LastBeaconScene extends Phaser.Scene {
  private safeFill!: Phaser.GameObjects.Ellipse;
  private safeRing!: Phaser.GameObjects.Ellipse;
  private coreGlow!: Phaser.GameObjects.Ellipse;
  private beam!: Phaser.GameObjects.Rectangle;
  private beacon!: Phaser.GameObjects.Image;
  private workshop!: Phaser.GameObjects.Image;
  private shelter!: Phaser.GameObjects.Image;
  private scrap!: Phaser.GameObjects.Image;
  private workerScrap!: Phaser.GameObjects.Image;
  private workerBattery!: Phaser.GameObjects.Image;
  private civilian!: Phaser.GameObjects.Image;
  private scrapGlow!: Phaser.GameObjects.Ellipse;
  private rescueAura!: Phaser.GameObjects.Ellipse;
  private rescueGlow!: Phaser.GameObjects.Ellipse;
  private unsubscribe: (() => void) | null = null;
  private reducedMotion = false;

  constructor() {
    super("LastBeacon");
  }

  preload(): void {
    this.load.image("world-base", "/assets/world-base.webp");
    this.load.image("beacon", "/assets/beacon-l1.webp");
    this.load.image("workshop", "/assets/workshop.webp");
    this.load.image("shelter", "/assets/shelter.webp");
    this.load.image("scrap", "/assets/scrap-pile.webp");
    this.load.image("worker-scrap", "/assets/worker-scrap.webp");
    this.load.image("worker-battery", "/assets/worker-battery.webp");
    this.load.image("civilian", "/assets/civilian.webp");
  }

  create(): void {
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.cameras.main
      .setBackgroundColor("#020405")
      .setZoom(RENDER_SCALE)
      .centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);

    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, "world-base").setDisplaySize(WORLD_WIDTH, WORLD_HEIGHT);

    this.safeFill = this.add
      .ellipse(195, 383, 356, 280, 0xf2a13b, 0.075)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.coreGlow = this.add
      .ellipse(195, 327, 164, 112, 0xffaa3b, 0.075)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.beam = this.add
      .rectangle(195, 244, 18, 175, 0xffb44c, 0.11)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.drawConstructionPad(71, 493, 76, 36);
    this.drawConstructionPad(311, 482, 76, 36);

    this.add.ellipse(88, 349, 145, 40, 0x000000, 0.42);
    this.add.ellipse(301, 353, 128, 35, 0x000000, 0.42);
    this.add.ellipse(195, 371, 122, 38, 0x000000, 0.48);
    this.add.ellipse(204, 505, 96, 30, 0x000000, 0.42);

    this.workshop = this.add.image(87, 359, "workshop").setOrigin(0.5, 1);
    this.scaleToWidth(this.workshop, 153);
    this.shelter = this.add.image(302, 360, "shelter").setOrigin(0.5, 1);
    this.scaleToWidth(this.shelter, 136);

    this.beacon = this.add.image(195, 384, "beacon").setOrigin(0.5, 1);
    this.scaleToHeight(this.beacon, 166);
    this.beacon.setData("baseScale", this.beacon.scaleX);

    this.scrapGlow = this.add
      .ellipse(204, 495, 98, 46, 0xffa333, 0.1)
      .setStrokeStyle(2, 0xffb44c, 0.72)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scrap = this.add.image(205, 508, "scrap").setOrigin(0.5, 1);
    this.scaleToWidth(this.scrap, 96);
    this.scrap.setData("baseScale", this.scrap.scaleX);
    this.workerScrap = this.add.image(165, 511, "worker-scrap").setOrigin(0.5, 1);
    this.scaleToHeight(this.workerScrap, 94);
    this.workerBattery = this.add.image(279, 427, "worker-battery").setOrigin(0.5, 1);
    this.scaleToHeight(this.workerBattery, 78);

    this.rescueAura = this.add
      .ellipse(202, 577, 82, 126, 0xffaa3b, 0.11)
      .setStrokeStyle(2, 0xffc267, 0.16)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.rescueGlow = this.add
      .ellipse(202, 626, 74, 34, 0xffaa3b, 0.02)
      .setStrokeStyle(2, 0xffb44c, 0.16)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.civilian = this.add.image(202, 633, "civilian").setOrigin(0.5, 1);
    this.scaleToHeight(this.civilian, 112);
    this.civilian.setData("baseScale", this.civilian.scaleX);

    this.safeRing = this.add
      .ellipse(195, 383, 356, 280, 0x000000, 0)
      .setStrokeStyle(3, 0xffae42, 0.82)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.addAtmosphere();
    this.configureInput();
    this.configureAmbientMotion();

    this.renderState(gameStore.getState());
    this.unsubscribe = gameStore.subscribe((state, action) => this.renderState(state, action));
    this.events.once("shutdown", () => this.unsubscribe?.());

    document.body.classList.add("game-ready");
  }

  private configureInput(): void {
    this.scrap.setInteractive({ useHandCursor: true }).on("pointerdown", () => {
      const stage = gameStore.getState().stage;
      const kind = stage === "complete" ? "scavenge" : "collect";
      if (gameStore.perform(kind)) gameAudio.play(kind === "collect" ? "collect" : "tap");
    });

    this.beacon.setInteractive({ useHandCursor: true }).on("pointerdown", () => {
      if (gameStore.perform("upgrade")) gameAudio.play("upgrade");
    });

    this.civilian.setInteractive({ useHandCursor: true }).on("pointerdown", () => {
      if (gameStore.perform("rescue")) gameAudio.play("rescue");
    });
  }

  private configureAmbientMotion(): void {
    if (this.reducedMotion) return;

    const beaconScale = this.beacon.getData("baseScale") as number;
    this.tweens.add({
      targets: this.beacon,
      scaleX: beaconScale * 1.022,
      scaleY: beaconScale * 1.022,
      duration: 920,
      ease: "Sine.InOut",
      yoyo: true,
      repeat: -1
    });
    this.tweens.add({
      targets: this.beam,
      alpha: 0.18,
      duration: 1150,
      ease: "Sine.InOut",
      yoyo: true,
      repeat: -1
    });
    this.tweens.add({
      targets: [this.coreGlow, this.rescueAura],
      scaleX: 1.06,
      scaleY: 1.06,
      duration: 1_150,
      ease: "Sine.InOut",
      yoyo: true,
      repeat: -1
    });
    this.tweens.add({
      targets: this.workerBattery,
      y: this.workerBattery.y - 3,
      duration: 760,
      ease: "Sine.InOut",
      yoyo: true,
      repeat: -1
    });
    this.tweens.add({
      targets: this.workerScrap,
      angle: 1.8,
      duration: 620,
      ease: "Sine.InOut",
      yoyo: true,
      repeat: -1
    });
    this.tweens.add({
      targets: this.civilian,
      angle: -1.6,
      duration: 720,
      ease: "Sine.InOut",
      yoyo: true,
      repeat: -1
    });
  }

  private renderState(state: Readonly<GameState>, action?: StoreAction): void {
    if (action?.kind === "reset") {
      this.scene.restart();
      return;
    }

    const upgraded = state.beaconLevel >= 2;
    const safeScaleX = upgraded ? 1.75 : 1;
    const safeScaleY = safeScaleX;

    if (action?.kind === "upgrade") {
      this.animateUpgrade(safeScaleX, safeScaleY);
    } else {
      this.safeFill.setScale(safeScaleX, safeScaleY);
      this.safeRing.setScale(safeScaleX, safeScaleY);
      this.coreGlow.setScale(upgraded ? 1.18 : 1);
      this.beam.setAlpha(upgraded ? 0.18 : 0.11).setDisplaySize(upgraded ? 22 : 18, 175);
    }

    if (action?.kind === "collect" || action?.kind === "scavenge") {
      this.animateCollection(action.amount ?? 0, state.stage === "complete");
    } else {
      const showScrap = state.stage === "collect" || state.stage === "complete";
      this.scrap.setVisible(showScrap).setAlpha(showScrap ? 1 : 0);
      this.scrapGlow.setVisible(showScrap).setAlpha(showScrap ? 1 : 0);
      this.workerScrap.setVisible(state.stage === "collect").setAlpha(state.stage === "collect" ? 1 : 0);
    }

    if (action?.kind === "rescue") {
      this.animateRescue();
    } else {
      this.civilian.setVisible(!state.civilianRescued).setAlpha(state.civilianRescued ? 0 : 1);
      this.rescueGlow.setVisible(!state.civilianRescued);
      this.rescueAura.setVisible(!state.civilianRescued);
    }

    const rescueReady = state.stage === "rescue";
    if (!state.civilianRescued) {
      this.rescueGlow.setAlpha(rescueReady ? 1 : 0.12);
      this.rescueGlow.setStrokeStyle(2, 0xffb44c, rescueReady ? 0.92 : 0.16);
      this.rescueAura.setAlpha(rescueReady ? 0.62 : 0.07);
      this.rescueAura.setStrokeStyle(2, 0xffc267, rescueReady ? 0.86 : 0.12);
      if (rescueReady) {
        this.civilian.clearTint();
      } else {
        this.civilian.setTint(0x69757b);
      }
    }

    const collectReady = state.stage === "collect";
    this.scrapGlow.setStrokeStyle(2, 0xffb44c, collectReady ? 0.92 : 0.42);
  }

  private animateCollection(amount: number, respawn: boolean): void {
    this.scrap.setVisible(true).setAlpha(1);
    this.scrapGlow.setVisible(true).setAlpha(1);
    const baseScale = this.scrap.getData("baseScale") as number;
    this.floatLabel(this.scrap.x, this.scrap.y - 58, `+${amount} 廃材`, "#ffd07b");
    this.cameras.main.shake(85, 0.0022);

    this.tweens.add({
      targets: [this.scrap, this.scrapGlow],
      alpha: 0,
      scaleX: baseScale * 0.82,
      scaleY: baseScale * 0.82,
      duration: this.reducedMotion ? 150 : 340,
      ease: "Cubic.In",
      onComplete: () => {
        this.scrap.setVisible(false).setScale(baseScale).setAlpha(1);
        this.scrapGlow.setVisible(false).setScale(1).setAlpha(1);
        this.workerScrap.setVisible(false);
        if (respawn) {
          this.time.delayedCall(1_100, () => {
            this.scrap.setVisible(true).setAlpha(0.42);
            this.scrapGlow.setVisible(true).setAlpha(0.34);
          });
        }
      }
    });
  }

  private animateUpgrade(scaleX: number, scaleY: number): void {
    this.cameras.main.flash(230, 255, 179, 72, false, undefined, 0.08);
    this.floatLabel(195, 242, "安全圏 拡大", "#ffe2a1");
    this.tweens.add({
      targets: [this.safeFill, this.safeRing],
      scaleX,
      scaleY,
      duration: this.reducedMotion ? 180 : 680,
      ease: "Cubic.Out"
    });
    this.tweens.add({
      targets: this.beam,
      alpha: 0.3,
      width: 28,
      duration: this.reducedMotion ? 180 : 360,
      ease: "Sine.Out",
      yoyo: true,
      onComplete: () => this.beam.setAlpha(0.18).setDisplaySize(22, 175)
    });
    this.tweens.add({
      targets: this.coreGlow,
      scaleX: 1.18,
      scaleY: 1.18,
      alpha: 0.14,
      duration: this.reducedMotion ? 180 : 680,
      ease: "Cubic.Out"
    });
  }

  private animateRescue(): void {
    this.civilian.setVisible(true).setAlpha(1).clearTint();
    this.rescueGlow.setVisible(true).setAlpha(1);
    this.rescueAura.setVisible(true).setAlpha(0.7);
    this.floatLabel(202, 554, "救助 +1", "#ffe2a1");
    this.tweens.add({
      targets: [this.rescueGlow, this.rescueAura],
      alpha: 0,
      duration: 260
    });
    this.tweens.add({
      targets: this.civilian,
      x: 286,
      y: 445,
      scaleX: (this.civilian.getData("baseScale") as number) * 0.78,
      scaleY: (this.civilian.getData("baseScale") as number) * 0.78,
      alpha: 0,
      duration: this.reducedMotion ? 280 : 1_250,
      ease: "Sine.InOut",
      onComplete: () => this.civilian.setVisible(false)
    });
  }

  private floatLabel(x: number, y: number, copy: string, color: string): void {
    const label = this.add
      .text(x, y, copy, {
        fontFamily: '"LastBeacon JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif',
        fontSize: "17px",
        fontStyle: "bold",
        color,
        stroke: "#090a0a",
        strokeThickness: 5
      })
      .setOrigin(0.5)
      .setDepth(200);

    this.tweens.add({
      targets: label,
      y: y - 34,
      alpha: 0,
      duration: this.reducedMotion ? 450 : 900,
      ease: "Cubic.Out",
      onComplete: () => label.destroy()
    });
  }

  private addAtmosphere(): void {
    for (let index = 0; index < 12; index += 1) {
      const mote = this.add.circle(
        Phaser.Math.Between(18, 372),
        Phaser.Math.Between(90, 620),
        Phaser.Math.Between(1, 2),
        0x8cb4c5,
        Phaser.Math.FloatBetween(0.08, 0.2)
      );
      if (this.reducedMotion) continue;
      this.tweens.add({
        targets: mote,
        y: mote.y - Phaser.Math.Between(24, 60),
        x: mote.x + Phaser.Math.Between(-8, 8),
        alpha: 0,
        duration: Phaser.Math.Between(3_400, 6_200),
        delay: Phaser.Math.Between(0, 2_500),
        repeat: -1
      });
    }
  }

  private drawConstructionPad(x: number, y: number, width: number, height: number): void {
    this.add
      .ellipse(x, y, width, height, 0x1a1c1c, 0.38)
      .setStrokeStyle(1, 0xb97c31, 0.22);
  }

  private scaleToWidth(image: Phaser.GameObjects.Image, width: number): void {
    image.setScale(width / image.width);
  }

  private scaleToHeight(image: Phaser.GameObjects.Image, height: number): void {
    image.setScale(height / image.height);
  }
}

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: RENDER_WIDTH,
  height: RENDER_HEIGHT,
  backgroundColor: "#020405",
  transparent: false,
  render: {
    antialias: true,
    powerPreference: "default",
    pixelArt: false,
    roundPixels: false
  },
  scale: {
    parent: "game",
    width: RENDER_WIDTH,
    height: RENDER_HEIGHT,
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  input: {
    activePointers: 2
  },
  scene: [LastBeaconScene]
};
