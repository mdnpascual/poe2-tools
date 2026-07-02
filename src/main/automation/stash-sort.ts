import { captureScreen } from "../capture/screen";
import { mouseMove, sleep } from "./input";
import { clearSearchBar, clickSearchBar, searchFor, getSlotDiff, GridInfo } from "./stash-scan";
import koffi from "koffi";

const user32 = koffi.load("user32.dll");
const mouse_event = user32.func("void mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, uint32 dwData, uintptr dwExtraInfo)");
const SendInputFn = user32.func("uint32 SendInput(uint32 nInputs, _In_ uint8 *pInputs, int32 cbSize)");

const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const INPUT_SIZE = 40;
const VK_LCONTROL = 0xA2;

function leftClick() {
  mouse_event(0x0002, 0, 0, 0, 0);
  mouse_event(0x0004, 0, 0, 0, 0);
}

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

export type SortMode = "pack_size" | "rarity" | "monster_rarity" | "drop_chance";

function getFilters(mode: SortMode): string[] {
  switch (mode) {
    case "pack_size": {
      const filters: string[] = ['"k siz.*4[5-9]%"'];
      for (let i = 44; i >= 20; i--) {
        const tens = Math.floor(i / 10);
        const ones = i % 10;
        filters.push(`"k siz.*${tens}[${ones}]%"`);
      }
      return filters;
    }
    case "rarity": {
      const filters: string[] = ['"m rar.*6[4-9]%"'];
      for (let i = 63; i >= 30; i--) {
        const tens = Math.floor(i / 10);
        const ones = i % 10;
        filters.push(`"m rar.*${tens}[${ones}]%"`);
      }
      return filters;
    }
    case "monster_rarity": {
      const filters: string[] = ['"r rari.*6[5-9]%"'];
      for (let i = 64; i >= 35; i--) {
        const tens = Math.floor(i / 10);
        const ones = i % 10;
        filters.push(`"r rari.*${tens}[${ones}]%"`);
      }
      return filters;
    }
    case "drop_chance": {
      return [
        '"p cha.*15[0-9]%"',
        '"p cha.*14[5-9]%"',
        '"p cha.*14[0-4]%"',
        '"p cha.*13[5-9]%"',
        '"p cha.*13[0-4]%"',
        '"p cha.*12[5-9]%"',
        '"p cha.*12[0-4]%"',
        '"p cha.*11[5-9]%"',
        '"p cha.*11[0-4]%"',
      ];
    }
  }
}

export interface SortCallbacks {
  onCancel: () => boolean;
  onProgress?: (current: number, total: number, message?: string) => void;
  onPause?: () => Promise<void>; // called when batch is full, waits for user resume
}

export async function sortStash(
  gridInfo: GridInfo,
  screenWidth: number,
  screenHeight: number,
  captureRegion: { x: number; y: number; width: number; height: number },
  mode: SortMode,
  delay: number,
  batchSize: number,
  callbacks: SortCallbacks
): Promise<string> {
  const { columns, rows } = gridInfo;
  const filters = getFilters(mode);
  const DIFF_THRESHOLD = 100;
  const { onCancel, onProgress, onPause } = callbacks;

  // Phase 1: Scan — identify which slots match each bucket
  // We'll store ordered list of slots to withdraw (highest rank first)
  const sortedSlots: { col: number; row: number; bucket: number }[] = [];
  const assigned: boolean[][] = Array.from({ length: columns }, () => Array(rows).fill(false));

  // Get all-dimmed baseline
  await clearSearchBar(screenWidth, screenHeight);
  mouseMove(screenWidth - 100, screenHeight - 100);
  await sleep(300);

  await clickSearchBar(screenWidth, screenHeight);
  await sleep(100);
  await searchFor('"zzzznoitemhasthis"', screenWidth, screenHeight);
  const allDimmed = captureScreen(captureRegion);

  // Detect occupied slots
  await clearSearchBar(screenWidth, screenHeight);
  mouseMove(screenWidth - 100, screenHeight - 100);
  await sleep(300);
  const baseline = captureScreen(captureRegion);

  const occupied: boolean[][] = Array.from({ length: columns }, () => Array(rows).fill(false));
  let totalOccupied = 0;
  for (let col = 0; col < columns; col++) {
    for (let row = 0; row < rows; row++) {
      const diff = getSlotDiff(baseline, allDimmed, gridInfo, col, row);
      if (diff > DIFF_THRESHOLD) {
        occupied[col][row] = true;
        totalOccupied++;
      }
    }
  }

  console.log(`Sort: ${totalOccupied} waystones detected`);
  if (totalOccupied === 0) return "No waystones found";

  // Focus search bar for filter loop
  await clickSearchBar(screenWidth, screenHeight);
  await sleep(100);

  // Scan each filter bucket (high to low)
  for (let bucket = 0; bucket < filters.length; bucket++) {
    if (onCancel()) return "Cancelled";
    await searchFor(filters[bucket], screenWidth, screenHeight);
    const filtered = captureScreen(captureRegion);

    for (let col = 0; col < columns; col++) {
      for (let row = 0; row < rows; row++) {
        if (!occupied[col][row] || assigned[col][row]) continue;
        const diff = getSlotDiff(filtered, allDimmed, gridInfo, col, row);
        if (diff > DIFF_THRESHOLD) {
          sortedSlots.push({ col, row, bucket });
          assigned[col][row] = true;
        }
      }
    }
  }

  // Unassigned occupied slots go at the end
  for (let col = 0; col < columns; col++) {
    for (let row = 0; row < rows; row++) {
      if (occupied[col][row] && !assigned[col][row]) {
        sortedSlots.push({ col, row, bucket: filters.length });
      }
    }
  }

  console.log(`Scan complete: ${sortedSlots.length} waystones ranked`);

  // Clear search bar
  await clearSearchBar(screenWidth, screenHeight);
  await sleep(200);

  // Phase 2: Withdraw in sorted order (Ctrl+click)
  let withdrawn = 0;
  let batchCount = 0;

  for (let i = 0; i < sortedSlots.length; i++) {
    if (onCancel()) return "Cancelled";

    // Check if batch is full — pause for user to deposit
    if (batchCount >= batchSize) {
      onProgress?.(withdrawn, sortedSlots.length, `Paused — deposit ${batchSize} maps, then resume`);
      if (onPause) await onPause();
      if (onCancel()) return "Cancelled";
      batchCount = 0;
    }

    const slot = sortedSlots[i];
    const pos = getSlotScreenPos(gridInfo, slot.col, slot.row);

    onProgress?.(withdrawn, sortedSlots.length, `[${withdrawn}] Withdrawing bucket=${slot.bucket} from (${slot.col},${slot.row})`);

    // Ctrl+click to withdraw
    mouseMove(pos.x, pos.y);
    await sleep(50);
    keyDown(VK_LCONTROL);
    await sleep(30);
    leftClick();
    await sleep(30);
    keyUp(VK_LCONTROL);
    await sleep(delay);

    withdrawn++;
    batchCount++;
  }

  onProgress?.(withdrawn, sortedSlots.length, "Sort complete — deposit remaining maps");
  console.log(`Sort complete: ${withdrawn} waystones withdrawn`);
  return "Done";
}

function getSlotScreenPos(gridInfo: GridInfo, col: number, row: number): { x: number; y: number } {
  return {
    x: Math.round(gridInfo.startX + col * gridInfo.cellWidth + gridInfo.cellWidth / 2),
    y: Math.round(gridInfo.startY + row * gridInfo.cellHeight + gridInfo.cellHeight / 2),
  };
}
