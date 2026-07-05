import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  closeSettings: () => ipcRenderer.send("close-settings"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  onBuffUpdate: (cb: (data: any) => void) => {
    ipcRenderer.on("buff-update", (_e, data) => cb(data));
  },
  onMacroProgress: (cb: (data: any) => void) => {
    ipcRenderer.on("macro-progress", (_e, data) => cb(data));
  },
  onPickMode: (cb: (active: boolean, cursorPos?: { x: number; y: number }) => void) => {
    ipcRenderer.on("pick-mode", (_e, active, cursorPos) => cb(active, cursorPos));
  },
  onStashDetected: (cb: (tabType: string) => void) => {
    ipcRenderer.on("stash-detected", (_e, tabType) => cb(tabType));
  },
  pickPosition: (cb: (pos: { x: number; y: number }) => void) => {
    ipcRenderer.send("pick-position");
    ipcRenderer.once("position-picked", (_e, pos) => cb(pos));
  },
  setOrbPosition: (slot: string, position: { x: number; y: number }) => {
    ipcRenderer.send("set-orb-position", { slot, position });
  },
  setOrbCurrency: (slot: string, currency: string) => {
    ipcRenderer.send("set-orb-currency", { slot, currency });
  },
  setActionDelay: (delay: number) => {
    ipcRenderer.send("update-action-delay", delay);
  },
  startMacro: () => ipcRenderer.send("start-macro"),
  startSort: (mode: string) => ipcRenderer.send("start-sort", mode),
  startShiftInsert: () => ipcRenderer.send("start-shift-insert"),
  resumeSort: () => ipcRenderer.send("resume-sort"),
  setSortDelay: (delay: number) => ipcRenderer.send("update-sort-delay", delay),
  setSortBatch: (size: number) => ipcRenderer.send("update-sort-batch", size),
  // Buff alarm
  getBuffConfig: () => ipcRenderer.invoke("get-buff-config"),
  setBuffAlarmCadence: (cadence: number) => ipcRenderer.send("set-buff-alarm-cadence", cadence),
  addBuff: () => ipcRenderer.send("add-buff"),
  removeBuff: (index: number) => ipcRenderer.send("remove-buff", index),
  setBuffAlarmSound: (index: number) => ipcRenderer.invoke("set-buff-alarm-sound", index),
  startBuffCapture: () => ipcRenderer.send("start-buff-capture"),
  enableBuffTracker: () => ipcRenderer.send("enable-buff-tracker"),
  disableBuffTracker: () => ipcRenderer.send("disable-buff-tracker"),
  setBuffHideOverlay: (hide: boolean) => ipcRenderer.send("set-buff-hide-overlay", hide),
  onBuffConfigSync: (cb: (data: { captureRegion: any; hideOverlay: boolean; scaleFactor: number }) => void) => {
    ipcRenderer.on("buff-config-sync", (_e, data) => cb(data));
  },
  // Verisium
  getVerisiumPrices: () => ipcRenderer.invoke("get-verisium-prices"),
  getPoesessid: () => ipcRenderer.invoke("get-poesessid"),
  setPoesessid: (sessid: string) => ipcRenderer.send("set-poesessid", sessid),
  clearVerisiumCache: () => ipcRenderer.send("clear-verisium-cache"),
  onVerisiumStatus: (cb: (status: { state: string; progress?: string; valid?: boolean }) => void) => {
    ipcRenderer.on("verisium-status", (_e, status) => cb(status));
  },
  onOcrLines: (cb: (lines: string[]) => void) => {
    ipcRenderer.on("ocr-lines", (_e, lines) => cb(lines));
  },
  // Price overlay
  onPriceResults: (cb: (data: any[]) => void) => {
    ipcRenderer.on("price-results", (_e, data) => cb(data));
  },
  dismissPriceOverlay: () => ipcRenderer.send("dismiss-price-overlay"),
  // Capture overlay
  getCaptureData: () => ipcRenderer.invoke("get-capture-data"),
  applyCaptureOverlay: (data: any) => ipcRenderer.send("capture-overlay-apply", data),
  cancelCaptureOverlay: () => ipcRenderer.send("capture-overlay-cancel"),
  // Auto-updater
  getUpdateInfo: () => ipcRenderer.invoke("get-update-info"),
  updateInstall: () => ipcRenderer.send("update-install"),
  updateDismiss: () => ipcRenderer.send("update-dismiss"),
  // WIP
  checkWipKey: () => ipcRenderer.invoke("check-wip-key"),
  getWipItems: () => ipcRenderer.invoke("get-wip-items"),
  startWipScan: (selectedItem: string) => ipcRenderer.invoke("start-wip-scan", selectedItem),
  cancelWipScan: () => ipcRenderer.send("cancel-wip-scan"),
  getLmsStatus: () => ipcRenderer.invoke("get-lms-status"),
  ensureLmsReady: () => ipcRenderer.invoke("ensure-lms-ready"),
  killLms: () => ipcRenderer.send("kill-lms"),
  listLmsModels: () => ipcRenderer.invoke("list-lms-models"),
  getLmsModel: () => ipcRenderer.invoke("get-lms-model"),
  setLmsModel: (model: string) => ipcRenderer.send("set-lms-model", model),
  onWipProgress: (cb: (data: { current: number; total: number; pair: string }) => void) => {
    ipcRenderer.on("wip-progress", (_e, data) => cb(data));
  },
});
