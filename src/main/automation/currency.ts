import { mouseMove, sleep } from "./input";
import { SlotState, ScanResult } from "./stash-scan";
import koffi from "koffi";

const user32 = koffi.load("user32.dll");
const mouse_event = user32.func("void mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, uint32 dwData, uintptr dwExtraInfo)");
const SendInputFn = user32.func("uint32 SendInput(uint32 nInputs, _In_ uint8 *pInputs, int32 cbSize)");

const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;
const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const INPUT_SIZE = 40;
const VK_LSHIFT = 0xA0;

function leftClick() {
  mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
  mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
}

function rightClick() {
  mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
  mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
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

export type CurrencyChoice = "alchemy" | "transmutation" | "augmentation" | "regal" | "exalted" | "exalted_5" | "vaal" | "none";

export interface CurrencyConfig {
  normal: { currency: CurrencyChoice; position: { x: number; y: number } | null };
  magic1: { currency: CurrencyChoice; position: { x: number; y: number } | null };
  magic2: { currency: CurrencyChoice; position: { x: number; y: number } | null };
  rare: { currency: CurrencyChoice; position: { x: number; y: number } | null };
  corrupt: { currency: CurrencyChoice; position: { x: number; y: number } | null };
}

interface GridLayout {
  startX: number;
  startY: number;
  cellWidth: number;
  cellHeight: number;
  columns: number;
  rows: number;
}

function getSlotScreenPos(layout: GridLayout, col: number, row: number): { x: number; y: number } {
  return {
    x: Math.round(layout.startX + col * layout.cellWidth + layout.cellWidth / 2),
    y: Math.round(layout.startY + row * layout.cellHeight + layout.cellHeight / 2),
  };
}

// Map currency to which states it processes and what the new state becomes
function getNewState(current: SlotState, currency: CurrencyChoice): SlotState {
  switch (currency) {
    case "transmutation": return "magic_1";
    case "alchemy": return "rare_4";
    case "augmentation": return "magic_2";
    case "regal": return "rare_3";
    case "exalted":
      if (current === "rare_3") return "rare_4";
      if (current === "rare_4") return "rare_5";
      if (current === "rare_5") return "rare_6";
      return current;
    case "exalted_5":
      if (current === "rare_3") return "rare_4";
      if (current === "rare_4") return "rare_5";
      return current;
    case "vaal": return "corrupted";
    default: return current;
  }
}

async function applyToSlots(
  orbPos: { x: number; y: number },
  slots: { col: number; row: number }[],
  layout: GridLayout,
  delay: number,
  onCancel: () => boolean,
  onSlotDone?: () => void
): Promise<boolean> {
  if (slots.length === 0) return true;

  // Right-click the orb to pick it up
  mouseMove(orbPos.x, orbPos.y);
  await sleep(100);
  rightClick();
  await sleep(150);

  // Hold shift
  keyDown(VK_LSHIFT);
  await sleep(50);

  // Left-click each waystone
  for (const slot of slots) {
    if (onCancel()) {
      keyUp(VK_LSHIFT);
      return false;
    }
    const pos = getSlotScreenPos(layout, slot.col, slot.row);
    mouseMove(pos.x, pos.y);
    await sleep(50);
    leftClick();
    await sleep(delay);
    onSlotDone?.();
  }

  // Release shift
  keyUp(VK_LSHIFT);
  await sleep(100);

  return true;
}

export async function applyCurrency(
  scanResult: ScanResult,
  layout: GridLayout,
  config: CurrencyConfig,
  delay: number,
  onCancel: () => boolean,
  onProgress?: (current: number, total: number) => void
): Promise<string> {
  const { grid, columns, rows } = scanResult;

  // Work on a mutable copy of the state
  const state: SlotState[][] = grid.map((col) => [...col]);

  // Calculate exact total clicks based on current state and chosen currency paths
  // Each waystone ultimately reaches rare_6 then gets vaal'd (or rare_5 with no vaal for exalted_5)
  const isExalt5 = config.rare.currency === "exalted_5";
  const skipCorrupt = isExalt5 || config.corrupt.currency === "none";
  function clicksNeeded(s: SlotState): number {
    switch (s) {
      case "normal":
        // alchemy → rare_4 (1), exalt×2 (2), vaal (1) = 4
        // transmutation → magic_1 (1) + clicks for magic_1
        if (config.normal.currency === "alchemy") return isExalt5 ? 2 : (skipCorrupt ? 3 : 4);
        return 1 + clicksNeeded("magic_1");
      case "magic_1":
        // alchemy → rare_4 (1), exalt×2 (2), vaal (1) = 4
        // augmentation → magic_2 (1) + clicks for magic_2
        if (config.magic1.currency === "alchemy") return isExalt5 ? 2 : (skipCorrupt ? 3 : 4);
        return 1 + clicksNeeded("magic_2");
      case "magic_2":
        // alchemy → rare_4 (1), exalt×2 (2), vaal (1) = 4
        // regal → rare_3 (1), exalt×3 (3), vaal (1) = 5
        if (config.magic2.currency === "alchemy") return isExalt5 ? 2 : (skipCorrupt ? 3 : 4);
        return isExalt5 ? 3 : (skipCorrupt ? 4 : 5);
      case "rare_3": return isExalt5 ? 2 : (skipCorrupt ? 3 : 4); // exalt×2 (5mod) or exalt×3 + vaal
      case "rare_4": return isExalt5 ? 1 : (skipCorrupt ? 2 : 3); // exalt×1 (5mod) or exalt×2 + vaal
      case "rare_5": return isExalt5 ? 0 : (skipCorrupt ? 1 : 2); // done (5mod) or exalt×1 + vaal
      case "rare_6": return skipCorrupt ? 0 : 1; // done (skip) or vaal
      default: return 0;
    }
  }

  let totalClicks = 0;
  for (let col = 0; col < columns; col++) {
    for (let row = 0; row < rows; row++) {
      totalClicks += clicksNeeded(grid[col][row]);
    }
  }

  let clickCount = 0;
  const report = () => { onProgress?.(clickCount, totalClicks); };
  const tick = () => { clickCount++; report(); };

  const passes: { label: string; targetStates: SlotState[]; currency: CurrencyChoice; position: { x: number; y: number } | null }[] = [
    { label: "Normal", targetStates: ["normal"], currency: config.normal.currency, position: config.normal.position },
    { label: "Magic 1", targetStates: ["magic_1"], currency: config.magic1.currency, position: config.magic1.position },
    { label: "Magic 2", targetStates: ["magic_2"], currency: config.magic2.currency, position: config.magic2.position },
  ];

  for (const pass of passes) {
    if (onCancel()) return "Cancelled";
    if (!pass.position) {
      console.log(`Skipping ${pass.label}: no orb position set`);
      continue;
    }

    // Find slots matching target states
    const slots: { col: number; row: number }[] = [];
    for (let col = 0; col < columns; col++) {
      for (let row = 0; row < rows; row++) {
        if (pass.targetStates.includes(state[col][row])) {
          slots.push({ col, row });
        }
      }
    }

    if (slots.length === 0) {
      console.log(`${pass.label}: no slots to process`);
      continue;
    }

    console.log(`${pass.label}: applying ${pass.currency} to ${slots.length} slots`);
    const ok = await applyToSlots(pass.position, slots, layout, delay, onCancel, tick);
    if (!ok) return "Cancelled";

    // Update state
    for (const slot of slots) {
      state[slot.col][slot.row] = getNewState(state[slot.col][slot.row], pass.currency);
    }
  }

  // For exalted, hold shift across ALL passes (game auto-pulls from currency tab)
  if (config.rare.position) {
    const targetStates: SlotState[] = isExalt5 ? ["rare_3", "rare_4"] : ["rare_3", "rare_4", "rare_5"];
    const rareSlots: { col: number; row: number }[] = [];
    for (let col = 0; col < columns; col++) {
      for (let row = 0; row < rows; row++) {
        if (targetStates.includes(state[col][row])) {
          rareSlots.push({ col, row });
        }
      }
    }

    if (rareSlots.length > 0 && !onCancel()) {
      // Right-click orb once, hold shift for all passes
      mouseMove(config.rare.position.x, config.rare.position.y);
      await sleep(100);
      rightClick();
      await sleep(150);
      keyDown(VK_LSHIFT);
      await sleep(50);

      // Up to 4 passes: 3→4, 4→5, 5→6 (each slot needs up to 3 clicks total)
      // For exalted_5: 3→4, 4→5 only (each slot needs up to 2 clicks)
      for (let pass = 0; pass < 4; pass++) {
        if (onCancel()) { keyUp(VK_LSHIFT); return "Cancelled"; }
        const slots: { col: number; row: number }[] = [];
        for (let col = 0; col < columns; col++) {
          for (let row = 0; row < rows; row++) {
            if (targetStates.includes(state[col][row])) {
              slots.push({ col, row });
            }
          }
        }
        if (slots.length === 0) break;

        console.log(`Rare pass ${pass + 1}: applying ${config.rare.currency} to ${slots.length} slots`);
        for (const slot of slots) {
          if (onCancel()) { keyUp(VK_LSHIFT); return "Cancelled"; }
          const pos = getSlotScreenPos(layout, slot.col, slot.row);
          mouseMove(pos.x, pos.y);
          await sleep(50);
          leftClick();
          await sleep(delay);
          state[slot.col][slot.row] = getNewState(state[slot.col][slot.row], config.rare.currency);
          tick();
        }
      }

      keyUp(VK_LSHIFT);
      await sleep(100);
    }
  }

  // Corrupt pass LAST — vaal all rare_6 (fully rolled) waystones
  // Skip entirely when using exalted_5 (5 mod strategy) or when corrupt is set to "none"
  if (config.corrupt.position && !isExalt5 && config.corrupt.currency !== "none") {
    if (onCancel()) return "Cancelled";
    const slots: { col: number; row: number }[] = [];
    for (let col = 0; col < columns; col++) {
      for (let row = 0; row < rows; row++) {
        if (state[col][row] === "rare_6") {
          slots.push({ col, row });
        }
      }
    }
    if (slots.length > 0) {
      console.log(`Corrupt: applying vaal to ${slots.length} slots`);
      const ok = await applyToSlots(config.corrupt.position, slots, layout, delay, onCancel, tick);
      if (!ok) return "Cancelled";
      for (const slot of slots) {
        state[slot.col][slot.row] = "corrupted";
      }
    }
  }

  return "Done";
}
