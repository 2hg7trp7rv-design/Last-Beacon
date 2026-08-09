export type TutorialStage = "pan" | "collect" | "upgrade" | "rescue" | "assign" | "free";
export type FacilityId = "beacon" | "workshop" | "shelter" | "greenhouse" | "relay" | "gate";
export type UpgradableFacility = Exclude<FacilityId, "gate">;
export type WorkerFacility = "workshop" | "greenhouse" | "relay";

export interface FacilityLevels {
  beacon: number;
  workshop: number;
  shelter: number;
  greenhouse: number;
  relay: number;
}

export interface WorkerAssignments {
  workshop: number;
  greenhouse: number;
  relay: number;
}

export interface ResourceBundle {
  power: number;
  scrap: number;
  food: number;
}

export interface GameState {
  version: 2;
  power: number;
  scrap: number;
  food: number;
  population: number;
  capacity: number;
  stage: TutorialStage;
  levels: FacilityLevels;
  assignments: WorkerAssignments;
  civilianRescued: boolean;
  explored: number;
  expeditionReadyAt: number;
  nextManualCollectAt: number;
  lastTickAt: number;
  savedAt: number;
}

export type GameCommand =
  | { kind: "pan" }
  | { kind: "collect" }
  | { kind: "upgrade"; facility: UpgradableFacility }
  | { kind: "rescue" }
  | { kind: "assign"; facility: WorkerFacility; delta: 1 | -1 }
  | { kind: "dispatch" }
  | { kind: "claim" }
  | { kind: "reset" };

export type StoreActionKind = GameCommand["kind"] | "produce" | "offline";

export interface StoreAction {
  kind: StoreActionKind;
  facility?: FacilityId;
  amount?: number;
  resources?: ResourceBundle;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type StoreListener = (state: Readonly<GameState>, action: StoreAction) => void;

const STORAGE_KEY = "last-beacon-save-v2";
const LEGACY_STORAGE_KEY = "last-beacon-save-v1";
const PRODUCTION_STEP_MS = 15_000;
const OFFLINE_CAP_MS = 4 * 60 * 60 * 1_000;
const EXPEDITION_MS = 20_000;
const MANUAL_COLLECT_MS = 5_000;
export const MAX_FACILITY_LEVEL = 20;

const EMPTY_RESOURCES: ResourceBundle = { power: 0, scrap: 0, food: 0 };

export const FACILITY_NAMES: Record<FacilityId, string> = {
  beacon: "最後の灯火",
  workshop: "回収工房",
  shelter: "居住シェルター",
  greenhouse: "食料温室",
  relay: "送電リレー",
  gate: "北部ゲート"
};

export function createInitialState(now = Date.now()): GameState {
  return {
    version: 2,
    power: 80,
    scrap: 12,
    food: 8,
    population: 2,
    capacity: 4,
    stage: "pan",
    levels: { beacon: 1, workshop: 1, shelter: 1, greenhouse: 1, relay: 1 },
    assignments: { workshop: 1, greenhouse: 0, relay: 1 },
    civilianRescued: false,
    explored: 0,
    expeditionReadyAt: 0,
    nextManualCollectAt: 0,
    lastTickAt: now,
    savedAt: now
  };
}

export function getUpgradeCost(facility: UpgradableFacility, level: number): number {
  if (facility === "beacon") {
    if (level === 1) return 20;
    return 30 + Math.max(level - 2, 0) * 20;
  }
  if (facility === "shelter") return 22 + Math.max(level - 1, 0) * 16;
  return 18 + Math.max(level - 1, 0) * 14;
}

export function getProductionPerMinute(state: Readonly<GameState>): ResourceBundle {
  return {
    scrap: state.assignments.workshop * state.levels.workshop * 8,
    food: state.assignments.greenhouse * state.levels.greenhouse * 4,
    power: state.assignments.relay * state.levels.relay * 4
  };
}

export function getWaitingPopulation(state: Readonly<GameState>): number {
  const assigned = state.assignments.workshop + state.assignments.greenhouse + state.assignments.relay;
  return Math.max(state.population - assigned, 0);
}

function isStage(value: unknown): value is TutorialStage {
  return value === "pan" || value === "collect" || value === "upgrade" || value === "rescue" ||
    value === "assign" || value === "free";
}

function isWholeNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function isLevelSet(value: unknown): value is FacilityLevels {
  if (!value || typeof value !== "object") return false;
  const levels = value as Partial<FacilityLevels>;
  return isWholeNumber(levels.beacon, 1, MAX_FACILITY_LEVEL) &&
    isWholeNumber(levels.workshop, 1, MAX_FACILITY_LEVEL) &&
    isWholeNumber(levels.shelter, 1, MAX_FACILITY_LEVEL) &&
    isWholeNumber(levels.greenhouse, 1, MAX_FACILITY_LEVEL) &&
    isWholeNumber(levels.relay, 1, MAX_FACILITY_LEVEL);
}

function isAssignmentSet(value: unknown): value is WorkerAssignments {
  if (!value || typeof value !== "object") return false;
  const assignments = value as Partial<WorkerAssignments>;
  return isWholeNumber(assignments.workshop, 0, 999) && isWholeNumber(assignments.greenhouse, 0, 999) &&
    isWholeNumber(assignments.relay, 0, 999);
}

function isSavedState(value: unknown): value is GameState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GameState>;
  if (
    candidate.version !== 2 ||
    !isWholeNumber(candidate.power, 0, 1_000_000_000) ||
    !isWholeNumber(candidate.scrap, 0, 1_000_000_000) ||
    !isWholeNumber(candidate.food, 0, 1_000_000_000) ||
    !isWholeNumber(candidate.population, 0, 999) ||
    !isWholeNumber(candidate.capacity, 1, 999) ||
    !isStage(candidate.stage) ||
    !isLevelSet(candidate.levels) ||
    !isAssignmentSet(candidate.assignments) ||
    typeof candidate.civilianRescued !== "boolean" ||
    !isWholeNumber(candidate.explored, 0, 1_000_000) ||
    !isWholeNumber(candidate.expeditionReadyAt, 0, Number.MAX_SAFE_INTEGER) ||
    !isWholeNumber(candidate.nextManualCollectAt, 0, Number.MAX_SAFE_INTEGER) ||
    !isWholeNumber(candidate.lastTickAt, 1, Number.MAX_SAFE_INTEGER) ||
    !isWholeNumber(candidate.savedAt, 1, Number.MAX_SAFE_INTEGER)
  ) return false;

  const state = candidate as GameState;
  const assigned = state.assignments.workshop + state.assignments.greenhouse + state.assignments.relay;
  const expectedCapacity = 4 + (state.levels.shelter - 1) * 2;
  if (state.population > state.capacity || assigned > state.population || state.capacity !== expectedCapacity) return false;
  if ((state.stage === "pan" || state.stage === "collect" || state.stage === "upgrade") && state.levels.beacon !== 1) return false;
  if ((state.stage === "rescue" || state.stage === "assign") && state.levels.beacon !== 2) return false;
  if (state.stage === "upgrade" && state.scrap < 20) return false;
  if (state.stage === "rescue" && (state.power < 4 || state.population >= state.capacity)) return false;
  if (state.stage === "assign" && (!state.civilianRescued || state.population < 3)) return false;
  if (state.stage === "assign" && getWaitingPopulation(state) < 1) return false;
  if (state.stage === "free" && !state.civilianRescued) return false;
  return true;
}

function migrateLegacy(value: unknown, now: number): GameState | null {
  if (!value || typeof value !== "object") return null;
  const legacy = value as Record<string, unknown>;
  if (legacy.version !== 1) return null;

  const migrated = createInitialState(now);
  if (isWholeNumber(legacy.power, 0, 1_000_000_000)) migrated.power = legacy.power;
  if (isWholeNumber(legacy.scrap, 0, 1_000_000_000)) migrated.scrap = legacy.scrap;
  if (isWholeNumber(legacy.food, 0, 1_000_000_000)) migrated.food = legacy.food;
  if (isWholeNumber(legacy.population, 0, 4)) migrated.population = legacy.population;

  if (legacy.stage === "upgrade") {
    migrated.stage = "upgrade";
    migrated.scrap = Math.max(migrated.scrap, 20);
  }
  if (legacy.stage === "rescue") {
    migrated.stage = "rescue";
    migrated.levels.beacon = 2;
    migrated.power = Math.max(migrated.power, 4);
    migrated.population = Math.min(migrated.population, migrated.capacity - 1);
  }
  if (legacy.stage === "complete") {
    migrated.stage = "free";
    migrated.levels.beacon = 2;
    migrated.population = Math.max(migrated.population, 3);
    migrated.assignments.greenhouse = 1;
    migrated.civilianRescued = true;
  }
  return migrated;
}

export class GameStore {
  private state: GameState;
  private listeners = new Set<StoreListener>();
  private offlineReward: ResourceBundle = { ...EMPTY_RESOURCES };

  constructor(
    private readonly storage: StorageLike,
    private readonly clock: () => number = Date.now
  ) {
    this.state = this.load();
    this.offlineReward = this.reconcileOffline(this.clock(), false);
  }

  getState(): Readonly<GameState> {
    return this.state;
  }

  getOfflineReward(): Readonly<ResourceBundle> {
    return this.offlineReward;
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  perform(command: GameCommand): boolean {
    const now = this.clock();
    const production = this.produceUntil(now);
    if (production.power || production.scrap || production.food) {
      this.state.savedAt = now;
      this.persist();
      this.emit({ kind: "produce", resources: production });
    }

    if (command.kind === "pan") {
      if (this.state.stage !== "pan") return false;
      this.state.stage = "collect";
      return this.commit({ kind: "pan" });
    }

    if (command.kind === "collect") {
      if (this.state.stage === "collect") {
        this.state.scrap += 8;
        this.state.stage = "upgrade";
        return this.commit({ kind: "collect", amount: 8, facility: "workshop" });
      }
      if (this.state.stage !== "free" || now < this.state.nextManualCollectAt) return false;
      this.state.scrap += 4;
      this.state.nextManualCollectAt = now + MANUAL_COLLECT_MS;
      return this.commit({ kind: "collect", amount: 4, facility: "workshop" });
    }

    if (command.kind === "upgrade") {
      const { facility } = command;
      if (this.state.stage === "upgrade" && facility !== "beacon") return false;
      if (this.state.stage !== "upgrade" && this.state.stage !== "free") return false;
      const currentLevel = this.state.levels[facility];
      if (currentLevel >= MAX_FACILITY_LEVEL) return false;
      const cost = getUpgradeCost(facility, currentLevel);
      if (this.state.scrap < cost) return false;
      this.state.scrap -= cost;
      this.state.levels[facility] = currentLevel + 1;
      if (facility === "shelter") this.state.capacity = 4 + (this.state.levels.shelter - 1) * 2;
      if (this.state.stage === "upgrade") this.state.stage = "rescue";
      return this.commit({ kind: "upgrade", amount: cost, facility });
    }

    if (command.kind === "rescue") {
      if (
        this.state.stage !== "rescue" ||
        this.state.power < 4 ||
        this.state.population >= this.state.capacity
      ) return false;
      this.state.power -= 4;
      this.state.population += 1;
      this.state.civilianRescued = true;
      this.state.stage = "assign";
      return this.commit({ kind: "rescue", amount: 1, facility: "gate" });
    }

    if (command.kind === "assign") {
      if (this.state.stage !== "assign" && this.state.stage !== "free") return false;
      if (this.state.stage === "assign" && (command.facility !== "greenhouse" || command.delta !== 1)) return false;
      if (command.delta === 1 && getWaitingPopulation(this.state) < 1) return false;
      if (command.delta === -1 && this.state.assignments[command.facility] < 1) return false;
      const completesTutorial = this.state.stage === "assign";
      this.state.assignments[command.facility] += command.delta;
      if (completesTutorial) {
        this.state.stage = "free";
        this.state.scrap += 30;
        this.state.lastTickAt = now;
      }
      return this.commit({
        kind: "assign",
        amount: command.delta,
        facility: command.facility,
        resources: completesTutorial ? { power: 0, scrap: 30, food: 0 } : undefined
      });
    }

    if (command.kind === "dispatch") {
      if (
        this.state.stage !== "free" ||
        this.state.levels.beacon < 3 ||
        this.state.food < 4 ||
        this.state.expeditionReadyAt !== 0
      ) return false;
      this.state.food -= 4;
      this.state.expeditionReadyAt = now + EXPEDITION_MS;
      return this.commit({ kind: "dispatch", amount: 4, facility: "gate" });
    }

    if (command.kind === "claim") {
      if (this.state.expeditionReadyAt === 0 || now < this.state.expeditionReadyAt) return false;
      this.state.expeditionReadyAt = 0;
      this.state.scrap += 15;
      this.state.power += 6;
      this.state.explored += 1;
      const rescued = this.state.population < this.state.capacity ? 1 : 0;
      this.state.population += rescued;
      return this.commit({
        kind: "claim",
        facility: "gate",
        amount: rescued,
        resources: { power: 6, scrap: 15, food: 0 }
      });
    }

    this.state = createInitialState(now);
    return this.commit({ kind: "reset" });
  }

  tick(now = this.clock()): ResourceBundle {
    const reward = this.produceUntil(now);
    if (reward.power || reward.scrap || reward.food) {
      this.state.savedAt = now;
      this.persist();
      this.emit({ kind: "produce", resources: reward });
    }
    return reward;
  }

  saveNow(): void {
    const now = this.clock();
    this.produceUntil(now);
    this.state.savedAt = now;
    this.persist();
  }

  reconcileOffline(now = this.clock(), notify = true): ResourceBundle {
    const reward = this.produceUntil(now);
    this.state.savedAt = now;
    this.persist();
    if (notify && (reward.power || reward.scrap || reward.food)) {
      this.emit({ kind: "offline", resources: reward });
    }
    return reward;
  }

  private produceUntil(now: number): ResourceBundle {
    if (this.state.stage !== "free") {
      this.state.lastTickAt = now;
      return { ...EMPTY_RESOURCES };
    }

    const safeNow = Math.max(now, this.state.lastTickAt);
    const cappedStart = Math.max(this.state.lastTickAt, safeNow - OFFLINE_CAP_MS);
    const cycles = Math.floor((safeNow - cappedStart) / PRODUCTION_STEP_MS);
    if (cycles < 1) return { ...EMPTY_RESOURCES };

    const reward: ResourceBundle = {
      scrap: cycles * this.state.assignments.workshop * this.state.levels.workshop * 2,
      food: cycles * this.state.assignments.greenhouse * this.state.levels.greenhouse,
      power: cycles * this.state.assignments.relay * this.state.levels.relay
    };
    this.state.scrap += reward.scrap;
    this.state.food += reward.food;
    this.state.power += reward.power;
    this.state.lastTickAt = cappedStart + cycles * PRODUCTION_STEP_MS;
    return reward;
  }

  private commit(action: StoreAction): boolean {
    this.state.savedAt = this.clock();
    this.persist();
    this.emit(action);
    return true;
  }

  private emit(action: StoreAction): void {
    for (const listener of this.listeners) listener(this.state, action);
  }

  private load(): GameState {
    const now = this.clock();
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isSavedState(parsed)) return parsed;
      }
    } catch {
      // Try the legacy slot even when the current JSON is damaged.
    }
    try {
      const legacyRaw = this.storage.getItem(LEGACY_STORAGE_KEY);
      if (legacyRaw) {
        const migrated = migrateLegacy(JSON.parse(legacyRaw) as unknown, now);
        if (migrated) return migrated;
      }
    } catch {
      // A damaged legacy save falls back to a safe new game.
    }
    return createInitialState(now);
  }

  private persist(): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Private browsing or a full storage quota must not block play.
    }
  }
}

export function createGameStore(
  storage: StorageLike,
  clock: () => number = Date.now
): GameStore {
  return new GameStore(storage, clock);
}

export const gameStore = createGameStore(localStorage);
