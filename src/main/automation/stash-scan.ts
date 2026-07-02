import { captureScreen, CaptureResult } from "../capture/screen";
import { mouseMove, sleep } from "./input";
import koffi from "koffi";

const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");
const SendInputFn = user32.func("uint32 SendInput(uint32 nInputs, _In_ uint8 *pInputs, int32 cbSize)");
const OpenClipboard = user32.func("bool OpenClipboard(intptr hWnd)");
const CloseClipboard = user32.func("bool CloseClipboard()");
const EmptyClipboard = user32.func("bool EmptyClipboard()");
const SetClipboardData = user32.func("intptr SetClipboardData(uint32 uFormat, intptr hMem)");
const GlobalAlloc = kernel32.func("intptr GlobalAlloc(uint32 uFlags, uintptr dwBytes)");
const GlobalLock = kernel32.func("intptr GlobalLock(intptr hMem)");
const GlobalUnlock = kernel32.func("bool GlobalUnlock(intptr hMem)");

const CF_UNICODETEXT = 13;
const GMEM_MOVEABLE = 0x0002;

const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const INPUT_SIZE = 40;

export type SlotState =
  | "empty"
  | "corrupted"
  | "normal"
  | "magic_1"
  | "magic_2"
  | "rare_3"
  | "rare_4"
  | "rare_5"
  | "rare_6";

export interface ScanResult {
  grid: SlotState[][];
  columns: number;
  rows: number;
}

export interface GridInfo {
  startX: number;
  startY: number;
  cellWidth: number;
  cellHeight: number;
  columns: number;
  rows: number;
}

const SEARCH_BAR_X_RATIO = 0.2703;
const SEARCH_BAR_Y_RATIO = 0.8287;

function keyDown(vk: number) {
  const buf = Buffer.alloc(INPUT_SIZE);
  buf.writeUInt32LE(INPUT_KEYBOARD, 0);
  buf.writeUInt16LE(vk, 8);
  buf.writeUInt32LE(0, 12);
  SendInputFn(1, buf, INPUT_SIZE);
}

function keyUp(vk: number) {
  const buf = Buffer.alloc(INPUT_SIZE);
  buf.writeUInt32LE(INPUT_KEYBOARD, 0);
  buf.writeUInt16LE(vk, 8);
  buf.writeUInt32LE(KEYEVENTF_KEYUP, 12);
  SendInputFn(1, buf, INPUT_SIZE);
}

function mouseClick() {
  const u32 = koffi.load("user32.dll");
  const mouse_event = u32.func("void mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, uint32 dwData, uintptr dwExtraInfo)");
  mouse_event(0x0002, 0, 0, 0, 0);
  mouse_event(0x0004, 0, 0, 0, 0);
}

async function typeText(text: string) {
  for (const char of text) {
    const code = char.charCodeAt(0);
    const buf = Buffer.alloc(INPUT_SIZE);
    buf.writeUInt32LE(INPUT_KEYBOARD, 0);
    buf.writeUInt16LE(0, 8);
    buf.writeUInt16LE(code, 10);
    buf.writeUInt32LE(0x0004, 12); // KEYEVENTF_UNICODE
    SendInputFn(1, buf, INPUT_SIZE);

    const bufUp = Buffer.alloc(INPUT_SIZE);
    bufUp.writeUInt32LE(INPUT_KEYBOARD, 0);
    bufUp.writeUInt16LE(0, 8);
    bufUp.writeUInt16LE(code, 10);
    bufUp.writeUInt32LE(0x0004 | KEYEVENTF_KEYUP, 12);
    SendInputFn(1, bufUp, INPUT_SIZE);
    await sleep(10);
  }
}

export async function clickSearchBar(screenWidth: number, screenHeight: number) {
  const x = Math.round(screenWidth * SEARCH_BAR_X_RATIO);
  const y = Math.round(screenHeight * SEARCH_BAR_Y_RATIO);
  mouseMove(x, y);
  await sleep(50);
  mouseClick();
  await sleep(100);
}

export async function clearSearchBar(screenWidth: number, screenHeight: number) {
  await clickSearchBar(screenWidth, screenHeight);
  keyDown(0xA2); keyDown(0x41); keyUp(0x41); keyUp(0xA2); // Ctrl+A
  await sleep(30);
  keyDown(0x2E); keyUp(0x2E); // Delete
  await sleep(200);
}

export async function searchFor(text: string, screenWidth: number, screenHeight: number) {
  // Put text in clipboard
  setClipboardText(text);
  await sleep(50);
  // Select all + paste (assumes search bar is already focused)
  keyDown(0xA2); keyDown(0x41); keyUp(0x41); keyUp(0xA2); // Ctrl+A
  await sleep(30);
  keyDown(0xA2); keyDown(0x56); keyUp(0x56); keyUp(0xA2); // Ctrl+V
  await sleep(500); // wait for game to update
}

function setClipboardText(text: string) {
  const wstr = Buffer.from(text + "\0", "utf16le");
  const hMem = GlobalAlloc(GMEM_MOVEABLE, wstr.length);
  if (!hMem) return;
  const ptr = GlobalLock(hMem);
  if (!ptr) return;
  // Copy buffer to global memory
  const memcpy = kernel32.func("intptr RtlMoveMemory(intptr dest, _In_ uint8 *src, uintptr size)");
  memcpy(ptr, wstr, wstr.length);
  GlobalUnlock(hMem);
  OpenClipboard(0);
  EmptyClipboard();
  SetClipboardData(CF_UNICODETEXT, hMem);
  CloseClipboard();
}

export function getSlotDiff(
  captureA: CaptureResult,
  captureB: CaptureResult,
  gridInfo: GridInfo,
  col: number,
  row: number
): number {
  // Compare two captures at 9 sample points (3x3 grid within the cell)
  // Returns total absolute channel difference across all points
  const cx = Math.round(col * gridInfo.cellWidth + gridInfo.cellWidth / 2);
  const cy = Math.round(row * gridInfo.cellHeight + gridInfo.cellHeight / 2);
  const step = Math.round(gridInfo.cellWidth * 0.2); // 20% of cell size spacing

  let totalDiff = 0;
  for (let gy = -1; gy <= 1; gy++) {
    for (let gx = -1; gx <= 1; gx++) {
      const px = cx + gx * step;
      const py = cy + gy * step;
      if (px < 0 || px >= captureA.width || py < 0 || py >= captureA.height) continue;

      const off = (py * captureA.width + px) * 4;
      const diffB = Math.abs(captureA.buffer[off] - captureB.buffer[off]);
      const diffG = Math.abs(captureA.buffer[off + 1] - captureB.buffer[off + 1]);
      const diffR = Math.abs(captureA.buffer[off + 2] - captureB.buffer[off + 2]);
      totalDiff += diffB + diffG + diffR;
    }
  }
  return totalDiff; // 9 points × 3 channels, max theoretical = 9 * 765 = 6885
}

export async function scanStash(
  gridInfo: GridInfo,
  screenWidth: number,
  screenHeight: number,
  captureRegion: { x: number; y: number; width: number; height: number }
): Promise<ScanResult> {
  const { columns, rows } = gridInfo;

  const grid: SlotState[][] = Array.from({ length: columns }, () =>
    Array(rows).fill("empty")
  );

  // Step 1: Clear search bar, move mouse away, capture baseline
  await clearSearchBar(screenWidth, screenHeight);
  mouseMove(screenWidth - 100, screenHeight - 100);
  await sleep(300);
  const baseline = captureScreen(captureRegion);

  // Step 2: Click search bar ONCE to focus, then paste garbage filter
  await clickSearchBar(screenWidth, screenHeight);
  await sleep(100);
  await searchFor('"zzzznoitemhasthis"', screenWidth, screenHeight);
  const allDimmed = captureScreen(captureRegion);

  // Step 3: For each filter, diff against all-dimmed
  // Items that match the filter "light up" — their pixels differ from all-dimmed
  const filters: { text: string; state: SlotState }[] = [
    { text: '"corrupted"', state: "corrupted" },
    { text: '"normal"', state: "normal" },
    { text: '"revives available: 5"', state: "magic_1" },
    { text: '"revives available: 4"', state: "magic_2" },
    { text: '"revives available: 3"', state: "rare_3" },
    { text: '"revives available: 2"', state: "rare_4" },
    { text: '"revives available: 1"', state: "rare_5" },
    { text: '"revives available: 0"', state: "rare_6" },
  ];

  // Threshold: total abs diff across 9 points × 3 channels
  // A lit item should diff by ~50-100 per channel per point = 9*150 = 1350+
  // Empty/unmatched = ~0
  const DIFF_THRESHOLD = 100;

  for (const { text, state } of filters) {
    await searchFor(text, screenWidth, screenHeight);
    const filtered = captureScreen(captureRegion);

    let matchCount = 0;
    for (let col = 0; col < columns; col++) {
      for (let row = 0; row < rows; row++) {
        if (state !== "corrupted" && grid[col][row] !== "empty") continue;
        if (state === "corrupted" && grid[col][row] === "corrupted") continue;

        const diff = getSlotDiff(filtered, allDimmed, gridInfo, col, row);

        if (diff > DIFF_THRESHOLD) {
          grid[col][row] = state;
          matchCount++;
        }
      }
    }
    // Debug: show first column diffs for first two filters
    if (state === "corrupted" || state === "normal") {
      console.log(`  ${state} diffs C00: ${Array.from({length: Math.min(6, rows)}, (_, r) => {
        const d = getSlotDiff(filtered, allDimmed, gridInfo, 0, r);
        return `R${r}=${d}`;
      }).join(", ")}`);
    }
    console.log(`Filter ${text}: ${matchCount} matches`);
  }

  // Clear search bar
  await clearSearchBar(screenWidth, screenHeight);

  return { grid, columns, rows };
}

export function printGridSummary(result: ScanResult) {
  const { grid, columns, rows } = result;
  const counts: Record<SlotState, number> = {
    empty: 0, corrupted: 0, normal: 0,
    magic_1: 0, magic_2: 0,
    rare_3: 0, rare_4: 0, rare_5: 0, rare_6: 0,
  };

  console.log("\n=== Stash Grid Map ===");
  let header = "     ";
  for (let col = 0; col < columns; col++) header += `C${col.toString().padStart(2, "0")} `;
  console.log(header);

  for (let row = 0; row < rows; row++) {
    let line = `R${row.toString().padStart(2, "0")}  `;
    for (let col = 0; col < columns; col++) {
      const state = grid[col][row];
      counts[state]++;
      const symbol =
        state === "empty" ? " . " :
        state === "corrupted" ? " X " :
        state === "normal" ? " 0 " :
        state === "magic_1" ? " 1 " :
        state === "magic_2" ? " 2 " :
        state === "rare_3" ? " 3 " :
        state === "rare_4" ? " 4 " :
        state === "rare_5" ? " 5 " :
        state === "rare_6" ? " 6 " : " ? ";
      line += symbol;
    }
    console.log(line);
  }

  console.log("\n=== Summary ===");
  console.log(`Empty: ${counts.empty}`);
  console.log(`Corrupted (skip): ${counts.corrupted}`);
  console.log(`Normal (0 affix): ${counts.normal}`);
  console.log(`Magic 1 affix: ${counts.magic_1}`);
  console.log(`Magic 2 affix: ${counts.magic_2}`);
  console.log(`Rare 3 affix: ${counts.rare_3}`);
  console.log(`Rare 4 affix: ${counts.rare_4}`);
  console.log(`Rare 5 affix: ${counts.rare_5}`);
  console.log(`Rare 6 affix: ${counts.rare_6}`);
}
