import path from "path";
import fs from "fs";

/**
 * Alarm manages repeating sound playback for a single buff.
 * Uses Electron's built-in shell to play audio via a hidden BrowserWindow isn't ideal,
 * so we use the 'child_process' approach with PowerShell for WAV/MP3 on Windows.
 */

import { exec, ChildProcess } from "child_process";

export class Alarm {
  private soundPath: string | null = null;
  private cadenceMs: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private proc: ChildProcess | null = null;

  constructor(cadenceMs = 1500) {
    this.cadenceMs = cadenceMs;
  }

  /** Load alarm sound file. Returns false if file unreadable. */
  load(filePath: string | null): boolean {
    if (!filePath) { this.soundPath = null; return false; }
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
      this.soundPath = filePath;
      return true;
    } catch {
      this.soundPath = null;
      return false;
    }
  }

  setCadence(ms: number) {
    this.cadenceMs = ms;
  }

  /** Start repeating alarm at cadence (start-to-start). */
  start() {
    if (!this.soundPath || this.interval) return;
    this.playOnce();
    this.interval = setInterval(() => this.playOnce(), this.cadenceMs);
  }

  /** Stop alarm. */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.killProc();
  }

  get isPlaying(): boolean {
    return this.interval !== null;
  }

  private playOnce() {
    if (!this.soundPath) return;
    // Kill previous to prevent overlap
    this.killProc();
    const ext = path.extname(this.soundPath).toLowerCase();
    // Use PowerShell MediaPlayer for mp3/wav/ogg
    const escaped = this.soundPath.replace(/'/g, "''");
    const cmd = `powershell -NoProfile -Command "Add-Type -AssemblyName PresentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([Uri]'${escaped}'); $p.Play(); Start-Sleep -Milliseconds ${this.cadenceMs - 100}; $p.Close()"`;
    try {
      this.proc = exec(cmd);
      this.proc.on("exit", () => { this.proc = null; });
    } catch {
      // Ignore playback errors
    }
  }

  private killProc() {
    if (this.proc) {
      try { this.proc.kill(); } catch {}
      this.proc = null;
    }
  }
}
