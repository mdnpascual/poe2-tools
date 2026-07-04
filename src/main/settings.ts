import { app } from "electron";
import path from "path";
import fs from "fs";
import { CurrencyConfig } from "./automation/currency";

export interface BuffEntry {
  label: string;
  templatePath: string | null;
  alarmSound: string | null;
  enabled: boolean;
  timerRegion: { yStart: number; yEnd: number } | null;
}

export interface BuffConfig {
  buffs: BuffEntry[];
  captureRegion: { x: number; y: number; width: number; height: number } | null;
  alarmCadence: number;
  hideOverlay: boolean;
}

export interface AppSettings {
  currencyConfig: CurrencyConfig;
  actionDelay: number;
  sortDelay: number;
  sortBatchSize: number;
  buffConfig: BuffConfig;
  poesessid: string;
  lmsModel: string;
}

const settingsPath = path.join(app.getPath("userData"), "settings.json");

const defaults: AppSettings = {
  currencyConfig: {
    normal: { currency: "alchemy", position: null },
    magic1: { currency: "alchemy", position: null },
    magic2: { currency: "alchemy", position: null },
    rare: { currency: "exalted", position: null },
    corrupt: { currency: "vaal", position: null },
  },
  actionDelay: 250,
  sortDelay: 150,
  sortBatchSize: 24,
  buffConfig: {
    buffs: [
      { label: "Buff 1", templatePath: null, alarmSound: null, enabled: true, timerRegion: null },
      { label: "Buff 2", templatePath: null, alarmSound: null, enabled: true, timerRegion: null },
    ],
    captureRegion: null,
    alarmCadence: 1.5,
    hideOverlay: false,
  },
  poesessid: "",
  lmsModel: "lightonocr-2-1b",
};

export function loadSettings(): AppSettings {
  try {
    const data = fs.readFileSync(settingsPath, "utf-8");
    return { ...defaults, ...JSON.parse(data) };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(settings: AppSettings): void {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}
