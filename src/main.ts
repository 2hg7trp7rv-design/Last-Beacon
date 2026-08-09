import Phaser from "phaser";
import { registerSW } from "virtual:pwa-register";
import "./styles.css";
import { gameAudio } from "./game/audio";
import { gameConfig } from "./game/LastBeaconScene";
import { gameStore, type GameState, type StoreActionKind, type TutorialStage } from "./game/state";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element not found: ${selector}`);
  return element;
}

const powerValue = required<HTMLElement>("#power-value");
const scrapValue = required<HTMLElement>("#scrap-value");
const foodValue = required<HTMLElement>("#food-value");
const peopleValue = required<HTMLElement>("#people-value");
const objectiveKicker = required<HTMLElement>("#objective-kicker");
const objectiveTitle = required<HTMLElement>("#objective-title");
const upgradeCurrent = required<HTMLElement>("#upgrade-current");
const scrapAction = required<HTMLButtonElement>("#scrap-action");
const upgradeAction = required<HTMLButtonElement>("#upgrade-action");
const rescueAction = required<HTMLButtonElement>("#rescue-action");
const scrapActionLabel = required<HTMLElement>("#scrap-action .hotspot__label");
const soundToggle = required<HTMLButtonElement>("#sound-toggle");
const drawer = required<HTMLElement>("#drawer");
const drawerBackdrop = required<HTMLButtonElement>("#drawer-backdrop");
const drawerClose = required<HTMLButtonElement>("#drawer-close");
const drawerKicker = required<HTMLElement>("#drawer-kicker");
const drawerTitle = required<HTMLElement>("#drawer-title");
const drawerContent = required<HTMLElement>("#drawer-content");
const toast = required<HTMLElement>("#toast");
const updateApp = required<HTMLButtonElement>("#update-app");
const navButtons = [...document.querySelectorAll<HTMLButtonElement>(".bottom-nav button")];

const objectives: Record<TutorialStage, { kicker: string; title: string }> = {
  collect: { kicker: "最初の一手", title: "光っている廃材をタップ" },
  upgrade: { kicker: "灯火を強化", title: "廃材20で安全圏を広げる" },
  rescue: { kicker: "安全圏が広がった", title: "取り残された人を救助" },
  complete: { kicker: "DAY 1 — 救助完了", title: "廃材を集め、次の強化に備える" }
};

let toastTimer = 0;
let drawerHideTimer = 0;
let activePanel: "build" | "workers" | "map" | null = null;

new Phaser.Game(gameConfig);

function renderUI(state: Readonly<GameState>): void {
  powerValue.textContent = String(Math.floor(state.power));
  scrapValue.textContent = String(Math.floor(state.scrap));
  foodValue.textContent = String(Math.floor(state.food));
  peopleValue.textContent = `${state.population}/${state.capacity}`;
  upgradeCurrent.textContent = String(Math.floor(state.scrap));

  const objective = objectives[state.stage];
  objectiveKicker.textContent = objective.kicker;
  objectiveTitle.textContent = objective.title;

  scrapAction.hidden = state.stage !== "collect" && state.stage !== "complete";
  upgradeAction.hidden = state.stage !== "upgrade";
  rescueAction.hidden = state.stage !== "rescue";
  upgradeAction.disabled = state.scrap < 20;

  const tutorialComplete = state.stage === "complete";
  for (const button of navButtons) button.classList.toggle("is-dimmed", !tutorialComplete);

  refreshCooldown(state);
  if (activePanel) renderDrawer(activePanel, state);
}

function refreshCooldown(state = gameStore.getState()): void {
  if (state.stage !== "complete") {
    scrapAction.disabled = false;
    scrapAction.classList.remove("is-cooling");
    scrapActionLabel.textContent = "廃材をタップ";
    return;
  }

  const remaining = Math.max(state.nextScavengeAt - Date.now(), 0);
  const cooling = remaining > 0;
  scrapAction.disabled = cooling;
  scrapAction.classList.toggle("is-cooling", cooling);
  scrapActionLabel.textContent = cooling ? `回収まで ${Math.ceil(remaining / 1_000)}秒` : "廃材 +2";
}

function attempt(kind: StoreActionKind): void {
  if (!gameStore.perform(kind)) return;
  const cue = kind === "collect" || kind === "upgrade" || kind === "rescue" ? kind : "tap";
  gameAudio.play(cue);
}

scrapAction.addEventListener("click", () => {
  attempt(gameStore.getState().stage === "complete" ? "scavenge" : "collect");
});
upgradeAction.addEventListener("click", () => attempt("upgrade"));
rescueAction.addEventListener("click", () => attempt("rescue"));

soundToggle.addEventListener("click", () => {
  const enabled = gameAudio.toggle();
  soundToggle.classList.toggle("is-muted", !enabled);
  soundToggle.setAttribute("aria-pressed", String(enabled));
  soundToggle.setAttribute("aria-label", enabled ? "効果音をオフにする" : "効果音をオンにする");
});

for (const button of navButtons) {
  button.addEventListener("click", () => {
    gameAudio.play("tap");
    const panel = button.dataset.panel;
    if (panel === "build" || panel === "workers" || panel === "map") openDrawer(panel);
  });
}

drawerClose.addEventListener("click", closeDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
});

function openDrawer(panel: "build" | "workers" | "map"): void {
  window.clearTimeout(drawerHideTimer);
  activePanel = panel;
  renderDrawer(panel, gameStore.getState());
  drawer.hidden = false;
  drawerBackdrop.hidden = false;
  requestAnimationFrame(() => drawer.classList.add("is-open"));
  drawerClose.focus({ preventScroll: true });
}

function closeDrawer(): void {
  window.clearTimeout(drawerHideTimer);
  drawer.classList.remove("is-open");
  drawerBackdrop.hidden = true;
  activePanel = null;
  drawerHideTimer = window.setTimeout(() => {
    drawer.hidden = true;
  }, 220);
}

function renderDrawer(panel: "build" | "workers" | "map", state: Readonly<GameState>): void {
  if (panel === "build") {
    drawerKicker.textContent = "BASE STATUS";
    drawerTitle.textContent = "施設";
    drawerContent.innerHTML = `
      <div class="status-card">
        <span class="status-card__icon">⚒</span>
        <span><b>回収工房 Lv.1</b><small>廃材を自動で選別</small></span>
        <em>稼働中</em>
      </div>
      <div class="status-card">
        <span class="status-card__icon">⌂</span>
        <span><b>簡易シェルター Lv.1</b><small>居住枠 ${state.population}/${state.capacity}</small></span>
        <em>安定</em>
      </div>
      <div class="status-card status-card--locked">
        <span class="status-card__icon">＋</span>
        <span><b>空き建設区画</b><small>灯火 Lv.3 で解放</small></span>
        <em>未解放</em>
      </div>`;
    return;
  }

  if (panel === "workers") {
    const rescued = state.civilianRescued ? 1 : 0;
    drawerKicker.textContent = "SURVIVORS";
    drawerTitle.textContent = `住民 ${state.population}/${state.capacity}`;
    drawerContent.innerHTML = `
      <div class="population-meter"><span style="width:${(state.population / state.capacity) * 100}%"></span></div>
      <div class="assignment"><b>回収工房</b><span>1人 配属中</span></div>
      <div class="assignment"><b>灯火の整備</b><span>1人 配属中</span></div>
      <div class="assignment"><b>待機</b><span>${rescued}人</span></div>
      <p class="drawer-note">次の試作では、住民をドラッグして施設へ配属できます。</p>`;
    return;
  }

  drawerKicker.textContent = "BLACK FOG ZONE";
  drawerTitle.textContent = "周辺探索";
  drawerContent.innerHTML = `
    <div class="mini-map" aria-label="霧に覆われた周辺地図">
      <span class="mini-map__beacon"></span>
      <i></i><i></i><i></i>
    </div>
    <p class="drawer-note">灯火 Lv.3 で最初の探索区画が開きます。現在は安全圏の維持が最優先です。</p>
    <button id="reset-progress" class="danger-link" type="button">チュートリアルを最初から</button>`;
  required<HTMLButtonElement>("#reset-progress").addEventListener("click", () => {
    if (!window.confirm("現在のローカル進行を消して、最初から始めますか？")) return;
    closeDrawer();
    gameStore.perform("reset");
  });
}

function showToast(message: string, duration = 2_400): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), duration);
}

gameStore.subscribe((state, action) => {
  renderUI(state);
  const message = action.kind === "offline"
    ? `留守中の回収：廃材 +${action.amount ?? 0}`
    : ({
    collect: "廃材 +8 — 灯火を強化できます",
    upgrade: "灯火 Lv.2 — 安全圏が広がった",
    rescue: "生存者を救助 — 人口 +1",
    scavenge: "廃材 +2",
    reset: "最初の状態に戻しました"
  } as const)[action.kind];
  showToast(message);
});

renderUI(gameStore.getState());
window.setInterval(() => refreshCooldown(), 250);

const offlineReward = gameStore.getOfflineReward();
if (offlineReward > 0) {
  window.setTimeout(() => showToast(`留守中の回収：廃材 +${offlineReward}`, 3_200), 1_100);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    gameStore.saveNow();
  } else {
    gameStore.reconcileOffline();
  }
});
window.addEventListener("pagehide", () => gameStore.saveNow());

const updateSW = registerSW({
  onNeedRefresh() {
    updateApp.hidden = false;
  },
  onOfflineReady() {
    showToast("オフラインでも起動できます");
  }
});

updateApp.addEventListener("click", () => void updateSW(true));
