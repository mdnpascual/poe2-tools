import { CaptureResult } from "../capture/screen";

export type StashTabType = "normal" | "quad" | "map" | "unknown";

export interface GridDetectionResult {
  tabType: StashTabType;
  gridBounds: { x: number; y: number; width: number; height: number } | null;
  cellWidth: number;
  columns: number;
  rows: number;
  debug: string;
}

/**
 * Detect stash grid by finding vertical lines that are consistently brighter
 * than their neighbors across many rows (characteristic of grid borders).
 */
export function detectGridAuto(capture: CaptureResult): GridDetectionResult {
  const { buffer, width, height, channels } = capture;
  const debugLines: string[] = [];

  // Step 1: For each column, compute how many rows it's a "local brightness peak"
  // A grid border column will be brighter than its neighbors across most of the grid height
  const verticalLineScore = new Float64Array(width);

  // Sample every 4th row for speed
  const rowStep = 4;
  let sampledRows = 0;
  for (let y = 0; y < height; y += rowStep) {
    sampledRows++;
    for (let x = 2; x < width - 2; x++) {
      const offset = (y * width + x) * channels;
      const here = buffer[offset] + buffer[offset + 1] + buffer[offset + 2];
      
      // Compare to neighbors 2px away on each side
      const leftOff = (y * width + (x - 2)) * channels;
      const rightOff = (y * width + (x + 2)) * channels;
      const left = buffer[leftOff] + buffer[leftOff + 1] + buffer[leftOff + 2];
      const right = buffer[rightOff] + buffer[rightOff + 1] + buffer[rightOff + 2];

      // This column is a "local vertical line" at this row if it's brighter than both sides
      if (here > left + 15 && here > right + 15) {
        verticalLineScore[x] += 1;
      }
    }
  }

  // Normalize to percentage of rows where this column is a local peak
  for (let x = 0; x < width; x++) {
    verticalLineScore[x] = verticalLineScore[x] / sampledRows;
  }

  // Step 2: Find columns with high line scores (>30% of rows = consistent vertical line)
  const lineThreshold = 0.30;
  const verticalLines: number[] = [];
  for (let x = 2; x < width - 2; x++) {
    if (
      verticalLineScore[x] >= lineThreshold &&
      verticalLineScore[x] >= verticalLineScore[x - 1] &&
      verticalLineScore[x] >= verticalLineScore[x + 1]
    ) {
      // Merge with previous if within 5px
      if (verticalLines.length === 0 || x - verticalLines[verticalLines.length - 1] > 5) {
        verticalLines.push(x);
      } else if (verticalLineScore[x] > verticalLineScore[verticalLines[verticalLines.length - 1]]) {
        verticalLines[verticalLines.length - 1] = x;
      }
    }
  }

  debugLines.push(`Vertical lines found: ${verticalLines.length}`);
  if (verticalLines.length > 0) {
    debugLines.push(`First 5: ${verticalLines.slice(0, 5).join(", ")}`);
    debugLines.push(`Last 5: ${verticalLines.slice(-5).join(", ")}`);
  }

  // Step 3: Find dominant spacing between vertical lines
  const vSpacing = findDominantSpacing(verticalLines);
  debugLines.push(`Dominant spacing: ${vSpacing.spacing.toFixed(1)}px (${vSpacing.count} matches)`);

  // Step 4: Find longest run of consistently-spaced lines
  const gridRun = findLongestConsistentRun(verticalLines, vSpacing.spacing);
  debugLines.push(`Grid run: ${gridRun.lineCount} lines (${gridRun.lineCount + 1} cols), x=${gridRun.start}..${gridRun.end}`);

  // Step 5: Now find horizontal lines within the detected column range
  let rows = 0;
  let gridY = 0;
  let gridYEnd = 0;
  if (gridRun.lineCount >= 5) {
    const hLines = findHorizontalLines(buffer, width, height, channels, gridRun.start, gridRun.end);
    debugLines.push(`Horizontal lines found: ${hLines.length}`);

    const hSpacing = findDominantSpacing(hLines);
    debugLines.push(`Horizontal spacing: ${hSpacing.spacing.toFixed(1)}px (${hSpacing.count} matches)`);

    const hRun = findLongestConsistentRun(hLines, hSpacing.spacing);
    rows = hRun.lineCount + 1;
    gridY = hRun.start;
    gridYEnd = hRun.end;
    debugLines.push(`Horizontal run: ${hRun.lineCount} lines (${rows} rows), y=${gridY}..${gridYEnd}`);
  }

  // Step 6: Determine tab type from columns and cell spacing
  const cols = gridRun.lineCount + 1;
  let tabType: StashTabType = "unknown";
  
  if (cols >= 22 && cols <= 26) {
    tabType = "quad";  // ~52px spacing, 24 cols
  } else if (cols >= 11 && cols <= 14) {
    // Distinguish normal from map by cell spacing
    // Normal: ~105px cells, Map: ~97px cells (map cells are slightly narrower)
    // Also map grid starts further right (x > 100) while normal starts near x=35
    if (vSpacing.spacing > 0 && vSpacing.spacing < 100) {
      tabType = "map";
    } else {
      tabType = "normal";
    }
  }

  debugLines.push(`→ Result: ${tabType} (${cols} cols × ${rows} rows, cell=${vSpacing.spacing.toFixed(0)}px)`);

  return {
    tabType,
    gridBounds: gridRun.lineCount >= 5 ? {
      x: gridRun.start,
      y: gridY,
      width: gridRun.end - gridRun.start,
      height: gridYEnd - gridY,
    } : null,
    cellWidth: vSpacing.spacing,
    columns: cols,
    rows,
    debug: debugLines.join("\n"),
  };
}

function findHorizontalLines(
  buffer: Buffer, width: number, height: number, channels: number,
  xStart: number, xEnd: number
): number[] {
  const colStep = 4;
  const spanWidth = xEnd - xStart;
  const sampledCols = Math.floor(spanWidth / colStep);
  
  const horizontalLineScore = new Float64Array(height);
  for (let x = xStart; x < xEnd; x += colStep) {
    for (let y = 2; y < height - 2; y++) {
      const offset = (y * width + x) * channels;
      const here = buffer[offset] + buffer[offset + 1] + buffer[offset + 2];
      const above = buffer[((y - 2) * width + x) * channels] + buffer[((y - 2) * width + x) * channels + 1] + buffer[((y - 2) * width + x) * channels + 2];
      const below = buffer[((y + 2) * width + x) * channels] + buffer[((y + 2) * width + x) * channels + 1] + buffer[((y + 2) * width + x) * channels + 2];

      if (here > above + 15 && here > below + 15) {
        horizontalLineScore[y] += 1;
      }
    }
  }

  // Normalize
  for (let y = 0; y < height; y++) {
    horizontalLineScore[y] = horizontalLineScore[y] / sampledCols;
  }

  // Find peaks
  const threshold = 0.30;
  const lines: number[] = [];
  for (let y = 2; y < height - 2; y++) {
    if (
      horizontalLineScore[y] >= threshold &&
      horizontalLineScore[y] >= horizontalLineScore[y - 1] &&
      horizontalLineScore[y] >= horizontalLineScore[y + 1]
    ) {
      if (lines.length === 0 || y - lines[lines.length - 1] > 5) {
        lines.push(y);
      } else if (horizontalLineScore[y] > horizontalLineScore[lines[lines.length - 1]]) {
        lines[lines.length - 1] = y;
      }
    }
  }
  return lines;
}

function findDominantSpacing(positions: number[]): { spacing: number; count: number } {
  if (positions.length < 3) return { spacing: 0, count: 0 };

  const spacings: number[] = [];
  for (let i = 1; i < positions.length; i++) {
    spacings.push(positions[i] - positions[i - 1]);
  }

  // Histogram with 3px bins
  const bins = new Map<number, number[]>();
  for (const s of spacings) {
    const bin = Math.round(s / 3) * 3;
    if (!bins.has(bin)) bins.set(bin, []);
    bins.get(bin)!.push(s);
  }

  let bestBin: number[] = [];
  let bestKey = 0;
  for (const [key, values] of bins) {
    if (values.length > bestBin.length) {
      bestBin = values;
      bestKey = key;
    }
  }

  const avg = bestBin.length > 0 ? bestBin.reduce((a, b) => a + b, 0) / bestBin.length : 0;
  return { spacing: avg, count: bestBin.length };
}

function findLongestConsistentRun(
  positions: number[],
  expectedSpacing: number
): { lineCount: number; start: number; end: number } {
  if (positions.length < 2 || expectedSpacing <= 0)
    return { lineCount: 0, start: 0, end: 0 };

  const tolerance = expectedSpacing * 0.15;
  let bestStart = 0;
  let bestLen = 1;
  let curStart = 0;
  let curLen = 1;

  for (let i = 1; i < positions.length; i++) {
    const spacing = positions[i] - positions[i - 1];
    if (Math.abs(spacing - expectedSpacing) <= tolerance) {
      curLen++;
    } else {
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
      curStart = i;
      curLen = 1;
    }
  }
  if (curLen > bestLen) {
    bestLen = curLen;
    bestStart = curStart;
  }

  return {
    lineCount: bestLen,
    start: positions[bestStart],
    end: positions[bestStart + bestLen - 1],
  };
}
