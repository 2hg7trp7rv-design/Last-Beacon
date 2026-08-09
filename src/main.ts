import Phaser from "phaser";
import { registerSW } from "virtual:pwa-register";
import "./styles.css";
import { gameAudio } from "./game/audio";
import { gameConfig } from "./game/LastBeaconScene";
import {
  FACILITY_NAMES,
  MAX_FACILITY_LEVEL,
  gameStore,
  getProductionPerMinute,
  getUpgradeCost,
  getWaitingPopulation,
  type FacilityId,
  type GameState,
  type ResourceBundle,
  type StoreAction,
  type UpgradableFacility,
  type WorkerFacility
} from "./game/state";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element not found: ${selector}`);
  return element;
}

type Panel = "build" | "workers" | "map" | FacilityId;

const powerValue = required<HTMLElement>("#power-value");
const scrapValue = required<HTMLElement>("#scrap-value");
const foodValue = required<HTMLElement>("#food-value");
const peopleValue = required<HTMLElement>("#people-value");
const objectiveKicker = required<HTMLElement>("#objective-kicker");
const objectiveTitle = required<HTMLElement>("#objective-title");
const worldGuide = required<HTMLElement>("#world-guide");
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

const workerCopy: Record<WorkerFacility, { name: string; unit: string }> = {
  workshop: { name: "回収工房", unit: "廃材" },
  greenhouse: { name: "食料温室", unit: "食料" },
  relay: { name: "送電リレー", unit: "電力" }
};

const facilityIcons: Record<FacilityId, string> = {
  beacon: "◉",
  workshop: "⚒",
  shelter: "⌂",
  greenhouse: "♧",
  relay: "ϟ",
  gate: "⌁"
};

let toastTimer = 0;
let drawerHideTimer = 0;
let activePanel: Panel | null = null;

new Phaser.Game(gameConfig);

function getObjective(state: Readonly<GameState>): { kicker: string; title: string } {
  if (state.stage === "pan") return { kicker: "拠点を見回す", title: "画面をドラッグして回収工房を探す" };
  if (state.stage === "collect") return { kicker: "南西区画", title: "回収工房をタップして廃材を回収" };
  if (state.stage === "upgrade") return { kicker: "中央広場へ戻る", title: "灯火をLv.2へ強化する" };
  if (state.stage === "rescue") return { kicker: "北部から救難信号", title: "マップ上端の生存者を救助する" };
  if (state.stage === "assign") return { kicker: "南東区画へ移動", title: "救助した住民を食料温室へ配属" };
  if (state.levels.beacon < 3) return { kicker: "拠点を拡張", title: "灯火をLv.3へ強化して探索を解放" };
  if (state.expeditionReadyAt > Date.now()) {
    return {
      kicker: "探索隊が行動中",
      title: `帰還まで ${Math.ceil((state.expeditionReadyAt - Date.now()) / 1_000)}秒`
    };
  }
  if (state.expeditionReadyAt > 0) return { kicker: "探索隊が帰還", title: "北部ゲートで探索物資を回収" };
  if (state.explored === 0) return { kicker: "黒霧の外へ", title: "北部ゲートから探索隊を派遣" };
  return { kicker: `探索済み区画 ${state.explored}`, title: "住民を配属し、施設を強化して拠点を広げる" };
}

function renderUI(state: Readonly<GameState>, refreshPanel = true): void {
  powerValue.textContent = String(state.power);
  scrapValue.textContent = String(state.scrap);
  foodValue.textContent = String(state.food);
  peopleValue.textContent = `${state.population}/${state.capacity}`;
  refreshObjective(state);

  for (const button of navButtons) {
    const panel = button.dataset.panel;
    const disabled = panel === "workers"
      ? state.stage !== "assign" && state.stage !== "free"
      : panel === "map"
        ? state.stage !== "free"
        : false;
    button.disabled = disabled;
    button.classList.toggle("is-dimmed", disabled);
  }

  if (activePanel && refreshPanel) renderDrawer(activePanel, state);
  else if (activePanel) refreshOpenPanelAvailability(state);
}

function refreshObjective(state = gameStore.getState()): void {
  const objective = getObjective(state);
  objectiveKicker.textContent = objective.kicker;
  objectiveTitle.textContent = objective.title;
}

function refreshOpenPanelAvailability(state: Readonly<GameState>): void {
  const upgrade = drawerContent.querySelector<HTMLButtonElement>('button[data-action="upgrade"][data-facility]');
  const facility = upgrade?.dataset.facility as UpgradableFacility | undefined;
  if (upgrade && facility) {
    const level = state.levels[facility];
    upgrade.disabled = level >= MAX_FACILITY_LEVEL || state.stage !== "free" ||
      state.scrap < getUpgradeCost(facility, level);
  }
  const dispatch = drawerContent.querySelector<HTMLButtonElement>('button[data-action="dispatch"]');
  if (dispatch) dispatch.disabled = state.food < 4 || state.levels.beacon < 3;
}

function openDrawer(panel: Panel): void {
  window.clearTimeout(drawerHideTimer);
  activePanel = panel;
  renderDrawer(panel, gameStore.getState());
  drawer.hidden = false;
  drawerBackdrop.hidden = false;
  window.dispatchEvent(new CustomEvent("lastbeacon:input-lock", { detail: { locked: true } }));
  requestAnimationFrame(() => drawer.classList.add("is-open"));
  drawerClose.focus({ preventScroll: true });
}

function closeDrawer(): void {
  window.clearTimeout(drawerHideTimer);
  drawer.classList.remove("is-open");
  drawerBackdrop.hidden = true;
  activePanel = null;
  window.dispatchEvent(new CustomEvent("lastbeacon:input-lock", { detail: { locked: false } }));
  drawerHideTimer = window.setTimeout(() => {
    drawer.hidden = true;
  }, 220);
}

function renderDrawer(panel: Panel, state: Readonly<GameState>): void {
  if (panel === "build") {
    const production = getProductionPerMinute(state);
    drawerKicker.textContent = "BASE FACILITIES";
    drawerTitle.textContent = "拠点施設";
    drawerContent.innerHTML = (["beacon", "workshop", "shelter", "greenhouse", "relay", "gate"] as FacilityId[])
      .map((facility) => {
        const level = facility === "gate" ? "外周" : `Lv.${state.levels[facility]}`;
        const detail = facility === "workshop" ? `廃材 +${production.scrap}/分`
          : facility === "greenhouse" ? `食料 +${production.food}/分`
            : facility === "relay" ? `電力 +${production.power}/分`
              : facility === "shelter" ? `居住枠 ${state.population}/${state.capacity}`
                : facility === "gate" ? `探索済み ${state.explored}区画`
                  : `探索機能 ${state.levels.beacon >= 3 ? "稼働" : "未解放"}`;
        return `
          <button class="status-card status-card--button" type="button" data-action="focus" data-facility="${facility}">
            <span class="status-card__icon">${facilityIcons[facility]}</span>
            <span><b>${FACILITY_NAMES[facility]}</b><small>${detail}</small></span>
            <em>${level}</em>
          </button>`;
      }).join("");
    return;
  }

  if (panel === "workers") {
    const production = getProductionPerMinute(state);
    const waiting = getWaitingPopulation(state);
    drawerKicker.textContent = state.stage === "assign" ? "NEW ASSIGNMENT" : "SURVIVORS";
    drawerTitle.textContent = `住民配属 ${state.population}/${state.capacity}`;
    drawerContent.innerHTML = `
      <div class="population-meter"><span style="width:${(state.population / state.capacity) * 100}%"></span></div>
      <div class="waiting-row"><span>待機中</span><b>${waiting}人</b></div>
      ${(["workshop", "greenhouse", "relay"] as WorkerFacility[]).map((facility) => {
        const tutorialLocked = state.stage === "assign" && facility !== "greenhouse";
        const minusDisabled = state.stage !== "free" || state.assignments[facility] < 1;
        const plusDisabled = tutorialLocked || waiting < 1;
        const rate = facility === "workshop" ? production.scrap : facility === "greenhouse" ? production.food : production.power;
        return `
          <div class="assignment-row">
            <span><b>${workerCopy[facility].name}</b><small>${workerCopy[facility].unit} +${rate}/分</small></span>
            <span class="stepper">
              <button type="button" data-action="assign" data-facility="${facility}" data-delta="-1" aria-label="${workerCopy[facility].name}の配属を1人減らす" ${minusDisabled ? "disabled" : ""}>−</button>
              <strong>${state.assignments[facility]}人</strong>
              <button type="button" data-action="assign" data-facility="${facility}" data-delta="1" aria-label="${workerCopy[facility].name}へ1人配属する" ${plusDisabled ? "disabled" : ""}>＋</button>
            </span>
          </div>`;
      }).join("")}
      ${state.stage === "assign" ? '<p class="drawer-note drawer-note--accent">救助した住民を「食料温室」へ1人配属すると、拠点の自動生産が始まります。</p>' : ""}`;
    return;
  }

  if (panel === "map") {
    drawerKicker.textContent = "BLACK FOG ZONE";
    drawerTitle.textContent = "周辺探索";
    drawerContent.innerHTML = `
      <div class="mini-map" aria-label="霧に覆われた周辺地図">
        <span class="mini-map__beacon"></span><i></i><i></i><i></i>
      </div>
      <div class="explore-summary"><span>灯火 Lv.${state.levels.beacon}</span><span>探索済み ${state.explored}</span></div>
      ${renderExpeditionButton(state)}
      <button class="panel-action panel-action--secondary" type="button" data-action="focus" data-facility="gate">北部ゲートを見る</button>
      <button class="danger-link" type="button" data-action="reset">チュートリアルを最初から</button>`;
    return;
  }

  renderFacilityDrawer(panel, state);
}

function renderFacilityDrawer(facility: FacilityId, state: Readonly<GameState>): void {
  drawerKicker.textContent = facility === "gate" ? "OUTER GATE" : "FACILITY CONTROL";
  drawerTitle.textContent = FACILITY_NAMES[facility];

  if (facility === "gate") {
    drawerContent.innerHTML = `
      <div class="facility-hero"><span>${facilityIcons.gate}</span><div><b>北部外周</b><small>黒霧地帯への出発地点</small></div></div>
      ${renderExpeditionButton(state)}
      <button class="panel-action panel-action--secondary" type="button" data-action="focus" data-facility="gate">場所を見る</button>`;
    return;
  }

  const level = state.levels[facility];
  const cost = getUpgradeCost(facility, level);
  const production = getProductionPerMinute(state);
  const detail = facility === "workshop" ? `${state.assignments.workshop}人配属 · 廃材 +${production.scrap}/分`
    : facility === "greenhouse" ? `${state.assignments.greenhouse}人配属 · 食料 +${production.food}/分`
      : facility === "relay" ? `${state.assignments.relay}人配属 · 電力 +${production.power}/分`
        : facility === "shelter" ? `居住枠 ${state.population}/${state.capacity}`
          : `安全圏と探索レベルを決定`;
  const atMaximum = level >= MAX_FACILITY_LEVEL;
  const canUpgrade = !atMaximum && state.stage === "free" && state.scrap >= cost;
  const manualRemaining = Math.max(state.nextManualCollectAt - Date.now(), 0);

  drawerContent.innerHTML = `
    <div class="facility-hero">
      <span>${facilityIcons[facility]}</span>
      <div><b>Lv.${level}</b><small>${detail}</small></div>
    </div>
    <div class="facility-progress"><span style="width:${Math.min(level * 17, 100)}%"></span></div>
    ${facility === "workshop" && state.stage === "free" ? `
      <button class="panel-action" type="button" data-action="collect" data-timer="manual" ${manualRemaining > 0 ? "disabled" : ""}>${manualRemaining > 0 ? `次の回収まで ${Math.ceil(manualRemaining / 1_000)}秒` : "廃材を手動回収 +4"}</button>` : ""}
    <button class="panel-action" type="button" data-action="upgrade" data-facility="${facility}" ${canUpgrade ? "" : "disabled"}>
      ${atMaximum ? "最大レベル" : `Lv.${level + 1}へ強化 · 廃材 ${cost}`}
    </button>
    <button class="panel-action panel-action--secondary" type="button" data-action="focus" data-facility="${facility}">場所を見る</button>
    ${state.stage !== "free" ? '<p class="drawer-note">最初の救助と住民配属を終えると、自由に施設を強化できます。</p>' : atMaximum ? '<p class="drawer-note">この施設は最大レベルです。</p>' : state.scrap < cost ? `<p class="drawer-note">強化には廃材があと ${cost - state.scrap} 必要です。</p>` : ""}`;
}

function renderExpeditionButton(state: Readonly<GameState>): string {
  if (state.levels.beacon < 3) {
    return '<button class="panel-action" type="button" disabled>灯火 Lv.3 で探索解放</button>';
  }
  if (state.expeditionReadyAt > Date.now()) {
    return `<button class="panel-action" type="button" data-timer="expedition" disabled>探索中 · あと ${Math.ceil((state.expeditionReadyAt - Date.now()) / 1_000)}秒</button>`;
  }
  if (state.expeditionReadyAt > 0) {
    return '<button class="panel-action" type="button" data-action="claim">探索物資を回収 · 廃材15 / 電力6</button>';
  }
  return `<button class="panel-action" type="button" data-action="dispatch" ${state.food < 4 ? "disabled" : ""}>探索隊を派遣 · 食料4</button>`;
}

function showToast(message: string, duration = 2_400): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), duration);
}

function focusFacility(facility: FacilityId): void {
  closeDrawer();
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent("lastbeacon:focus", { detail: { facility } }));
  }, 40);
}

function resourceSummary(resources: Readonly<ResourceBundle>): string {
  return [
    resources.scrap ? `廃材 +${resources.scrap}` : "",
    resources.food ? `食料 +${resources.food}` : "",
    resources.power ? `電力 +${resources.power}` : ""
  ].filter(Boolean).join(" / ");
}

drawerContent.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  const facility = button.dataset.facility as FacilityId | undefined;

  if (action === "focus" && facility) {
    gameAudio.play("tap");
    focusFacility(facility);
    return;
  }

  if (action === "upgrade" && facility && facility !== "gate") {
    if (gameStore.perform({ kind: "upgrade", facility: facility as UpgradableFacility })) gameAudio.play("upgrade");
    return;
  }

  if (action === "assign" && facility) {
    const delta = Number(button.dataset.delta) as 1 | -1;
    if (gameStore.perform({ kind: "assign", facility: facility as WorkerFacility, delta })) gameAudio.play("tap");
    return;
  }

  if (action === "collect") {
    if (gameStore.perform({ kind: "collect" })) gameAudio.play("collect");
    else showToast("回収班が次の廃材を選別中です");
    return;
  }

  if (action === "dispatch") {
    if (gameStore.perform({ kind: "dispatch" })) gameAudio.play("rescue");
    return;
  }

  if (action === "claim") {
    if (gameStore.perform({ kind: "claim" })) gameAudio.play("upgrade");
    return;
  }

  if (action === "reset") {
    if (!window.confirm("現在のローカル進行を消して、最初から始めますか？")) return;
    closeDrawer();
    gameStore.perform({ kind: "reset" });
  }
});

soundToggle.addEventListener("click", () => {
  const enabled = gameAudio.toggle();
  soundToggle.classList.toggle("is-muted", !enabled);
  soundToggle.setAttribute("aria-pressed", String(enabled));
  soundToggle.setAttribute("aria-label", enabled ? "効果音をオフにする" : "効果音をオンにする");
});

for (const button of navButtons) {
  button.addEventListener("click", () => {
    if (button.disabled) return;
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

window.addEventListener("lastbeacon:select", (event: Event) => {
  const facility = (event as CustomEvent<{ facility?: FacilityId }>).detail?.facility;
  if (!facility) return;
  if (gameStore.getState().stage === "assign" && facility === "greenhouse") openDrawer("workers");
  else openDrawer(facility);
});

window.addEventListener("lastbeacon:guide", (event: Event) => {
  const copy = (event as CustomEvent<{ copy?: string }>).detail?.copy;
  if (copy) worldGuide.textContent = copy;
});

function actionMessage(action: StoreAction): string | null {
  if (action.kind === "produce") return null;
  if (action.kind === "offline") return `留守中の生産：${resourceSummary(action.resources ?? { power: 0, scrap: 0, food: 0 })}`;
  if (action.kind === "pan") return "回収工房を探してください";
  if (action.kind === "collect") return `廃材 +${action.amount ?? 0}`;
  if (action.kind === "upgrade") return `${FACILITY_NAMES[action.facility ?? "beacon"]}を強化しました`;
  if (action.kind === "rescue") return "生存者を救助 — 人口 +1";
  if (action.kind === "assign") return action.resources?.scrap
    ? "温室が稼働 — 運用物資として廃材 +30"
    : "住民の配属を変更しました";
  if (action.kind === "dispatch") return "探索隊が出発 — 20秒後に帰還";
  if (action.kind === "claim") return action.amount
    ? "探索物資：廃材 +15 / 電力 +6 / 生存者 +1"
    : "探索物資：廃材 +15 / 電力 +6";
  return "最初の状態に戻しました";
}

gameStore.subscribe((state, action) => {
  renderUI(state, action.kind !== "produce");
  const message = actionMessage(action);
  if (message) showToast(message, action.kind === "offline" ? 3_200 : 2_400);
});

renderUI(gameStore.getState());
window.setInterval(() => {
  gameStore.tick();
  refreshObjective();
  const manual = drawerContent.querySelector<HTMLButtonElement>('[data-timer="manual"]');
  if (manual) {
    const remaining = Math.max(gameStore.getState().nextManualCollectAt - Date.now(), 0);
    manual.disabled = remaining > 0;
    manual.textContent = remaining > 0 ? `次の回収まで ${Math.ceil(remaining / 1_000)}秒` : "廃材を手動回収 +4";
  }
  const expedition = drawerContent.querySelector<HTMLButtonElement>('[data-timer="expedition"]');
  if (expedition) {
    const remaining = Math.max(gameStore.getState().expeditionReadyAt - Date.now(), 0);
    if (remaining > 0) expedition.textContent = `探索中 · あと ${Math.ceil(remaining / 1_000)}秒`;
    else if (activePanel) renderDrawer(activePanel, gameStore.getState());
  }
}, 500);

const offlineReward = gameStore.getOfflineReward();
if (offlineReward.power || offlineReward.scrap || offlineReward.food) {
  window.setTimeout(() => showToast(`留守中の生産：${resourceSummary(offlineReward)}`, 3_200), 1_100);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") gameStore.saveNow();
  else gameStore.reconcileOffline();
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
