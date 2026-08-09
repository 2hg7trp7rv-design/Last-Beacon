import Phaser from "phaser";
import { gameAudio } from "./audio";
import {
  FACILITY_NAMES,
  gameStore,
  type FacilityId,
  type GameState,
  type StoreAction
} from "./state";

const VIEW_WIDTH = 390;
const VIEW_HEIGHT = 693;
const WORLD_WIDTH = 941;
const WORLD_HEIGHT = 1672;
const RENDER_SCALE = window.devicePixelRatio >= 1.5 ? 2 : 1;
const RENDER_WIDTH = VIEW_WIDTH * RENDER_SCALE;
const RENDER_HEIGHT = VIEW_HEIGHT * RENDER_SCALE;
const BASE_ZOOM = RENDER_SCALE;
const MIN_ZOOM = BASE_ZOOM * 0.82;
const MAX_ZOOM = BASE_ZOOM * 1.34;
const TAP_DISTANCE = 13 * RENDER_SCALE;
const PAN_TUTORIAL_DISTANCE = 95;

interface FacilityPoint {
  id: FacilityId;
  x: number;
  y: number;
  radius: number;
}

interface PointerTrack {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  travelled: number;
}

interface PinchState {
  distance: number;
  zoom: number;
  anchorWorldX: number;
  anchorWorldY: number;
}

const FACILITIES: FacilityPoint[] = [
  { id: "gate", x: 516, y: 208, radius: 95 },
  { id: "shelter", x: 266, y: 414, radius: 112 },
  { id: "relay", x: 687, y: 618, radius: 108 },
  { id: "beacon", x: 493, y: 846, radius: 105 },
  { id: "workshop", x: 221, y: 1074, radius: 120 },
  { id: "greenhouse", x: 698, y: 1206, radius: 122 }
];

export class LastBeaconScene extends Phaser.Scene {
  private beacon!: Phaser.GameObjects.Image;
  private workshop!: Phaser.GameObjects.Image;
  private shelter!: Phaser.GameObjects.Image;
  private greenhouse!: Phaser.GameObjects.Image;
  private relay!: Phaser.GameObjects.Image;
  private civilian!: Phaser.GameObjects.Image;
  private scrap!: Phaser.GameObjects.Image;
  private workerScrap!: Phaser.GameObjects.Image;
  private workerBattery!: Phaser.GameObjects.Image;
  private beaconGlow!: Phaser.GameObjects.Ellipse;
  private targetRing!: Phaser.GameObjects.Ellipse;
  private targetLabel!: Phaser.GameObjects.Text;
  private targetArrow!: Phaser.GameObjects.Text;
  private targetArrowBaseY = 0;
  private targetId: FacilityId | null = null;
  private labels = new Map<FacilityId, Phaser.GameObjects.Text>();
  private pointerTracks = new Map<number, PointerTrack>();
  private pinch: PinchState | null = null;
  private inertiaX = 0;
  private inertiaY = 0;
  private tutorialPanDistance = 0;
  private suppressTapUntil = 0;
  private inputLocked = false;
  private guideCopy = "";
  private unsubscribe: (() => void) | null = null;
  private reducedMotion = false;

  private readonly focusListener = (event: Event): void => {
    const facility = (event as CustomEvent<{ facility?: FacilityId }>).detail?.facility;
    if (!facility) return;
    const point = FACILITIES.find((entry) => entry.id === facility);
    if (!point) return;
    this.resetGesture();
    this.cameras.main.centerOn(point.x, point.y);
  };

  private readonly lockListener = (event: Event): void => {
    this.inputLocked = Boolean((event as CustomEvent<{ locked?: boolean }>).detail?.locked);
    if (this.inputLocked) this.resetGesture();
  };

  constructor() {
    super("LastBeacon");
  }

  preload(): void {
    this.load.image("world-map", "/assets/world-map.webp");
    this.load.image("beacon", "/assets/beacon-l1.webp");
    this.load.image("workshop", "/assets/workshop.webp");
    this.load.image("shelter", "/assets/shelter.webp");
    this.load.image("greenhouse", "/assets/greenhouse.webp");
    this.load.image("relay", "/assets/power-relay.webp");
    this.load.image("scrap", "/assets/scrap-pile.webp");
    this.load.image("worker-scrap", "/assets/worker-scrap.webp");
    this.load.image("worker-battery", "/assets/worker-battery.webp");
    this.load.image("civilian", "/assets/civilian.webp");
  }

  create(): void {
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const camera = this.cameras.main;
    camera
      .setBackgroundColor("#020405")
      .setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
      .setZoom(BASE_ZOOM)
      .centerOn(493, 846);

    this.add.image(0, 0, "world-map").setOrigin(0).setDisplaySize(WORLD_WIDTH, WORLD_HEIGHT).setDepth(0);
    this.addWorldLighting();
    this.addFacilities();
    this.addTargetGuide();
    this.addAtmosphere();
    this.configureInput();
    this.configureAmbientMotion();

    this.renderState(gameStore.getState());
    this.unsubscribe = gameStore.subscribe((state, action) => this.renderState(state, action));

    window.addEventListener("lastbeacon:focus", this.focusListener);
    window.addEventListener("lastbeacon:input-lock", this.lockListener);
    window.addEventListener("blur", this.resetGesture);
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.events.once("shutdown", () => {
      this.unsubscribe?.();
      window.removeEventListener("lastbeacon:focus", this.focusListener);
      window.removeEventListener("lastbeacon:input-lock", this.lockListener);
      window.removeEventListener("blur", this.resetGesture);
      document.removeEventListener("visibilitychange", this.handleVisibility);
    });

    document.body.classList.add("game-ready");
  }

  update(time: number, delta: number): void {
    if (!this.inputLocked && this.pointerTracks.size === 0 && !this.pinch) {
      const decay = Math.pow(0.86, delta / 16.67);
      if (Math.abs(this.inertiaX) > 0.02 || Math.abs(this.inertiaY) > 0.02) {
        this.cameras.main.scrollX += this.inertiaX;
        this.cameras.main.scrollY += this.inertiaY;
        this.clampCamera();
        this.inertiaX *= decay;
        this.inertiaY *= decay;
      } else {
        this.inertiaX = 0;
        this.inertiaY = 0;
      }
    }
    if (this.targetArrow.visible) {
      this.targetArrow.y = this.targetArrowBaseY + (this.reducedMotion ? 0 : Math.sin(time / 210) * 5);
    }
    this.updateGuide();
  }

  private addWorldLighting(): void {
    this.add
      .ellipse(493, 845, 390, 300, 0xf4a842, 0.07)
      .setStrokeStyle(3, 0xffb64f, 0.28)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(4);
    this.beaconGlow = this.add
      .ellipse(493, 806, 190, 150, 0xffa733, 0.1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(5);
    this.add
      .rectangle(493, 684, 24, 330, 0xffb64a, 0.095)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(5);
  }

  private addFacilities(): void {
    this.add.ellipse(493, 865, 190, 58, 0x000000, 0.5).setDepth(9);
    this.beacon = this.add.image(493, 895, "beacon").setOrigin(0.5, 1).setDepth(12);
    this.scaleToHeight(this.beacon, 210);

    this.add.ellipse(221, 1087, 250, 70, 0x000000, 0.54).setDepth(10);
    this.workshop = this.add.image(221, 1120, "workshop").setOrigin(0.5, 1).setDepth(13);
    this.scaleToWidth(this.workshop, 235);
    this.scrap = this.add.image(303, 1100, "scrap").setOrigin(0.5, 1).setDepth(14);
    this.scaleToWidth(this.scrap, 86);
    this.workerScrap = this.add.image(165, 1121, "worker-scrap").setOrigin(0.5, 1).setDepth(15);
    this.scaleToHeight(this.workerScrap, 88);

    this.add.ellipse(266, 426, 235, 62, 0x000000, 0.52).setDepth(7);
    this.shelter = this.add.image(266, 452, "shelter").setOrigin(0.5, 1).setDepth(10);
    this.scaleToWidth(this.shelter, 225);

    this.add.ellipse(698, 1224, 264, 74, 0x000000, 0.54).setDepth(11);
    this.greenhouse = this.add.image(698, 1257, "greenhouse").setOrigin(0.5, 1).setDepth(14);
    this.scaleToWidth(this.greenhouse, 252);

    this.add.ellipse(687, 637, 235, 66, 0x000000, 0.54).setDepth(8);
    this.relay = this.add.image(687, 672, "relay").setOrigin(0.5, 1).setDepth(11);
    this.scaleToWidth(this.relay, 225);
    this.workerBattery = this.add.image(612, 666, "worker-battery").setOrigin(0.5, 1).setDepth(12);
    this.scaleToHeight(this.workerBattery, 82);

    this.add
      .ellipse(516, 238, 128, 62, 0xffaa3b, 0.05)
      .setStrokeStyle(2, 0xffbd61, 0.25)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(6);
    this.civilian = this.add.image(516, 277, "civilian").setOrigin(0.5, 1).setDepth(12);
    this.scaleToHeight(this.civilian, 118);

    this.addFacilityLabel("gate", 516, 292);
    this.addFacilityLabel("shelter", 266, 469);
    this.addFacilityLabel("relay", 687, 690);
    this.addFacilityLabel("beacon", 493, 914);
    this.addFacilityLabel("workshop", 221, 1139);
    this.addFacilityLabel("greenhouse", 698, 1277);
  }

  private addFacilityLabel(id: FacilityId, x: number, y: number): void {
    const label = this.add
      .text(x, y, FACILITY_NAMES[id], {
        fontFamily: '"LastBeacon JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif',
        fontSize: "14px",
        fontStyle: "bold",
        color: "#f5dfb4",
        backgroundColor: "rgba(5, 8, 9, 0.84)",
        padding: { x: 8, y: 4 },
        stroke: "#080a0b",
        strokeThickness: 3
      })
      .setOrigin(0.5, 0)
      .setDepth(30);
    this.labels.set(id, label);
  }

  private addTargetGuide(): void {
    this.targetRing = this.add
      .ellipse(0, 0, 150, 78, 0xffaa33, 0.07)
      .setStrokeStyle(4, 0xffbd5e, 0.9)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(40)
      .setVisible(false);
    this.targetArrow = this.add
      .text(0, 0, "↓", {
        fontFamily: "ui-monospace, monospace",
        fontSize: "42px",
        fontStyle: "bold",
        color: "#ffd073",
        stroke: "#050607",
        strokeThickness: 6
      })
      .setOrigin(0.5, 1)
      .setDepth(42)
      .setVisible(false);
    this.targetLabel = this.add
      .text(0, 0, "", {
        fontFamily: '"LastBeacon JP", "Yu Gothic", system-ui, sans-serif',
        fontSize: "13px",
        fontStyle: "bold",
        color: "#ffe4ad",
        backgroundColor: "rgba(5, 7, 8, 0.9)",
        padding: { x: 8, y: 5 },
        stroke: "#050607",
        strokeThickness: 3
      })
      .setOrigin(0.5, 0)
      .setDepth(42)
      .setVisible(false);
  }

  private configureInput(): void {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.inputLocked) return;
      this.inertiaX = 0;
      this.inertiaY = 0;
      this.pointerTracks.set(pointer.id, {
        startX: pointer.x,
        startY: pointer.y,
        lastX: pointer.x,
        lastY: pointer.y,
        travelled: 0
      });
      if (this.pointerTracks.size >= 2) {
        this.beginPinch();
        this.suppressTapUntil = performance.now() + 260;
      }
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.inputLocked || !pointer.isDown) return;
      const track = this.pointerTracks.get(pointer.id);
      if (!track) return;
      const deltaX = pointer.x - track.lastX;
      const deltaY = pointer.y - track.lastY;
      track.lastX = pointer.x;
      track.lastY = pointer.y;
      track.travelled += Math.hypot(deltaX, deltaY);

      if (this.pointerTracks.size >= 2) {
        this.updatePinch();
        return;
      }
      if (this.pinch) return;

      const camera = this.cameras.main;
      const worldDeltaX = -deltaX / camera.zoom;
      const worldDeltaY = -deltaY / camera.zoom;
      camera.scrollX += worldDeltaX;
      camera.scrollY += worldDeltaY;
      this.clampCamera();
      this.inertiaX = worldDeltaX * 0.72;
      this.inertiaY = worldDeltaY * 0.72;

      if (track.travelled > TAP_DISTANCE) {
        this.tutorialPanDistance += Math.hypot(worldDeltaX, worldDeltaY);
        if (this.tutorialPanDistance >= PAN_TUTORIAL_DISTANCE) {
          gameStore.perform({ kind: "pan" });
        }
      }
    });

    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => this.finishPointer(pointer, pointer.wasCanceled));
    this.input.on("pointerupoutside", (pointer: Phaser.Input.Pointer) => this.finishPointer(pointer, pointer.wasCanceled));
    this.input.on("pointercancel", (pointer: Phaser.Input.Pointer) => this.finishPointer(pointer, true));
  }

  private beginPinch(): void {
    const pair = this.getPointerPair();
    if (!pair) return;
    const [first, second] = pair;
    const midX = (first.lastX + second.lastX) / 2;
    const midY = (first.lastY + second.lastY) / 2;
    const camera = this.cameras.main;
    const anchor = camera.getWorldPoint(midX, midY);
    this.pinch = {
      distance: Math.max(Math.hypot(first.lastX - second.lastX, first.lastY - second.lastY), 1),
      zoom: camera.zoom,
      anchorWorldX: anchor.x,
      anchorWorldY: anchor.y
    };
    this.inertiaX = 0;
    this.inertiaY = 0;
  }

  private updatePinch(): void {
    const pair = this.getPointerPair();
    if (!pair) return;
    if (!this.pinch) this.beginPinch();
    if (!this.pinch) return;
    const [first, second] = pair;
    const distance = Math.max(Math.hypot(first.lastX - second.lastX, first.lastY - second.lastY), 1);
    const midX = (first.lastX + second.lastX) / 2;
    const midY = (first.lastY + second.lastY) / 2;
    const camera = this.cameras.main;
    const zoom = Phaser.Math.Clamp(this.pinch.zoom * (distance / this.pinch.distance), MIN_ZOOM, MAX_ZOOM);
    camera.setZoom(zoom);
    const originX = camera.width * camera.originX;
    const originY = camera.height * camera.originY;
    camera.scrollX = this.pinch.anchorWorldX - originX - (midX - originX) / zoom;
    camera.scrollY = this.pinch.anchorWorldY - originY - (midY - originY) / zoom;
    this.clampCamera();
    this.suppressTapUntil = performance.now() + 260;
  }

  private finishPointer(pointer: Phaser.Input.Pointer, cancelled = false): void {
    const track = this.pointerTracks.get(pointer.id);
    const wasPinching = this.pinch !== null || this.pointerTracks.size > 1;
    this.pointerTracks.delete(pointer.id);

    if (wasPinching) {
      this.suppressTapUntil = performance.now() + 260;
      this.pinch = null;
      const remaining = [...this.pointerTracks.values()][0];
      if (remaining) {
        remaining.startX = remaining.lastX;
        remaining.startY = remaining.lastY;
        remaining.travelled = TAP_DISTANCE + 1;
      }
      return;
    }

    if (
      !cancelled &&
      track &&
      track.travelled < TAP_DISTANCE &&
      performance.now() >= this.suppressTapUntil &&
      !this.inputLocked
    ) {
      this.trySelectAt(pointer.x, pointer.y);
    }
  }

  private trySelectAt(screenX: number, screenY: number): void {
    const camera = this.cameras.main;
    const world = camera.getWorldPoint(screenX, screenY);
    const hit = FACILITIES
      .map((facility) => ({ facility, distance: Math.hypot(world.x - facility.x, world.y - facility.y) }))
      .filter(({ facility, distance }) => distance <= facility.radius)
      .sort((a, b) => a.distance - b.distance)[0]?.facility;
    if (!hit) return;
    this.handleFacilityTap(hit.id);
  }

  private handleFacilityTap(id: FacilityId): void {
    const state = gameStore.getState();
    if (id === "workshop" && state.stage === "collect") {
      if (gameStore.perform({ kind: "collect" })) {
        gameAudio.play("collect");
        return;
      }
    }
    if (id === "beacon" && state.stage === "upgrade") {
      if (gameStore.perform({ kind: "upgrade", facility: "beacon" })) {
        gameAudio.play("upgrade");
        return;
      }
    }
    if (id === "gate" && state.stage === "rescue") {
      if (gameStore.perform({ kind: "rescue" })) {
        gameAudio.play("rescue");
        return;
      }
    }
    gameAudio.play("tap");
    window.dispatchEvent(new CustomEvent("lastbeacon:select", { detail: { facility: id } }));
  }

  private renderState(state: Readonly<GameState>, action?: StoreAction): void {
    if (action?.kind === "reset") {
      this.scene.restart();
      return;
    }

    this.civilian.setVisible(!state.civilianRescued);
    this.labels.get("gate")?.setText(state.civilianRescued ? FACILITY_NAMES.gate : "取り残された生存者");
    for (const id of ["beacon", "workshop", "shelter", "greenhouse", "relay"] as const) {
      this.labels.get(id)?.setText(`${FACILITY_NAMES[id]}  Lv.${state.levels[id]}`);
    }

    const beaconScale = 1 + (state.levels.beacon - 1) * 0.12;
    this.beaconGlow.setScale(beaconScale).setAlpha(0.1 + state.levels.beacon * 0.018);

    if (action?.kind === "collect") this.animateCollection(action.amount ?? 0);
    if (action?.kind === "upgrade") this.animateUpgrade(action.facility ?? "beacon");
    if (action?.kind === "rescue") this.animateRescue();
    if (action?.kind === "assign") {
      this.floatLabel(698, 1090, action.amount === 1 ? "住民を配属" : "配属を解除", "#cbed8a");
    }
    if (action?.kind === "claim") this.floatLabel(516, 154, "探索物資を回収", "#ffe09c");

    this.setTutorialTarget(state);
  }

  private setTutorialTarget(state: Readonly<GameState>): void {
    if (state.stage === "pan") this.targetId = null;
    else if (state.stage === "collect") this.targetId = "workshop";
    else if (state.stage === "upgrade") this.targetId = "beacon";
    else if (state.stage === "rescue") this.targetId = "gate";
    else if (state.stage === "assign") this.targetId = "greenhouse";
    else if (state.levels.beacon < 3) this.targetId = "beacon";
    else if (state.explored === 0) this.targetId = "gate";
    else this.targetId = null;

    if (!this.targetId) {
      this.targetRing.setVisible(false);
      this.targetLabel.setVisible(false);
      this.targetArrow.setVisible(false);
      return;
    }
    const point = FACILITIES.find((facility) => facility.id === this.targetId);
    if (!point) return;
    const labelY = point.y - point.radius - 30;
    this.targetRing.setPosition(point.x, point.y).setDisplaySize(point.radius * 1.65, point.radius * 0.92).setVisible(true);
    this.targetArrowBaseY = labelY + 6;
    this.targetArrow.setPosition(point.x, this.targetArrowBaseY).setVisible(true);
    this.targetLabel.setPosition(point.x, labelY + 8).setText(this.targetCopy(state)).setVisible(true);
  }

  private targetCopy(state: Readonly<GameState>): string {
    if (state.stage === "collect") return "廃材を回収";
    if (state.stage === "upgrade") return "灯火を強化";
    if (state.stage === "rescue") return "生存者を救助";
    if (state.stage === "assign") return "温室を選択";
    if (state.levels.beacon < 3) return "Lv.3へ強化";
    return state.expeditionReadyAt > 0 ? "探索隊の帰還地点" : "探索隊を派遣";
  }

  private updateGuide(): void {
    const state = gameStore.getState();
    let copy = "ドラッグで拠点を見回す · 2本指で拡大縮小";
    if (this.targetId) {
        const target = FACILITIES.find((facility) => facility.id === this.targetId);
      if (target) {
        const camera = this.cameras.main;
        const centerX = camera.midPoint.x;
        const centerY = camera.midPoint.y;
        const dx = target.x - centerX;
        const dy = target.y - centerY;
        const visibleX = camera.width / (2 * camera.zoom) - 75;
        const visibleY = camera.height / (2 * camera.zoom) - 145;
        if (Math.abs(dx) < visibleX && Math.abs(dy) < visibleY) {
          copy = `${FACILITY_NAMES[this.targetId]}をタップ`;
        } else {
          const vertical = Math.abs(dy) >= Math.abs(dx);
          const arrow = vertical ? (dy > 0 ? "↓" : "↑") : (dx > 0 ? "→" : "←");
          copy = `${arrow} ${FACILITY_NAMES[this.targetId]}へ移動`;
        }
      }
    } else if (state.stage === "free" && state.explored > 0) {
      copy = "施設を選び、配属と強化を続ける";
    }
    if (copy === this.guideCopy) return;
    this.guideCopy = copy;
    window.dispatchEvent(new CustomEvent("lastbeacon:guide", { detail: { copy } }));
  }

  private animateCollection(amount: number): void {
    this.floatLabel(this.workshop.x, this.workshop.y - 170, `廃材 +${amount}`, "#ffd07b");
    this.cameras.main.shake(90, 0.0014);
    const originalScale = this.scrap.scaleX;
    this.tweens.add({
      targets: this.scrap,
      scaleX: originalScale * 1.16,
      scaleY: originalScale * 1.16,
      duration: this.reducedMotion ? 80 : 180,
      yoyo: true,
      ease: "Cubic.Out"
    });
  }

  private animateUpgrade(facility: FacilityId): void {
    const point = FACILITIES.find((entry) => entry.id === facility) ?? FACILITIES[3];
    this.cameras.main.flash(240, 255, 181, 73, false, undefined, 0.08);
    this.floatLabel(point.x, point.y - point.radius, "施設レベル上昇", "#ffe2a1");
    if (facility === "beacon") {
      this.tweens.add({
        targets: this.beaconGlow,
        scaleX: this.beaconGlow.scaleX * 1.18,
        scaleY: this.beaconGlow.scaleY * 1.18,
        alpha: 0.22,
        duration: this.reducedMotion ? 120 : 520,
        yoyo: true,
        ease: "Sine.Out"
      });
    }
  }

  private animateRescue(): void {
    this.civilian.setVisible(true).setAlpha(1);
    this.floatLabel(516, 143, "救助 +1", "#ffe2a1");
    this.tweens.add({
      targets: this.civilian,
      y: this.civilian.y - 35,
      alpha: 0,
      duration: this.reducedMotion ? 180 : 620,
      ease: "Sine.In",
      onComplete: () => this.civilian.setVisible(false)
    });
  }

  private configureAmbientMotion(): void {
    if (this.reducedMotion) return;
    this.tweens.add({
      targets: [this.beaconGlow, this.targetRing],
      alpha: "+=0.07",
      duration: 1_050,
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
      targets: this.workerBattery,
      y: this.workerBattery.y - 4,
      duration: 780,
      ease: "Sine.InOut",
      yoyo: true,
      repeat: -1
    });
  }

  private addAtmosphere(): void {
    for (let index = 0; index < 30; index += 1) {
      const mote = this.add.circle(
        Phaser.Math.Between(30, WORLD_WIDTH - 30),
        Phaser.Math.Between(40, WORLD_HEIGHT - 40),
        Phaser.Math.Between(1, 3),
        0x9bb4bd,
        Phaser.Math.FloatBetween(0.06, 0.18)
      ).setDepth(35);
      if (this.reducedMotion) continue;
      this.tweens.add({
        targets: mote,
        y: mote.y - Phaser.Math.Between(35, 95),
        x: mote.x + Phaser.Math.Between(-15, 15),
        alpha: 0,
        duration: Phaser.Math.Between(4_000, 8_000),
        delay: Phaser.Math.Between(0, 3_000),
        repeat: -1
      });
    }
  }

  private floatLabel(x: number, y: number, copy: string, color: string): void {
    const label = this.add
      .text(x, y, copy, {
        fontFamily: '"LastBeacon JP", "Yu Gothic", system-ui, sans-serif',
        fontSize: "18px",
        fontStyle: "bold",
        color,
        stroke: "#090a0a",
        strokeThickness: 5
      })
      .setOrigin(0.5)
      .setDepth(80);
    this.tweens.add({
      targets: label,
      y: y - 42,
      alpha: 0,
      duration: this.reducedMotion ? 420 : 980,
      ease: "Cubic.Out",
      onComplete: () => label.destroy()
    });
  }

  private getPointerPair(): [PointerTrack, PointerTrack] | null {
    const pair = [...this.pointerTracks.values()].slice(0, 2);
    return pair.length === 2 ? [pair[0], pair[1]] : null;
  }

  private clampCamera(): void {
    const camera = this.cameras.main;
    camera.scrollX = camera.clampX(camera.scrollX);
    camera.scrollY = camera.clampY(camera.scrollY);
  }

  private readonly resetGesture = (): void => {
    this.pointerTracks.clear();
    this.pinch = null;
    this.inertiaX = 0;
    this.inertiaY = 0;
    this.suppressTapUntil = performance.now() + 220;
  };

  private readonly handleVisibility = (): void => {
    if (document.visibilityState !== "visible") this.resetGesture();
  };

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
    activePointers: 3
  },
  scene: [LastBeaconScene]
};
