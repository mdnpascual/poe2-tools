/**
 * Dump pixel brightness along a horizontal strip to understand the signal.
 */
const sharp = require("sharp");
const path = require("path");

async function dumpStrip(imagePath, label, stripY) {
  const img = sharp(imagePath);
  const meta = await img.metadata();
  const channels = meta.channels || 3;

  const strip = await img
    .extract({ left: 0, top: stripY, width: meta.width, height: 1 })
    .raw()
    .toBuffer();

  console.log(`\n=== ${label} at Y=${stripY} ===`);

  // Find local maxima (border positions) by looking at brightness profile
  const brightnesses = [];
  for (let x = 0; x < meta.width; x++) {
    const offset = x * channels;
    const r = strip[offset];
    const g = strip[offset + 1];
    const b = strip[offset + 2];
    brightnesses.push((r + g + b) / 3);
  }

  // Print brightness histogram
  const max = Math.max(...brightnesses);
  const min = Math.min(...brightnesses);
  console.log(`Brightness range: ${min.toFixed(1)} - ${max.toFixed(1)}`);

  // Show brightness distribution
  const buckets = new Array(20).fill(0);
  for (const b of brightnesses) {
    const bucket = Math.min(19, Math.floor((b / (max + 1)) * 20));
    buckets[bucket]++;
  }
  console.log("Distribution (0=darkest, 19=brightest):");
  buckets.forEach((count, i) => {
    if (count > 0) {
      const range = `${(i * (max + 1) / 20).toFixed(0)}-${((i + 1) * (max + 1) / 20).toFixed(0)}`;
      console.log(`  [${range}]: ${count}px ${"█".repeat(Math.min(50, Math.ceil(count / 10)))}`);
    }
  });

  // Find peaks — positions where brightness is a local max and above a relative threshold
  // Use the top 5% brightness as the "border" signal
  const sorted = [...brightnesses].sort((a, b) => b - a);
  const top5pct = sorted[Math.floor(sorted.length * 0.02)]; // top 2% threshold
  console.log(`\nTop 2% brightness threshold: ${top5pct.toFixed(1)}`);

  // Find clusters of bright pixels (borders)
  const borders = [];
  let inBorder = false;
  let borderStart = 0;
  for (let x = 0; x < brightnesses.length; x++) {
    if (brightnesses[x] >= top5pct && !inBorder) {
      inBorder = true;
      borderStart = x;
    } else if (brightnesses[x] < top5pct && inBorder) {
      inBorder = false;
      borders.push(Math.floor((borderStart + x) / 2));
    }
  }

  console.log(`Borders (top 2% method): ${borders.length}`);
  console.log(`→ Columns: ${borders.length + 1}`);
  if (borders.length > 1) {
    const spacings = [];
    for (let i = 1; i < borders.length; i++) spacings.push(borders[i] - borders[i-1]);
    console.log(`Average spacing: ${(spacings.reduce((a,b)=>a+b,0)/spacings.length).toFixed(1)}px`);
    console.log(`Spacings: ${spacings.join(", ")}`);
  }
}

async function main() {
  const dir = path.join(__dirname, "../src/templates");
  
  // Try several Y positions on normal tab
  await dumpStrip(path.join(dir, "normal_tab_calibration.png"), "Normal", 100);
  await dumpStrip(path.join(dir, "normal_tab_calibration.png"), "Normal", 300);
  
  // Try on quad tab
  await dumpStrip(path.join(dir, "quad_tab_calibration.png"), "Quad", 100);
  await dumpStrip(path.join(dir, "quad_tab_calibration.png"), "Quad", 300);
}

main().catch(console.error);
