import sharp from "sharp";
import fs from "fs";

// opencv-wasm loads synchronously
const { cv } = require("opencv-wasm");

export interface BuffTemplate {
  mat: any; // cv.Mat (grayscale)
  width: number;
  height: number;
}

/** Load a saved PNG template into an OpenCV Mat (grayscale) */
export async function loadTemplate(filePath: string): Promise<BuffTemplate | null> {
  try {
    if (!fs.existsSync(filePath)) return null;
    const { data, info } = await sharp(filePath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Create RGBA mat then convert to grayscale
    const rgba = cv.matFromImageData({ data, width: info.width, height: info.height });
    const gray = new cv.Mat();
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    rgba.delete();

    return { mat: gray, width: info.width, height: info.height };
  } catch (err) {
    console.error(`Failed to load template ${filePath}:`, err);
    return null;
  }
}

/**
 * Detect if template exists in the captured region using OpenCV matchTemplate.
 * Returns true if match confidence exceeds threshold.
 */
export function detectIcon(
  capture: Buffer,
  captureWidth: number,
  captureHeight: number,
  template: BuffTemplate,
  threshold = 0.97
): boolean {
  const result = detectIconPos(capture, captureWidth, captureHeight, template);
  return result.score >= threshold;
}

export interface DetectResult {
  score: number;
  x: number;
  y: number;
}

/**
 * Returns best match score and position.
 * Uses TM_CCOEFF_NORMED for illumination-invariant matching.
 */
export function detectIconPos(
  capture: Buffer,
  captureWidth: number,
  captureHeight: number,
  template: BuffTemplate,
): DetectResult {
  if (captureWidth < template.width || captureHeight < template.height) return { score: 0, x: 0, y: 0 };

  const srcRGBA = cv.matFromImageData({
    data: bgraToRgba(capture),
    width: captureWidth,
    height: captureHeight,
  });
  const srcGray = new cv.Mat();
  cv.cvtColor(srcRGBA, srcGray, cv.COLOR_RGBA2GRAY);
  srcRGBA.delete();

  const result = new cv.Mat();
  const mask = new cv.Mat();
  cv.matchTemplate(srcGray, template.mat, result, cv.TM_CCOEFF_NORMED, mask);

  const minMax = cv.minMaxLoc(result);
  const score = minMax.maxVal;
  const x = minMax.maxLoc.x;
  const y = minMax.maxLoc.y;

  result.delete();
  mask.delete();
  srcGray.delete();

  return { score, x, y };
}

/** Keep for backward compat */
export function detectIconScore(
  capture: Buffer,
  captureWidth: number,
  captureHeight: number,
  template: BuffTemplate,
): number {
  return detectIconPos(capture, captureWidth, captureHeight, template).score;
}

/** Swap BGRA → RGBA in-place for cv.matFromImageData */
function bgraToRgba(bgra: Buffer): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2];     // R = B
    rgba[i + 1] = bgra[i + 1]; // G
    rgba[i + 2] = bgra[i];     // B = R
    rgba[i + 3] = bgra[i + 3]; // A
  }
  return rgba;
}
