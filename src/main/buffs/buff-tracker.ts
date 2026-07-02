import { captureScreen } from "../capture/screen";
import { loadTemplate, detectIconPos, detectIconScore, BuffTemplate } from "./icon-detector";
import { loadDigitTemplates, readTimer } from "./digit-reader";
import { Alarm } from "./alarm";
import { BuffConfig, BuffEntry } from "../settings";
import { app } from "electron";
import path from "path";

type BuffState = "idle" | "active" | "alarming";

interface TrackedBuff {
  entry: BuffEntry;
  template: BuffTemplate | null;
  alarm: Alarm;
  state: BuffState;
  expiresAt: number; // Date.now() + seconds*1000 when buff expires
  lastOcrValue: number | null; // last successful OCR reading
}

export class BuffTracker {
  private buffs: TrackedBuff[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;
  private captureRegion: { x: number; y: number; width: number; height: number } | null = null;
  private onUpdate: ((states: { label: string; state: BuffState; countdown: number }[]) => void) | null = null;

  async init(config: BuffConfig, onUpdate?: (states: { label: string; state: BuffState; countdown: number }[]) => void) {
    this.captureRegion = config.captureRegion;
    this.onUpdate = onUpdate || null;
    this.buffs = [];

    // Load digit templates
    const digitDir = path.join(app.getPath("userData"), "digit-templates");
    await loadDigitTemplates(digitDir);

    for (const entry of config.buffs) {
      if (!entry.enabled) continue;
      const template = entry.templatePath ? await loadTemplate(entry.templatePath) : null;
      const alarm = new Alarm(config.alarmCadence * 1000);
      alarm.load(entry.alarmSound);
      this.buffs.push({ entry, template, alarm, state: "idle", expiresAt: 0, lastOcrValue: null });
    }
  }

  start() {
    if (this.interval || !this.captureRegion) return;
    console.log(`BuffTracker: started (${this.buffs.length} buffs, region ${JSON.stringify(this.captureRegion)})`);
    this.interval = setInterval(() => this.tick(), 1000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    for (const b of this.buffs) {
      b.alarm.stop();
      b.state = "idle";
      b.expiresAt = 0;
      b.lastOcrValue = null;
    }
    this.emitUpdate();
    console.log("BuffTracker: stopped");
  }

  get isRunning(): boolean {
    return this.interval !== null;
  }

  private tick() {
    if (!this.captureRegion) return;

    const cap = captureScreen(this.captureRegion);

    for (const b of this.buffs) {
      if (!b.template) continue;

      const pos = detectIconPos(cap.buffer, cap.width, cap.height, b.template);
      const detected = pos.score >= 0.97;

      // Try to read timer if we have a timer region configured
      let ocrSeconds: number | null = null;
      if (b.entry.timerRegion && detected) {
        // X from detected icon position, Y from configured timer region
        // Timer region Y is absolute (full screen coords), offset by captureRegion.y
        const yStart = b.entry.timerRegion.yStart - this.captureRegion!.y - 3;
        const yEnd = b.entry.timerRegion.yEnd - this.captureRegion!.y + 3;
        // Use icon X as left edge, extend by icon width for timer text
        const xStart = pos.x;
        const xEnd = Math.min(pos.x + b.template!.width, cap.width);
        // Trim 15% from each side of X to remove icon border/UI edges
        const iconW = xEnd - xStart;
        const trimPx = Math.round(iconW * 0.15);
        const txStart = xStart + trimPx;
        const txEnd = xEnd - trimPx;
        ocrSeconds = readTimer(cap.buffer, cap.width, cap.height, txStart, txEnd, yStart, yEnd);
        if (ocrSeconds !== null) {
          b.lastOcrValue = ocrSeconds;
          b.expiresAt = Date.now() + ocrSeconds * 1000;
        }
      }

      const now = Date.now();

      switch (b.state) {
        case "idle":
          if (detected) {
            b.state = "active";
            b.expiresAt = ocrSeconds != null ? now + ocrSeconds * 1000 : now + 999000;
          }
          break;

        case "active":
          // Alarm when real time passes expiresAt (+1s grace)
          if (now > b.expiresAt + 1000) {
            b.state = "alarming";
            b.alarm.start();
          }
          break;

        case "alarming":
          if (detected) {
            // Buff is back — stop alarm
            b.alarm.stop();
            b.state = "active";
            b.expiresAt = ocrSeconds != null ? Date.now() + ocrSeconds * 1000 : Date.now() + 999000;
          }
          break;
      }
    }

    this.emitUpdate();
  }

  private emitUpdate() {
    if (this.onUpdate) {
      const now = Date.now();
      this.onUpdate(this.buffs.map(b => ({
        label: b.entry.label,
        state: b.state,
        countdown: Math.max(0, Math.round((b.expiresAt - now) / 1000)),
      })));
    }
  }
}
