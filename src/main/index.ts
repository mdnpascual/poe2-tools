import { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, dialog } from "electron";
import path from "path";
import fs from "fs";

// Global crash logger
process.on("uncaughtException", (err) => {
  try {
    const logPath = path.join(app.getPath("userData"), "crash.log");
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${err.message}\n${err.stack}\n\n`);
  } catch {}
  app.quit();
});
process.on("unhandledRejection", (err: any) => {
  try {
    const logPath = path.join(app.getPath("userData"), "crash.log");
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] REJECTION: ${err?.message || err}\n${err?.stack || ""}\n\n`);
  } catch {}
});

import koffi from "koffi";
import "./network-restrict";
import { getPrimaryMonitor, MonitorBounds } from "./windowing/monitor";
import { captureScreen } from "./capture/screen";
import { detectGridAuto, GridDetectionResult } from "./detection/stash-detect";
import { computeGridLayout } from "./automation/stash-grid";
import { scanStash, printGridSummary } from "./automation/stash-scan";
import { applyCurrency, CurrencyConfig, CurrencyChoice } from "./automation/currency";
import { sortStash, SortMode } from "./automation/stash-sort";
import { shiftInsert } from "./automation/stash-shift";
import { startHook, enterPickMode } from "./hooks/input-hook";
import { loadSettings, saveSettings, AppSettings, BuffConfig } from "./settings";
import { BuffTracker } from "./buffs/buff-tracker";
import { startPriceFetcher, getPriceCache } from "./pricing/price-fetcher";
import { readRewardPanel, getPanelBounds } from "./pricing/ocr-reader";
import { matchPrices } from "./pricing/price-matcher";
import {
  startVerisiumFetcher,
  updateSessionId,
  getVerisiumPrices,
  getVerisiumStatus,
  onVerisiumStatusChange,
  lookupVerisiumPrice,
  toExaltValue,
  loadCurrencyMap,
  clearVerisiumCaches,
  VERISIUM_SKILLS,
  VERISIUM_SUPPORTS,
} from "./pricing/verisium-trade";
import { initAutoUpdater, checkForUpdates } from "./auto-updater";
// WIP module — conditionally loaded from src/private
let isWipKeyValid: (() => boolean) | null = null;
let wipItems: string[] = [];
try {
  const gate = require("../private/wip/gate");
  isWipKeyValid = gate.isWipKeyValid;
  wipItems = require("../private/wip/items.json");
} catch {
  // Private wip module not available — feature hidden
}

const user32Pick = koffi.load("user32.dll");
const POINT_PICK = koffi.struct("POINT_PICK", { x: "int32", y: "int32" });
const GetAsyncKeyState = user32Pick.func("int16 GetAsyncKeyState(int32 vKey)");
const GetCursorPosFn = user32Pick.func("bool GetCursorPos(_Out_ POINT_PICK *lpPoint)");

// Load persisted settings
const savedSettings = loadSettings();
let currencyConfig: CurrencyConfig = savedSettings.currencyConfig;
let actionDelay = savedSettings.actionDelay;
let sortDelay = savedSettings.sortDelay ?? 150;
let sortBatchSize = savedSettings.sortBatchSize ?? 24;
let buffConfig: BuffConfig = savedSettings.buffConfig;
let poesessid: string = savedSettings.poesessid ?? "";
let lmsModel: string = savedSettings.lmsModel ?? "lightonocr-2-1b";
let sortResumeResolve: (() => void) | null = null;
let captureOverlayWindow: BrowserWindow | null = null;
const buffTracker = new BuffTracker();

function persistSettings() {
  saveSettings({ currencyConfig, actionDelay, sortDelay, sortBatchSize, buffConfig, poesessid, lmsModel });
}

let hudWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let priceOverlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let monitor: MonitorBounds;

const isDev = !!process.env.VITE_DEV_SERVER;

// NOTE: Do NOT call app.disableHardwareAcceleration() — it prevents transparent windows from rendering on Windows

function getPreloadPath() {
  return path.join(__dirname, "preload.js");
}

function getRendererURL(page: string) {
  if (isDev) {
    return `http://localhost:5173/${page}.html`;
  }
  return `file://${path.join(__dirname, "../renderer", `${page}.html`)}`;
}

function createHudWindow() {
  const logicalWidth = Math.round(monitor.width / monitor.scaleFactor);
  const logicalHeight = Math.round(monitor.height / monitor.scaleFactor);
  const logicalX = Math.round(monitor.x / monitor.scaleFactor);
  const logicalY = Math.round(monitor.y / monitor.scaleFactor);

  console.log(`HUD window: ${logicalWidth}x${logicalHeight} at (${logicalX}, ${logicalY})`);

  hudWindow = new BrowserWindow({
    x: logicalX,
    y: logicalY,
    width: logicalWidth,
    height: logicalHeight,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  hudWindow.setAlwaysOnTop(true, "screen-saver");
  hudWindow.setIgnoreMouseEvents(true);
  hudWindow.loadURL(getRendererURL("hud"));

  hudWindow.webContents.once("did-finish-load", () => {
    hudWindow?.webContents.send("buff-config-sync", {
      captureRegion: buffConfig.captureRegion,
      hideOverlay: buffConfig.hideOverlay,
      scaleFactor: monitor.scaleFactor,
    });
  });
}

function createSettingsWindow() {
  const width = 560;
  const height = 560;
  const x = Math.round(
    monitor.x / monitor.scaleFactor +
      (monitor.width / monitor.scaleFactor - width) / 2
  );
  const y = Math.round(
    monitor.y / monitor.scaleFactor +
      (monitor.height / monitor.scaleFactor - height) / 2
  );

  settingsWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    resizable: false,
    show: true,
    hasShadow: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.setAlwaysOnTop(true, "screen-saver");
  settingsWindow.loadURL(getRendererURL("settings"));

  // Escape key hides settings
  settingsWindow.webContents.on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" && input.key === "Escape") {
      settingsWindow?.hide();
    }
  });

  // Prevent close from destroying — just hide instead
  settingsWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      settingsWindow?.hide();
    }
  });
}

function toggleSettings() {
  if (!settingsWindow) return;
  if (settingsWindow.isVisible()) {
    settingsWindow.hide();
  } else {
    settingsWindow.show();
    settingsWindow.focus();
  }
}

let captureOverlayData: { buffer: string; width: number; height: number; buffCount: number } | null = null;

function openCaptureOverlay() {
  if (captureOverlayWindow) {
    captureOverlayWindow.focus();
    return;
  }
  settingsWindow?.hide();

  // Capture screen BEFORE opening overlay window
  const capture = captureScreen({
    x: monitor.x,
    y: monitor.y,
    width: monitor.width,
    height: monitor.height,
  });
  captureOverlayData = {
    buffer: capture.buffer.toString("base64"),
    width: capture.width,
    height: capture.height,
    buffCount: buffConfig.buffs.length,
  };

  const logicalWidth = Math.round(monitor.width / monitor.scaleFactor);
  const logicalHeight = Math.round(monitor.height / monitor.scaleFactor);

  captureOverlayWindow = new BrowserWindow({
    x: Math.round(monitor.x / monitor.scaleFactor),
    y: Math.round(monitor.y / monitor.scaleFactor),
    width: logicalWidth,
    height: logicalHeight,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    resizable: false,
    fullscreen: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  captureOverlayWindow.setAlwaysOnTop(true, "screen-saver");
  captureOverlayWindow.loadURL(getRendererURL("capture"));

  captureOverlayWindow.on("closed", () => {
    captureOverlayWindow = null;
    captureOverlayData = null;
  });
}

async function toggleBuffTracker() {
  if (buffTracker.isRunning) {
    buffTracker.stop();
    hudWindow?.webContents.send("buff-update", null);
    console.log("Buff alarm disabled");
  } else {
    await buffTracker.init(buffConfig, (states) => {
      hudWindow?.webContents.send("buff-update", states);
    });
    buffTracker.start();
    hudWindow?.webContents.send("buff-config-sync", {
      captureRegion: buffConfig.captureRegion,
      hideOverlay: buffConfig.hideOverlay,
      scaleFactor: monitor.scaleFactor,
    });
    console.log("Buff alarm enabled");
  }
}

let isQuitting = false;
let cancelMacro = false;

async function triggerPriceCheck() {
  console.log("[price-check] Triggered");
  try {
    const rows = await readRewardPanel();
    if (rows.length === 0) {
      console.log("[price-check] No rows detected");
      return;
    }
    const matches = matchPrices(rows);
    const verisiumStatus = getVerisiumStatus();
    const verisiumPrices = getVerisiumPrices();

    const priceRows = matches.map((m) => {
      // Check if this is a Skill: or Support: line for verisium pricing
      const skillMatch = m.name.match(/^Skill(?:\s+Level\s+\d+)?:?\s+(.+)$/i);
      const supportMatch = m.name.match(/^Support:?\s+(.+)$/i);
      const gemName = skillMatch?.[1]?.trim() || supportMatch?.[1]?.trim();

      if (gemName) {
        // This is a verisium gem — use trade API price
        const allGems = [...VERISIUM_SKILLS, ...VERISIUM_SUPPORTS];
        const matchedGem = allGems.find((g) => g.toLowerCase() === gemName.toLowerCase());

        if (matchedGem) {
          const price = verisiumPrices[matchedGem];

          if (verisiumStatus.valid === false) {
            // Session is invalid/expired
            return {
              y: Math.round((m.y + m.height / 2) / monitor.scaleFactor),
              name: m.name,
              matchedName: matchedGem,
              exaltValue: 0,
              divineValue: 0,
              confidence: 0,
              verisiumNote: "expired or invalid POESESSID",
            };
          }

          if (price) {
            return {
              y: Math.round((m.y + m.height / 2) / monitor.scaleFactor),
              name: m.name,
              matchedName: matchedGem,
              exaltValue: toExaltValue(price.amount, price.currency),
              divineValue: 0,
              confidence: 1,
              verisiumCurrency: price.currency,
            };
          }

          // Price not loaded yet or no results
          const note = verisiumStatus.state === "done" && matchedGem in verisiumPrices
            ? "no listing"
            : "?";
          return {
            y: Math.round((m.y + m.height / 2) / monitor.scaleFactor),
            name: m.name,
            matchedName: matchedGem,
            exaltValue: 0,
            divineValue: 0,
            confidence: 0,
            verisiumNote: note,
          };
        }
      }

      // Standard poe2scout pricing
      return {
        y: Math.round((m.y + m.height / 2) / monitor.scaleFactor),
        name: m.name,
        matchedName: m.price?.name || null,
        exaltValue: (m.price?.chaosValue || 0) * m.quantity,
        divineValue: (m.price?.divineValue || 0) * m.quantity,
        confidence: m.confidence,
      };
    });

    // Send OCR lines to settings window
    settingsWindow?.webContents.send("ocr-lines", matches.map((m) => m.name));

    showPriceOverlay(priceRows);
  } catch (e) {
    console.error("[price-check] Error:", e);
    try {
      const fs = require("fs");
      const path = require("path");
      const { app } = require("electron");
      fs.writeFileSync(path.join(app.getPath("userData"), "price-check-error.log"), String(e) + "\n" + (e as any)?.stack);
    } catch {}
  }
}

function showPriceOverlay(priceRows: { y: number; name: string; matchedName: string | null; exaltValue: number; divineValue: number; confidence: number; verisiumNote?: string; verisiumCurrency?: string }[]) {
  const panel = getPanelBounds();
  const scale = monitor.scaleFactor;
  // Position 50px to the right of the panel
  const x = Math.round((panel.x + panel.width) / scale) + 50;
  const y = Math.round(panel.y / scale);
  const width = 200;
  const height = Math.round(panel.height / scale);

  if (!priceOverlayWindow) {
    priceOverlayWindow = new BrowserWindow({
      x, y, width, height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      hasShadow: false,
      webPreferences: {
        preload: getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    priceOverlayWindow.setAlwaysOnTop(true, "screen-saver");
    priceOverlayWindow.setIgnoreMouseEvents(true);
    priceOverlayWindow.loadURL(getRendererURL("price-overlay"));
    priceOverlayWindow.on("closed", () => { priceOverlayWindow = null; });
  } else {
    priceOverlayWindow.setBounds({ x, y, width, height });
    priceOverlayWindow.show();
  }

  // Send results once page is ready
  priceOverlayWindow.webContents.once("did-finish-load", () => {
    priceOverlayWindow?.webContents.send("price-results", priceRows);
  });
  if (!priceOverlayWindow.webContents.isLoading()) {
    priceOverlayWindow.webContents.send("price-results", priceRows);
  }

  // Hide on click in capture area (poll mouse)
  startClickDismiss();
}

function startClickDismiss() {
  const panel = getPanelBounds();
  const poll = setInterval(() => {
    if (!priceOverlayWindow || !priceOverlayWindow.isVisible()) {
      clearInterval(poll);
      return;
    }
    const state = GetAsyncKeyState(0x01); // VK_LBUTTON
    if (state & 0x8000) {
      const pt = { x: 0, y: 0 };
      GetCursorPosFn(pt);
      if (pt.x >= panel.x && pt.x <= panel.x + panel.width &&
          pt.y >= panel.y && pt.y <= panel.y + panel.height) {
        priceOverlayWindow?.hide();
        clearInterval(poll);
      }
    }
  }, 50);
}

const VK_ESCAPE = 0x1B;
const VK_X = 0x58;
function isCancelled(): boolean {
  if (cancelMacro) return true;
  // Poll Escape or X key — works even when shift is held
  const escState = GetAsyncKeyState(VK_ESCAPE);
  const xState = GetAsyncKeyState(VK_X);
  if ((escState & 0x8000) || (xState & 0x8000)) {
    cancelMacro = true;
    console.log("Cancel requested");
    return true;
  }
  return false;
}
let lastDetection: GridDetectionResult | null = null;

async function runMovementTest() {
  cancelMacro = false;

  // Step 1: Detect stash tab type
  console.log("=== Starting Waystone Macro ===");
  const settingsWasVisible = settingsWindow?.isVisible() ?? false;
  if (settingsWasVisible) settingsWindow!.hide();
  const hudWasVisible = hudWindow?.isVisible() ?? false;
  if (hudWasVisible) hudWindow!.hide();
  await new Promise((r) => setTimeout(r, 150));

  const capture = captureScreen({
    x: monitor.x,
    y: monitor.y,
    width: Math.floor(monitor.width / 2),
    height: monitor.height,
  });

  const detection = detectGridAuto(capture);
  lastDetection = detection;
  console.log(detection.debug);

  if (hudWasVisible) hudWindow!.show();

  // Notify settings of detection result
  settingsWindow?.webContents.send("stash-detected", detection.tabType);

  if (detection.tabType === "unknown") {
    console.log("Failed to detect stash tab type");
    if (settingsWasVisible) { settingsWindow!.show(); settingsWindow!.focus(); }
    return;
  }

  const layout = computeGridLayout(detection, monitor.height);
  if (!layout) {
    console.log("Failed to compute grid layout");
    if (settingsWasVisible) { settingsWindow!.show(); settingsWindow!.focus(); }
    return;
  }

  console.log(`Detected: ${detection.tabType} (${layout.columns}x${layout.rows})`);

  // Step 2: Scan stash using search bar filters
  const captureRegion = {
    x: monitor.x + layout.startX,
    y: monitor.y + layout.startY,
    width: Math.round(layout.columns * layout.cellWidth) + 10,
    height: Math.round(layout.rows * layout.cellHeight) + 10,
  };

  const scanResult = await scanStash(layout, monitor.width, monitor.height, captureRegion);
  printGridSummary(scanResult);

  if (isCancelled()) {
    console.log("Cancelled during scan");
    if (settingsWasVisible) { settingsWindow!.show(); settingsWindow!.focus(); }
    return;
  }

  // Step 3: Apply currency
  console.log("\n=== Applying Currency ===");
  const result = await applyCurrency(scanResult, layout, currencyConfig, actionDelay, isCancelled, (current, total) => {
    hudWindow?.webContents.send("macro-progress", { current, total });
  });
  hudWindow?.webContents.send("macro-progress", null);
  console.log(`Macro result: ${result}`);

  if (settingsWasVisible) { settingsWindow!.show(); settingsWindow!.focus(); }
}

async function runSort(mode: SortMode) {
  cancelMacro = false;
  console.log(`=== Starting Sort (${mode}) ===`);

  const settingsWasVisible = settingsWindow?.isVisible() ?? false;
  if (settingsWasVisible) settingsWindow!.hide();
  const hudWasVisible = hudWindow?.isVisible() ?? false;
  if (hudWasVisible) hudWindow!.hide();
  await new Promise((r) => setTimeout(r, 150));

  const capture = captureScreen({
    x: monitor.x,
    y: monitor.y,
    width: Math.floor(monitor.width / 2),
    height: monitor.height,
  });

  const detection = detectGridAuto(capture);
  if (hudWasVisible) hudWindow!.show();

  if (detection.tabType === "unknown") {
    console.log(`Sort: failed to detect stash tab type`);
    if (settingsWasVisible) { settingsWindow!.show(); settingsWindow!.focus(); }
    return;
  }

  const layout = computeGridLayout(detection, monitor.height);
  if (!layout) {
    if (settingsWasVisible) { settingsWindow!.show(); settingsWindow!.focus(); }
    return;
  }

  const captureRegion = {
    x: monitor.x + layout.startX,
    y: monitor.y + layout.startY,
    width: Math.round(layout.columns * layout.cellWidth) + 10,
    height: Math.round(layout.rows * layout.cellHeight) + 10,
  };

  const result = await sortStash(layout, monitor.width, monitor.height, captureRegion, mode, sortDelay, sortBatchSize, {
    onCancel: isCancelled,
    onProgress: (current, total, message) => {
      hudWindow?.webContents.send("macro-progress", { current, total, message });
    },
    onPause: () => new Promise<void>((resolve) => {
      sortResumeResolve = resolve;
      settingsWindow?.show();
      settingsWindow?.focus();
    }),
  });

  hudWindow?.webContents.send("macro-progress", null);
  console.log(`Sort result: ${result}`);
  if (settingsWasVisible) { settingsWindow!.show(); settingsWindow!.focus(); }
}

async function runShiftInsert() {
  cancelMacro = false;
  console.log("=== Starting Shift-Insert ===");

  const settingsWasVisible = settingsWindow?.isVisible() ?? false;
  if (settingsWasVisible) settingsWindow!.hide();
  const hudWasVisible = hudWindow?.isVisible() ?? false;
  if (hudWasVisible) hudWindow!.hide();
  await new Promise((r) => setTimeout(r, 150));

  const result = await shiftInsert(monitor, sortDelay, isCancelled, (current, total) => {
    hudWindow?.webContents.send("macro-progress", { current, total });
  });

  if (hudWasVisible) hudWindow!.show();
  hudWindow?.webContents.send("macro-progress", null);
  console.log(`Shift-insert result: ${result}`);
  if (settingsWasVisible) { settingsWindow!.show(); settingsWindow!.focus(); }
}

function createTray() {
  // Load tray icon from file (packaged: resources/icons/tray.png, dev: src/icons/v1/small32.png)
  const trayIconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icons", "tray.png")
    : path.join(process.cwd(), "src", "icons", "v1", "small32.png");
  const icon = nativeImage.createFromPath(trayIconPath);

  tray = new Tray(icon);
  tray.setToolTip("PoE2-Tools");

  const contextMenu = Menu.buildFromTemplate([
    { label: "Show Settings", click: () => toggleSettings() },
    { label: "Check for Updates", click: () => checkForUpdates() },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => toggleSettings());
}

app.whenReady().then(() => {
  monitor = getPrimaryMonitor();
  console.log(
    `Primary monitor: ${monitor.width}x${monitor.height} @ ${monitor.scaleFactor}x scale`
  );

  createTray();
  createHudWindow();
  createSettingsWindow();
  startHook();
  startPriceFetcher();
  loadCurrencyMap();
  initAutoUpdater(getPreloadPath, getRendererURL);

  // Start verisium trade price fetcher
  onVerisiumStatusChange((status) => {
    settingsWindow?.webContents.send("verisium-status", status);
  });
  if (poesessid) {
    startVerisiumFetcher(poesessid);
  }

  // Use Ctrl+F12 to avoid conflicts with browser DevTools F12
  globalShortcut.register("CommandOrControl+F12", toggleSettings);

  // Ctrl+F10: run full macro
  globalShortcut.register("CommandOrControl+F10", runMovementTest);

  // F8: toggle buff alarm
  globalShortcut.register("F8", toggleBuffTracker);

  // F7: price check reward panel
  globalShortcut.register("F7", triggerPriceCheck);

  // F6: stash shift-insert
  globalShortcut.register("F6", runShiftInsert);

  ipcMain.on("dismiss-price-overlay", () => {
    priceOverlayWindow?.hide();
  });

  // Cancel: poll Escape via GetAsyncKeyState during macro (works even with shift held)
  // No global shortcut needed — check in onCancel callback

  ipcMain.on("close-settings", () => {
    settingsWindow?.hide();
  });

  ipcMain.handle("get-settings", () => {
    return { currencyConfig, actionDelay, sortDelay, sortBatchSize };
  });

  ipcMain.handle("get-verisium-prices", () => {
    return getVerisiumPrices();
  });

  ipcMain.handle("get-poesessid", () => {
    return poesessid;
  });

  ipcMain.handle("check-wip-key", () => {
    return isWipKeyValid ? isWipKeyValid() : false;
  });

  ipcMain.handle("get-wip-items", () => {
    return wipItems;
  });

  // LM Studio management (only if wip module available)
  ipcMain.handle("get-lms-status", () => {
    try {
      const { getLmsStatus } = require("../private/wip/lms");
      return getLmsStatus();
    } catch { return { serverRunning: false, modelLoaded: false, modelName: null }; }
  });

  ipcMain.handle("ensure-lms-ready", async () => {
    try {
      const { ensureLmsReady } = require("../private/wip/lms");
      return await ensureLmsReady();
    } catch { return false; }
  });

  ipcMain.on("kill-lms", () => {
    try {
      const { killLms } = require("../private/wip/lms");
      killLms();
    } catch {}
  });

  ipcMain.handle("list-lms-models", () => {
    try {
      const { listLmsModels } = require("../private/wip/lms");
      return listLmsModels();
    } catch { return []; }
  });

  ipcMain.handle("get-lms-model", () => {
    return lmsModel;
  });

  ipcMain.on("set-lms-model", (_e, model: string) => {
    lmsModel = model;
    persistSettings();
  });

  let cancelWipScan = false;

  ipcMain.handle("start-wip-scan", async (_e, selectedItem: string) => {
    cancelWipScan = false;
    try {
      const { ensureLmsReady } = require("../private/wip/lms");
      const { runWipScan } = require("../private/wip/scanner");
      const { analyzeWip } = require("../private/wip/analyzer");

      const lmsReady = await ensureLmsReady(lmsModel);
      if (!lmsReady) {
        console.error("[wip] LM Studio not ready, aborting scan");
        return null;
      }

      const result = await runWipScan(
        selectedItem,
        () => cancelWipScan,
        (current: number, total: number, pair: string) => {
          settingsWindow?.webContents.send("wip-progress", { current, total, pair });
        }
      );

      if (!result) return null;

      const analysis = analyzeWip(result);
      return { ...analysis, selectedItem };
    } catch {
      console.error("[wip] Private module not available");
      return null;
    }
  });

  ipcMain.on("cancel-wip-scan", () => {
    cancelWipScan = true;
  });

  ipcMain.on("set-poesessid", (_e, sessid: string) => {
    poesessid = sessid;
    persistSettings();
    updateSessionId(sessid);
  });

  ipcMain.on("clear-verisium-cache", () => {
    clearVerisiumCaches();
  });

  ipcMain.handle("get-price-cache-timestamps", () => {
    const userData = app.getPath("userData");
    const priceCachePath = path.join(userData, "price-cache.json");
    const verisiumCachePath = path.join(userData, "verisium-price-cache.json");
    let priceCache: number | null = null;
    let verisiumCache: number | null = null;
    try { priceCache = fs.statSync(priceCachePath).mtimeMs; } catch {}
    try { verisiumCache = fs.statSync(verisiumCachePath).mtimeMs; } catch {}
    return { priceCache, verisiumCache };
  });

  // Update currency config from renderer
  ipcMain.on("update-currency-config", (_e, config: CurrencyConfig) => {
    currencyConfig = config;
    persistSettings();
    console.log("Currency config updated");
  });

  ipcMain.on("update-action-delay", (_e, delay: number) => {
    actionDelay = delay;
    persistSettings();
  });

  // Update a single orb position
  ipcMain.on("set-orb-position", (_e, data: { slot: string; position: { x: number; y: number } }) => {
    const key = data.slot as keyof CurrencyConfig;
    if (currencyConfig[key]) {
      currencyConfig[key].position = data.position;
      persistSettings();
      console.log(`Set ${data.slot} orb position: (${data.position.x}, ${data.position.y})`);
    }
  });

  ipcMain.on("set-orb-currency", (_e, data: { slot: string; currency: string }) => {
    const key = data.slot as keyof CurrencyConfig;
    if (currencyConfig[key]) {
      currencyConfig[key].currency = data.currency as CurrencyChoice;
      persistSettings();
    }
  });

  ipcMain.on("start-macro", () => {
    runMovementTest();
  });

  ipcMain.on("start-sort", (_e, mode: string) => {
    runSort(mode as "pack_size" | "rarity" | "monster_rarity" | "drop_chance");
  });

  ipcMain.on("start-shift-insert", () => {
    runShiftInsert();
  });

  ipcMain.on("update-sort-delay", (_e, delay: number) => {
    sortDelay = delay;
    persistSettings();
  });

  ipcMain.on("update-sort-batch", (_e, size: number) => {
    sortBatchSize = size;
    persistSettings();
  });

  ipcMain.on("resume-sort", () => {
    if (sortResumeResolve) {
      const resolve = sortResumeResolve;
      sortResumeResolve = null;
      resolve();
    }
  });

  // Buff alarm IPC
  ipcMain.handle("get-buff-config", () => buffConfig);

  ipcMain.on("set-buff-alarm-cadence", (_e, cadence: number) => {
    buffConfig.alarmCadence = cadence;
    persistSettings();
  });

  ipcMain.on("set-buff-hide-overlay", (_e, hide: boolean) => {
    buffConfig.hideOverlay = hide;
    persistSettings();
    hudWindow?.webContents.send("buff-config-sync", {
      captureRegion: buffConfig.captureRegion,
      hideOverlay: buffConfig.hideOverlay,
      scaleFactor: monitor.scaleFactor,
    });
  });

  ipcMain.on("add-buff", () => {
    buffConfig.buffs.push({ label: `Buff ${buffConfig.buffs.length + 1}`, templatePath: null, alarmSound: null, enabled: true, timerRegion: null });
    persistSettings();
  });

  ipcMain.on("remove-buff", (_e, index: number) => {
    if (index > 0 && index < buffConfig.buffs.length) {
      buffConfig.buffs.splice(index, 1);
      persistSettings();
    }
  });

  ipcMain.handle("set-buff-alarm-sound", async (_e, index: number) => {
    const result = await dialog.showOpenDialog({
      title: `Select alarm sound for ${buffConfig.buffs[index]?.label}`,
      filters: [{ name: "Audio", extensions: ["mp3", "wav", "ogg"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch {
      console.error(`Cannot read alarm sound file: ${filePath}`);
      return null;
    }
    buffConfig.buffs[index].alarmSound = filePath;
    persistSettings();
    return filePath;
  });

  ipcMain.on("start-buff-capture", () => {
    openCaptureOverlay();
  });

  ipcMain.on("enable-buff-tracker", () => {
    if (!buffTracker.isRunning) toggleBuffTracker();
  });

  ipcMain.on("disable-buff-tracker", () => {
    if (buffTracker.isRunning) toggleBuffTracker();
  });

  // Capture overlay IPC
  ipcMain.on("capture-overlay-apply", async (_e, data: { captureRegion: any; templates: { index: number; rect: any; timerRect: any }[] }) => {
    if (data.captureRegion) {
      buffConfig.captureRegion = data.captureRegion;
    }

    // Save templates as PNG files cropped from the captured screenshot
    const templateDir = path.join(app.getPath("userData"), "buff-templates");
    if (!fs.existsSync(templateDir)) fs.mkdirSync(templateDir, { recursive: true });

    if (captureOverlayData) {
      const raw = Buffer.from(captureOverlayData.buffer, "base64");
      const fullWidth = captureOverlayData.width;
      const fullHeight = captureOverlayData.height;
      const sharp = require("sharp");

      // BitBlt gives BGRA — swap to RGBA for sharp
      for (let i = 0; i < raw.length; i += 4) {
        const b = raw[i];
        raw[i] = raw[i + 2];
        raw[i + 2] = b;
      }

      for (const tpl of data.templates) {
        if (tpl.index >= buffConfig.buffs.length) continue;

        // Save timer region (Y range only — X comes from detected icon position at runtime)
        if (tpl.timerRect) {
          buffConfig.buffs[tpl.index].timerRegion = {
            yStart: tpl.timerRect.y,
            yEnd: tpl.timerRect.y + tpl.timerRect.height,
          };
          console.log(`Saved timer region for buff ${tpl.index}: y=${tpl.timerRect.y}..${tpl.timerRect.y + tpl.timerRect.height}`);
        }

        // Save buff icon template
        if (tpl.rect) {
          const { x, y, width, height } = tpl.rect;
          const cx = Math.max(0, Math.min(x, fullWidth - 1));
          const cy = Math.max(0, Math.min(y, fullHeight - 1));
          const cw = Math.min(width, fullWidth - cx);
          const ch = Math.min(height, fullHeight - cy);

          if (cw > 0 && ch > 0) {
            const filePath = path.join(templateDir, `buff_${tpl.index}.png`);
            try {
              await sharp(raw, { raw: { width: fullWidth, height: fullHeight, channels: 4 } })
                .extract({ left: cx, top: cy, width: cw, height: ch })
                .png()
                .toFile(filePath);
              buffConfig.buffs[tpl.index].templatePath = filePath;
              console.log(`Saved buff template ${tpl.index}: ${cw}x${ch} at (${cx},${cy})`);
            } catch (err) {
              console.error(`Failed to save buff template ${tpl.index}:`, err);
            }
          }
        }
      }
    }

    persistSettings();
    captureOverlayWindow?.close();
    captureOverlayWindow = null;
    hudWindow?.webContents.send("buff-config-sync", {
      captureRegion: buffConfig.captureRegion,
      hideOverlay: buffConfig.hideOverlay,
      scaleFactor: monitor.scaleFactor,
    });
    settingsWindow?.show();
    settingsWindow?.focus();
  });

  ipcMain.on("capture-overlay-cancel", () => {
    captureOverlayWindow?.close();
    captureOverlayWindow = null;
    settingsWindow?.show();
    settingsWindow?.focus();
  });

  ipcMain.handle("get-capture-data", () => {
    return captureOverlayData;
  });

  // Pick position: hide settings, enter pick mode (next click is intercepted)
  ipcMain.on("pick-position", async (event) => {
    settingsWindow?.hide();
    await new Promise((r) => setTimeout(r, 200));

    // Get cursor position to show hint near it
    const ptStruct = { x: 0, y: 0 };
    GetCursorPosFn(ptStruct);
    // Convert physical to logical for renderer
    const hintX = Math.round(ptStruct.x / monitor.scaleFactor);
    const hintY = Math.round(ptStruct.y / monitor.scaleFactor);

    hudWindow?.webContents.send("pick-mode", true, { x: hintX, y: hintY });

    enterPickMode((pos) => {
      hudWindow?.webContents.send("pick-mode", false);
      event.sender.send("position-picked", pos);
      console.log(`Picked position: (${pos.x}, ${pos.y})`);
      setTimeout(() => {
        settingsWindow?.show();
        settingsWindow?.focus();
      }, 200);
    });
  });
});

// Don't quit when all windows hidden
app.on("window-all-closed", () => {
  // Keep running in tray
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
