export type TutorialStage = "collect" | "upgrade" | "rescue" | "complete";

export interface GameState {
  version: 1;
  power: number;
  scrap: number;
  food: number;
  population: number;
  capacity: number;
  beaconLevel: 1 | 2;
  stage: TutorialStage;
  civilianRescued: boolean;
  nextScavengeAt: number;
  savedAt: number;
}

export type StoreActionKind =
  | "collect"
  | "upgrade"
  | "rescue"
  | "scavenge"
  | "offline"
  | "reset";

export interface StoreAction {
  kind: StoreActionKind;
  amount?: number;
}

type StoreListener = (state: Readonly<GameState>, action: StoreAction) => void;

const STORAGE_KEY = "last-beacon-save-v1";
const OFFLINE_STEP_MS = 45_000;
const OFFLINE_CAP_MS = 2 * 60 * 60 * 1_000;

function createInitialState(now = Date.now()): GameState {
  return {
    version: 1,
    power: 80,
    scrap: 12,
    food: 8,
    population: 2,
    capacity: 4,
    beaconLevel: 1,
    stage: "collect",
    civilianRescued: false,
    nextScavengeAt: 0,
    savedAt: now
  };
}

function isStage(value: unknown): value is TutorialStage {
  return value === "collect" || value === "upgrade" || value === "rescue" || value === "complete";
}

function isWholeNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function isSavedState(value: unknown): value is GameState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GameState>;
  const structurallyValid = (
    candidate.version === 1 &&
    isWholeNumber(candidate.power, 0, 1_000_000_000) &&
    isWholeNumber(candidate.scrap, 0, 1_000_000_000) &&
    isWholeNumber(candidate.food, 0, 1_000_000_000) &&
    isWholeNumber(candidate.population, 0, 999) &&
    isWholeNumber(candidate.capacity, 1, 999) &&
    candidate.population <= candidate.capacity &&
    (candidate.beaconLevel === 1 || candidate.beaconLevel === 2) &&
    isStage(candidate.stage) &&
    typeof candidate.civilianRescued === "boolean" &&
    isWholeNumber(candidate.nextScavengeAt, 0, Number.MAX_SAFE_INTEGER) &&
    isWholeNumber(candidate.savedAt, 1, Number.MAX_SAFE_INTEGER)
  );
  if (!structurallyValid) return false;
  const saved = candidate as GameState;

  if (saved.stage === "collect") {
    return saved.beaconLevel === 1 && !saved.civilianRescued;
  }
  if (saved.stage === "upgrade") {
    return saved.beaconLevel === 1 && !saved.civilianRescued && saved.scrap >= 20;
  }
  if (saved.stage === "rescue") {
    return (
      saved.beaconLevel === 2 &&
      !saved.civilianRescued &&
      saved.power >= 4 &&
      saved.population < saved.capacity
    );
  }
  return saved.beaconLevel === 2 && saved.civilianRescued;
}

class GameStore {
  private state: GameState;
  private listeners = new Set<StoreListener>();
  private offlineReward = 0;

  constructor() {
    this.state = this.load();
    this.offlineReward = this.reconcileOffline(Date.now(), false);
  }

  getState(): Readonly<GameState> {
    return this.state;
  }

  getOfflineReward(): number {
    return this.offlineReward;
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  perform(kind: StoreActionKind): boolean {
    const now = Date.now();

    if (kind === "offline") return false;

    if (kind === "collect") {
      if (this.state.stage !== "collect") return false;
      this.state.scrap += 8;
      this.state.stage = "upgrade";
      return this.commit({ kind, amount: 8 });
    }

    if (kind === "upgrade") {
      if (this.state.stage !== "upgrade" || this.state.scrap < 20) return false;
      this.state.scrap -= 20;
      this.state.beaconLevel = 2;
      this.state.stage = "rescue";
      return this.commit({ kind, amount: 20 });
    }

    if (kind === "rescue") {
      if (
        this.state.stage !== "rescue" ||
        this.state.power < 4 ||
        this.state.population >= this.state.capacity
      ) {
        return false;
      }
      this.state.power -= 4;
      this.state.population += 1;
      this.state.civilianRescued = true;
      this.state.stage = "complete";
      this.state.nextScavengeAt = now + 4_000;
      return this.commit({ kind, amount: 1 });
    }

    if (kind === "scavenge") {
      if (this.state.stage !== "complete" || now < this.state.nextScavengeAt) return false;
      this.state.scrap += 2;
      this.state.nextScavengeAt = now + 6_000;
      return this.commit({ kind, amount: 2 });
    }

    if (kind === "reset") {
      this.state = createInitialState(now);
      return this.commit({ kind });
    }

    return false;
  }

  saveNow(): void {
    this.state.savedAt = Date.now();
    this.persist();
  }

  reconcileOffline(now = Date.now(), notify = true): number {
    const elapsed = Math.min(Math.max(now - this.state.savedAt, 0), OFFLINE_CAP_MS);
    const reward = Math.floor(elapsed / OFFLINE_STEP_MS);
    if (reward > 0) this.state.scrap += reward;
    this.state.savedAt = now;
    this.persist();

    if (notify && reward > 0) {
      const action: StoreAction = { kind: "offline", amount: reward };
      for (const listener of this.listeners) listener(this.state, action);
    }
    return reward;
  }

  private commit(action: StoreAction): boolean {
    this.state.savedAt = Date.now();
    this.persist();
    for (const listener of this.listeners) listener(this.state, action);
    return true;
  }

  private load(): GameState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createInitialState();
      const parsed: unknown = JSON.parse(raw);
      return isSavedState(parsed) ? parsed : createInitialState();
    } catch {
      return createInitialState();
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Private browsing or a full storage quota must not block play.
    }
  }
}

export const gameStore = new GameStore();
