import { mouseMove, sleep } from "./input";
import { GridDetectionResult, StashTabType } from "../detection/stash-detect";

interface GridLayout {
  startX: number;
  startY: number;
  cellWidth: number;
  cellHeight: number;
  columns: number;
  rows: number;
}

const ROW_COUNTS: Record<StashTabType, number> = {
  normal: 12,
  quad: 24,
  map: 8,
  unknown: 0,
};

// Grid Y start ratio (relative to screen height)
// Derived from: at 4K (2160px height), grid starts at Y=254 for normal/quad
const GRID_Y_RATIO: Record<StashTabType, number> = {
  normal: 0.1176,   // 254 / 2160
  quad: 0.1176,
  map: 0.3074,      // 664 / 2160
  unknown: 0,
};

export function computeGridLayout(
  detection: GridDetectionResult,
  screenHeight: number
): GridLayout | null {
  if (detection.tabType === "unknown" || !detection.gridBounds) return null;

  const rows = ROW_COUNTS[detection.tabType];
  const startY = Math.round(screenHeight * GRID_Y_RATIO[detection.tabType]);

  // The detected grid bounds: start = first border line, end = last border line
  // Number of border lines in the run = columns - 1 (internal borders)
  // So actual grid width = end - start, and there are (columns - 2) internal gaps
  // Cell width = gridWidth / (columns - 2)... 
  // Actually: detection.columns = lineCount + 1 from findLongestConsistentRun
  // lineCount = number of lines in the run. Between first and last line = lineCount - 1 gaps
  // So cell width = (end - start) / (lineCount - 1) = gridBounds.width / (columns - 2)
  
  const gridWidth = detection.gridBounds.width; // from first line to last line
  const numGaps = detection.columns - 2; // gaps between first and last detected border
  const cellWidth = gridWidth / numGaps;
  
  // startX = first border line - one cell width (the first cell is BEFORE the first internal border)
  // Wait: the first detected line IS the left edge border of the grid, not an internal border.
  // Actually from the data: normal x=36..1294, that's 1258px / 12 gaps = 104.8 ≈ 105px per cell
  // And 36 is the left border. First cell center = 36 + cellWidth/2
  // But for map: x=181..1250, that's 1069px / 11 gaps = 97.2px. 
  // 181 is the left border. First cell center = 181 + 97/2 = 229.5
  // Hmm but the user says map starts on 2nd column...
  // 
  // The issue: for map, the grid starts BEFORE x=181. The first detected line at 181 
  // might be the SECOND vertical border (right edge of first cell).
  // Let's just use: startX = gridBounds.x - cellWidth (assume first line is right edge of cell 0)
  // For normal: 36 - 105 = -69... that's wrong. 36 IS the left edge for normal.
  //
  // Different approach: use the actual columns count from detection.
  // Normal: 14 cols detected = 13 internal lines. grid x=36..1294. cells = 13 gaps in 1258px = 96.8?
  // No wait: detection.columns = lineCount + 1 = 13 + 1 = 14
  // lineCount = 13 lines found. gridBounds.width = 1294 - 36 = 1258. 
  // 13 lines means 12 gaps between them. cellWidth = 1258 / 12 = 104.8 ≈ 105 ✓
  // First line at x=36 is the leftmost border. First cell center = 36 + 105/2 = 88.5
  // 
  // For map: 12 lines, gridBounds = 181..1250, width = 1069
  // 12 lines = 11 gaps. cellWidth = 1069/11 = 97.2
  // First line at 181. If 181 is leftmost border, first cell center = 181 + 97/2 = 229
  // But user says it starts on 2nd column. So 181 is NOT the left edge of the map grid.
  // The left edge is at 181 - 97 = 84. First cell center = 84 + 97/2 = 132.
  // That means we need: startX = firstLine - cellWidth for map.
  //
  // For normal at 4K: from PoE2StashMacro, start is (35, 241). First cell center = 35 + 105/2 = 87.5
  // Our detection gives firstLine = 36. So 36 IS the left border, first center = 36 + 52.5 = 88.5 ✓
  // 
  // For map at 4K: from PoE2StashMacro, start is (84, 664). First cell center = 84 + 97/2 = 132.5
  // Our detection gives firstLine = 181. So 181 - 97 = 84. ✓ The first line IS the second border.
  //
  // Conclusion: for map, the leftmost detected line is the SECOND border (right side of first cell).
  // For normal/quad, the leftmost detected line IS the first border (left side of first cell).
  // 
  // Simple fix: for map, subtract one cellWidth from startX.

  const numCells = numGaps; // N borders = N-1 gaps = N-1 cells between them... 
  // Wait: detection.columns = lineCount + 1 from the detection code.
  // lineCount = 13 (normal), so detection.columns = 14.
  // numGaps = 14 - 2 = 12. That's 12 gaps between 13 lines. 12 cells. ✓ for normal.
  // For quad: lineCount=25, detection.columns=26, numGaps=24. 24 cells. ✓
  // For map: lineCount=12, detection.columns=13, numGaps=11. 11 cells between detected lines.
  //   Plus 1 cell before first line = 12 total. ✓
  
  const columns = detection.tabType === "map" ? numGaps + 1 : numGaps;
  const startX = detection.tabType === "map" 
    ? detection.gridBounds.x - Math.round(cellWidth)
    : detection.gridBounds.x;

  // Grid is slightly non-square (width=1264, height=1259 at 4K → ratio 0.996)
  // Use this ratio to correct cellHeight and prevent drift over many rows
  const GRID_HEIGHT_RATIO = 0.996;
  const cellHeight = cellWidth * GRID_HEIGHT_RATIO;

  return { startX, startY, cellWidth, cellHeight, columns, rows };
}

/**
 * Move mouse through all grid slots (column-first traversal).
 * No clicking — just movement + sleep for testing.
 */
export async function testGridMovement(
  detection: GridDetectionResult,
  screenHeight: number,
  onCancel: () => boolean
): Promise<string> {
  const layout = computeGridLayout(detection, screenHeight);
  if (!layout) return "Failed to compute grid layout";

  const { startX, startY, cellWidth, cellHeight, columns, rows } = layout;
  const totalSlots = columns * rows;
  let visited = 0;

  console.log(`Grid layout: ${columns}x${rows}, cell=${cellWidth}x${cellHeight}, start=(${startX},${startY})`);

  // Column-first traversal
  for (let col = 0; col < columns; col++) {
    for (let row = 0; row < rows; row++) {
      if (onCancel()) {
        return `Cancelled at slot ${visited}/${totalSlots}`;
      }

      const x = Math.round(startX + col * cellWidth + cellWidth / 2);
      const y = Math.round(startY + row * cellHeight + cellHeight / 2);

      mouseMove(x, y);
      visited++;
      await sleep(100);
    }
  }

  return `Done: visited ${visited}/${totalSlots} slots`;
}
