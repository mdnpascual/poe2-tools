import { createWorker, Worker } from "tesseract.js";
import sharp from "sharp";
import path from "path";
import { captureScreen } from "../capture/screen";

const { cv } = require("opencv-wasm");

// Reward panel bounds at 4K (physical pixels)
const PANEL = { x: 110, y: 305, width: 985, height: 1065 };

let worker: Worker | null = null;

async function getWorker(): Promise<Worker> {
  if (!worker) {
    // In packaged app, worker script is in app.asar.unpacked
    const workerPath = require.resolve("tesseract.js/src/worker-script/node/index.js")
      .replace("app.asar", "app.asar.unpacked");
    const corePath = require.resolve("tesseract.js-core/tesseract-core-simd-lstm.wasm")
      .replace("app.asar", "app.asar.unpacked");
    worker = await createWorker("eng", 1, {
      workerPath,
      corePath,
    });
    await worker.setParameters({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' -0123456789()",
      user_defined_dpi: "150",
    });
  }
  return worker;
}

export interface RowResult {
  y: number;
  height: number;
  text: string;
}

/**
 * Detect square rune icons using 3-pass contour detection.
 * Returns bounding rects of all detected squares.
 */
function detectSquareRects(gray: any): { x: number; y: number; width: number; height: number }[] {
  const minArea = 3000, maxArea = 10000, epsilonPct = 0.10, aspectTol = 0.05;

  function findSquares(edgeMat: any) {
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(edgeMat, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const rects: { x: number; y: number; width: number; height: number }[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < minArea || area > maxArea) continue;
      const peri = cv.arcLength(cnt, true);
      if (peri <= 0) continue;
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, epsilonPct * peri, true);
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const rect = cv.boundingRect(approx);
        const aspect = Math.min(rect.width, rect.height) / Math.max(rect.width, rect.height);
        if (aspect > (1 - aspectTol)) rects.push(rect);
      }
      approx.delete();
    }
    contours.delete(); hierarchy.delete();
    return rects;
  }

  const allRects: { x: number; y: number; width: number; height: number }[] = [];

  // Pass 1: Canny + dilate=1
  const edges1 = new cv.Mat();
  cv.Canny(gray, edges1, 115, 255);
  const k1 = cv.Mat.ones(3, 3, cv.CV_8U);
  cv.dilate(edges1, edges1, k1, new cv.Point(-1, -1), 1);
  k1.delete();
  allRects.push(...findSquares(edges1));
  edges1.delete();

  // Pass 2: Canny + dilate=0
  const edges2 = new cv.Mat();
  cv.Canny(gray, edges2, 115, 255);
  allRects.push(...findSquares(edges2));
  edges2.delete();

  // Pass 3: Adaptive threshold + morph close
  const thresh = new cv.Mat();
  cv.adaptiveThreshold(gray, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 51, -1);
  const k3 = cv.Mat.ones(3, 3, cv.CV_8U);
  cv.morphologyEx(thresh, thresh, cv.MORPH_CLOSE, k3, new cv.Point(-1, -1), 1);
  k3.delete();
  allRects.push(...findSquares(thresh));
  thresh.delete();

  // Deduplicate overlapping rects (IoU > 0.5)
  const unique: { x: number; y: number; width: number; height: number }[] = [];
  for (const r of allRects) {
    let dup = false;
    for (const u of unique) {
      const ox = Math.max(0, Math.min(r.x + r.width, u.x + u.width) - Math.max(r.x, u.x));
      const oy = Math.max(0, Math.min(r.y + r.height, u.y + u.height) - Math.max(r.y, u.y));
      const inter = ox * oy;
      const union = r.width * r.height + u.width * u.height - inter;
      if (inter / union > 0.5) { dup = true; break; }
    }
    if (!dup) unique.push(r);
  }
  return unique;
}

/**
 * Detect row dividers via brightness profile, then white-out squares for OCR.
 */
function processPanel(buffer: Buffer, width: number, height: number): { rows: { y: number; height: number }[]; cleaned: Buffer } {
  const mat = cv.matFromImageData({ data: new Uint8ClampedArray(buffer), width, height });
  const gray = new cv.Mat();
  cv.cvtColor(mat, gray, cv.COLOR_BGRA2GRAY);

  // --- Row detection via brightness profile ---
  const brightnessThresh = 137;
  const minDivHeight = 2;
  const minRowHeight = 50;

  const profile: number[] = [];
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      sum += gray.ucharAt(y, x);
    }
    profile.push(sum / width);
  }

  // Find divider regions (brightness dips below threshold)
  const dividers: { y: number; height: number }[] = [];
  let inDiv = false, divStart = 0;
  for (let y = 0; y < height; y++) {
    if (!inDiv && profile[y] < brightnessThresh) {
      inDiv = true;
      divStart = y;
    } else if (inDiv && profile[y] >= brightnessThresh) {
      inDiv = false;
      if (y - divStart >= minDivHeight) dividers.push({ y: divStart, height: y - divStart });
    }
  }
  if (inDiv && height - divStart >= minDivHeight) dividers.push({ y: divStart, height: height - divStart });

  // Derive rows: first row = y=0 to first divider, then between dividers
  const rows: { y: number; height: number }[] = [];
  if (dividers.length > 0) {
    if (dividers[0].y >= minRowHeight) rows.push({ y: 0, height: dividers[0].y });
    for (let i = 0; i < dividers.length - 1; i++) {
      const rowY = dividers[i].y + dividers[i].height;
      const rowH = dividers[i + 1].y - rowY;
      if (rowH >= minRowHeight) rows.push({ y: rowY, height: rowH });
    }
  }

  // --- White-out squares for OCR (with padding to kill border remnants) ---
  const squares = detectSquareRects(gray);
  const pad = 7;
  for (const rect of squares) {
    const x1 = Math.max(0, rect.x - pad);
    const y1 = Math.max(0, rect.y - pad);
    const x2 = Math.min(width, rect.x + rect.width + pad);
    const y2 = Math.min(height, rect.y + rect.height + pad);
    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        const idx = (y * width + x) * 4;
        buffer[idx] = 255; buffer[idx + 1] = 255; buffer[idx + 2] = 255; buffer[idx + 3] = 255;
      }
    }
  }

  gray.delete(); mat.delete();
  return { rows, cleaned: buffer };
}

export async function readRewardPanel(): Promise<RowResult[]> {
  const capture = captureScreen(PANEL);

  // Process with opencv
  const { rows, cleaned } = processPanel(Buffer.from(capture.buffer), capture.width, capture.height);
  console.log(`[ocr] Detected ${rows.length} rows`);

  if (rows.length === 0) return [];

  const w = await getWorker();
  const results: RowResult[] = [];

  for (const row of rows) {
    const rowBuf = Buffer.alloc(capture.width * row.height * 4);
    for (let y = 0; y < row.height; y++) {
      const srcOffset = (row.y + y) * capture.width * 4;
      const dstOffset = y * capture.width * 4;
      cleaned.copy(rowBuf, dstOffset, srcOffset, srcOffset + capture.width * 4);
    }

    const png = await sharp(rowBuf, {
      raw: { width: capture.width, height: row.height, channels: 4 },
    })
      .greyscale()
      .threshold(54)
      .png()
      .toBuffer();

    const { data } = await w.recognize(png);
    const text = data.text.trim().replace(/\n/g, " ");
    console.log(`[ocr] Row y=${row.y} h=${row.height}: "${text}"`);
    if (text.length > 2) {
      results.push({ y: row.y, height: row.height, text });
    }
  }

  return results;
}

export function getPanelBounds() {
  return PANEL;
}
