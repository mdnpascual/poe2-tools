/**
 * Auto-updater for NSIS-installed builds.
 * Checks GitHub releases on startup, shows changelog, asks user to confirm update.
 */
import { autoUpdater, UpdateInfo } from "electron-updater";
import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";

let updateWindow: BrowserWindow | null = null;
let pendingUpdate: UpdateInfo | null = null;

export function initAutoUpdater(getPreloadPath: () => string, getRendererURL: (page: string) => string): void {
  // Don't run in dev mode
  if (!app.isPackaged) {
    console.log("[updater] Skipping update check (dev mode)");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // We'll ask first

  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] Checking for update...");
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[updater] Update available: v${info.version}`);
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] App is up to date");
  });

  autoUpdater.on("download-progress", (progress) => {
    console.log(`[updater] Download: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[updater] Update downloaded: v${info.version}`);
    pendingUpdate = info;
    showUpdateWindow(getPreloadPath, getRendererURL);
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater] Error:", err.message);
  });

  // IPC handlers for the update window
  ipcMain.handle("get-update-info", () => {
    if (!pendingUpdate) return null;
    let notes = "";
    if (typeof pendingUpdate.releaseNotes === "string") {
      notes = pendingUpdate.releaseNotes;
    } else if (Array.isArray(pendingUpdate.releaseNotes)) {
      notes = pendingUpdate.releaseNotes
        .map((rn: any) => (typeof rn === "string" ? rn : rn.note || ""))
        .join("\n\n");
    }
    // Strip HTML tags from notes
    notes = notes.replace(/<[^>]*>/g, "");
    return {
      currentVersion: app.getVersion(),
      newVersion: pendingUpdate.version,
      releaseDate: pendingUpdate.releaseDate,
      releaseNotes: notes || "No release notes available.",
    };
  });

  ipcMain.on("update-install", () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.on("update-dismiss", () => {
    updateWindow?.close();
    updateWindow = null;
  });

  // Check for updates after a short delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("[updater] Check failed:", err.message);
    });
  }, 5000);
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch((err) => {
    console.error("[updater] Manual check failed:", err.message);
  });
}

function showUpdateWindow(getPreloadPath: () => string, getRendererURL: (page: string) => string): void {
  if (updateWindow) {
    updateWindow.focus();
    return;
  }

  updateWindow = new BrowserWindow({
    width: 450,
    height: 380,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    transparent: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  updateWindow.loadURL(getRendererURL("update"));

  updateWindow.on("closed", () => {
    updateWindow = null;
  });
}
