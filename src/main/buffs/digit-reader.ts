import sharp from "sharp";
import fs from "fs";
import path from "path";

const { cv } = require("opencv-wasm");

interface DigitTemplate {
  mat: any; // cv.Mat binary (black/white)
  char: string;
}

let digitTemplates: DigitTemplate[] = [];

/** Convert grayscale mat to binary (high contrast black/white) */
function toBinary(gray: any): any {
  const binary = new cv.Mat();
  cv.threshold(gray, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  return binary;
}

import { app } from "electron";

/**
 * Load digit templates from a directory.
 * Expected files: digit_0.png ... digit_9.png, digit_colon.png
 * Checks bundled path first (extraResources in packaged, src/templates in dev), then user data fallback.
 * Templates are converted to binary for HDR-immune matching.
 */
export async function loadDigitTemplates(dir: string): Promise<boolean> {
  const bundledDir = app.isPackaged
    ? path.join(process.resourcesPath, "templates")
    : path.join(process.cwd(), "src", "templates");
  const searchDir = fs.existsSync(bundledDir) ? bundledDir : dir;
  console.log(`[Digits] checking bundled: ${bundledDir} exists=${fs.existsSync(bundledDir)}, using: ${searchDir}`);
  digitTemplates = [];
  const chars = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ":"];
  const files = ["digit-0.png", "digit-1.png", "digit-2.png", "digit-3.png", "digit-4.png",
    "digit-5.png", "digit-6.png", "digit-7.png", "digit-8.png", "digit-9.png", "digit-colon.png"];

  for (let i = 0; i < files.length; i++) {
    const filePath = path.join(searchDir, files[i]);
    if (!fs.existsSync(filePath)) continue;
    try {
      const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const rgba = cv.matFromImageData({ data, width: info.width, height: info.height });
      const gray = new cv.Mat();
      cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
      rgba.delete();
      const binary = toBinary(gray);
      gray.delete();
      digitTemplates.push({ mat: binary, char: chars[i] });
    } catch {
      // Skip unreadable templates
    }
  }
  console.log(`Loaded ${digitTemplates.length} digit templates from ${searchDir}`);
  return digitTemplates.length > 0;
}

/**
 * Read timer text from a BGRA buffer region.
 * Converts to binary before matching for HDR/brightness immunity.
 */
export function readTimer(
  capture: Buffer,
  captureWidth: number,
  captureHeight: number,
  xStart: number,
  xEnd: number,
  yStart: number,
  yEnd: number,
): number | null {
  if (digitTemplates.length === 0) return null;
  if (yStart < 0 || yEnd > captureHeight || xStart < 0 || xEnd > captureWidth) return null;

  const w = xEnd - xStart;
  const h = yEnd - yStart;
  if (w <= 0 || h <= 0) return null;

  // Extract timer strip from BGRA buffer
  const strip = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) {
    const srcOff = ((yStart + row) * captureWidth + xStart) * 4;
    const dstOff = row * w * 4;
    capture.copy(strip, dstOff, srcOff, srcOff + w * 4);
  }

  // Convert BGRA to RGBA for cv
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const off = i * 4;
    rgba[off] = strip[off + 2];
    rgba[off + 1] = strip[off + 1];
    rgba[off + 2] = strip[off];
    rgba[off + 3] = 255;
  }

  const src = cv.matFromImageData({ data: rgba, width: w, height: h });
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  src.delete();

  // Convert to binary — same as templates
  const binary = toBinary(gray);
  gray.delete();

  // Match each digit template against the binary strip
  const matches: { char: string; x: number; score: number }[] = [];

  for (const dt of digitTemplates) {
    if (dt.mat.rows > binary.rows || dt.mat.cols > binary.cols) continue;

    const result = new cv.Mat();
    const mask = new cv.Mat();
    cv.matchTemplate(binary, dt.mat, result, cv.TM_CCOEFF_NORMED, mask);

    const threshold = 0.75;
    for (let y = 0; y < result.rows; y++) {
      for (let x = 0; x < result.cols; x++) {
        const score = result.floatAt(y, x);
        if (score >= threshold) {
          const existing = matches.find(m => Math.abs(m.x - x) < dt.mat.cols * 0.5);
          if (!existing || score > existing.score) {
            if (existing) {
              existing.char = dt.char;
              existing.x = x;
              existing.score = score;
            } else {
              matches.push({ char: dt.char, x, score });
            }
          }
        }
      }
    }
    result.delete();
    mask.delete();
  }

  binary.delete();

  if (matches.length === 0) return null;

  // Sort by X position to read left-to-right
  matches.sort((a, b) => a.x - b.x);
  const text = matches.map(m => m.char).join("");

  return parseTimerText(text);
}

/** Parse "M:SS" or "SS" into total seconds */
function parseTimerText(text: string): number | null {
  const colonIdx = text.indexOf(":");
  if (colonIdx >= 0) {
    const mins = parseInt(text.slice(0, colonIdx), 10);
    const secs = parseInt(text.slice(colonIdx + 1), 10);
    if (isNaN(mins) || isNaN(secs)) return null;
    return mins * 60 + secs;
  }
  const secs = parseInt(text, 10);
  if (isNaN(secs)) return null;
  return secs;
}
