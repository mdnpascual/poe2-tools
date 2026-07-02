import { captureScreen } from "../capture/screen";
import { mouseMove, sleep } from "./input";
import { clearSearchBar, clickSearchBar, searchFor, getSlotDiff, GridInfo } from "./stash-scan";
import { detectGridAuto } from "../detection/stash-detect";
import { computeGridLayout } from "./stash-grid";
import { MonitorBounds } from "../windowing/monitor";
import koffi from "koffi";

const user32 = koffi.load("user32.dll");
const mouse_event = user32.func("void mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, uint32 dwData, uintptr dwExtraInfo)");
const POINT_SHIFT = koffi.struct("POINT_SHIFT", { x: "int32", y: "int32" });
const GetCursorPosFn = user32.func("bool GetCursorPos(_Out_ POINT_SHIFT *lpPoint)");

function leftClick() {
  mouse_event(0x0002, 0, 0, 0, 0);
  mouse_event(0x0004, 0, 0, 0, 0);
}

function mapScreenPosToSlot(
  pos: { x: number; y: number },
  layout: GridInfo
): { col: number; row: number } | null {
  const col = Math.floor((pos.x - layout.startX) / layout.cellWidth);
  const row = Math.floor((pos.y - layout.startY) / layout.cellHeight);
  if (col < 0 || col >= layout.columns || row < 0 || row >= layout.rows) return null;
  return { col, row };
}

function slotToIndex(col: number, row: number, rows: number): number {
  return col * rows + row;
}

function indexToSlot(index: number, rows: number): { col: number; row: number } {
  return { col: Math.floor(index / rows), row: index % rows };
}

function getSlotScreenPos(layout: GridInfo, col: number, row: number): { x: number; y: number } {
  return {
    x: Math.round(layout.startX + col * layout.cellWidth + layout.cellWidth / 2),
    y: Math.round(layout.startY + row * layout.cellHeight + layout.cellHeight / 2),
  };
}

export async function shiftInsert(
  monitor: MonitorBounds,
  delay: number,
  onCancel: () => boolean,
  onProgress?: (current: number, total: number) => void
): Promise<string> {
  // Step 1: Get current cursor position (physical pixels)
  const cursorPt = { x: 0, y: 0 };
  GetCursorPosFn(cursorPt);
  const cursorPos = { x: cursorPt.x, y: cursorPt.y };
  console.log(`Shift-insert: cursor at (${cursorPos.x}, ${cursorPos.y})`);

  // Step 2: Detect stash tab
  const capture = captureScreen({
    x: monitor.x,
    y: monitor.y,
    width: Math.floor(monitor.width / 2),
    height: monitor.height,
  });

  const detection = detectGridAuto(capture);
  if (detection.tabType === "unknown") {
    return "Failed to detect stash tab type";
  }

  const layout = computeGridLayout(detection, monitor.height);
  if (!layout) {
    return "Failed to compute grid layout";
  }

  console.log(`Shift-insert: detected ${detection.tabType} (${layout.columns}x${layout.rows})`);

  // Step 3: Map cursor to grid slot
  const insertSlot = mapScreenPosToSlot(cursorPos, layout);
  if (!insertSlot) {
    return "Cursor is not over a valid grid slot";
  }

  console.log(`Shift-insert: insertion at col=${insertSlot.col}, row=${insertSlot.row}`);

  // Step 4: Scan for the first empty slot after the insertion point
  const captureRegion = {
    x: monitor.x + layout.startX,
    y: monitor.y + layout.startY,
    width: Math.round(layout.columns * layout.cellWidth) + 10,
    height: Math.round(layout.rows * layout.cellHeight) + 10,
  };

  // Clear search bar and capture baseline
  await clearSearchBar(monitor.width, monitor.height);
  mouseMove(monitor.width - 100, monitor.height - 100);
  await sleep(300);
  const baseline = captureScreen(captureRegion);

  // Search nonsense to get all-dimmed
  await clickSearchBar(monitor.width, monitor.height);
  await sleep(100);
  await searchFor('"zzzznoitemhasthis"', monitor.width, monitor.height);
  const allDimmed = captureScreen(captureRegion);

  // Clear search bar to restore normal view
  await clearSearchBar(monitor.width, monitor.height);

  if (onCancel()) return "Cancelled";

  // Step 5: Find first empty slot after insertion point
  const { columns, rows } = layout;
  const totalSlots = columns * rows;
  const insertIndex = slotToIndex(insertSlot.col, insertSlot.row, rows);
  const DIFF_THRESHOLD = 100;

  let emptyIndex = -1;
  for (let i = insertIndex + 1; i < totalSlots; i++) {
    const { col, row } = indexToSlot(i, rows);
    const diff = getSlotDiff(baseline, allDimmed, layout, col, row);
    if (diff <= DIFF_THRESHOLD) {
      emptyIndex = i;
      break;
    }
  }

  if (emptyIndex === -1) {
    return "No empty slot found after insertion point";
  }

  const emptySlot = indexToSlot(emptyIndex, rows);
  console.log(`Shift-insert: empty slot at col=${emptySlot.col}, row=${emptySlot.row} (index ${emptyIndex})`);

  // Step 6: Check if insertion point itself is empty (just click it)
  const insertDiff = getSlotDiff(baseline, allDimmed, layout, insertSlot.col, insertSlot.row);
  if (insertDiff <= DIFF_THRESHOLD) {
    // Insertion slot is empty — just click it to deposit held item
    const pos = getSlotScreenPos(layout, insertSlot.col, insertSlot.row);
    mouseMove(pos.x, pos.y);
    await sleep(50);
    leftClick();
    await sleep(delay);
    return "Done (slot was empty)";
  }

  // Step 7: Execute swap chain from insertion point to empty slot
  // Each click: deposit held item into slot, pick up what was there
  // Chain length = emptyIndex - insertIndex + 1 (insertion slot through empty slot)
  const chainLength = emptyIndex - insertIndex + 1;
  let clicked = 0;

  for (let i = insertIndex; i <= emptyIndex; i++) {
    if (onCancel()) return "Cancelled";

    const { col, row } = indexToSlot(i, rows);
    const pos = getSlotScreenPos(layout, col, row);

    mouseMove(pos.x, pos.y);
    await sleep(50);
    leftClick();
    await sleep(delay);

    clicked++;
    onProgress?.(clicked, chainLength);
  }

  console.log(`Shift-insert: done, shifted ${chainLength - 1} items`);
  return "Done";
}
