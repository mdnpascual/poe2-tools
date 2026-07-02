/**
 * Analyze stash tab grid borders from calibration images.
 * Run with: node scripts/analyze-grid.js
 */
const sharp = require("sharp");
const path = require("path");

const TEMPLATES_DIR = path.join(__dirname, "../src/templates");

async function analyzeHorizontalStrip(imagePath, label) {
  const img = sharp(imagePath);
  const meta = await img.metadata();
  console.log(`\n=== ${label} (${meta.width}x${meta.height}) ===`);

  // Extract a 1px tall horizontal strip from the middle of the image
  const stripY = Math.floor(meta.height / 2);
  const strip = await img
    .extract({ left: 0, top: stripY, width: meta.width, height: 1 })
    .raw()
    .toBuffer();

  // Each pixel is 3 bytes (RGB)
  const channels = meta.channels || 3;
  const pixels = [];
  for (let x = 0; x < meta.width; x++) {
    const offset = x * channels;
    const r = strip[offset];
    const g = strip[offset + 1];
    const b = strip[offset + 2];
    const brightness = (r + g + b) / 3;
    pixels.push({ x, r, g, b, brightness });
  }

  // Detect borders: look for pixels that are brighter than their surroundings
  // (golden border lines are brighter than the dark cell backgrounds)
  // The borders appear as thin bright lines against dark background
  const threshold = 25; // brightness above this = potential border pixel
  const borders = [];
  let inBorder = false;
  let borderStart = 0;

  for (let x = 0; x < pixels.length; x++) {
    const isBright = pixels[x].brightness > threshold;
    if (isBright && !inBorder) {
      inBorder = true;
      borderStart = x;
    } else if (!isBright && inBorder) {
      inBorder = false;
      const borderCenter = Math.floor((borderStart + x) / 2);
      borders.push(borderCenter);
    }
  }

  console.log(`Borders found: ${borders.length}`);
  if (borders.length > 1) {
    // Calculate spacing between borders
    const spacings = [];
    for (let i = 1; i < borders.length; i++) {
      spacings.push(borders[i] - borders[i - 1]);
    }
    const avgSpacing = spacings.reduce((a, b) => a + b, 0) / spacings.length;
    const minSpacing = Math.min(...spacings);
    const maxSpacing = Math.max(...spacings);

    console.log(`Average spacing: ${avgSpacing.toFixed(1)}px`);
    console.log(`Min spacing: ${minSpacing}px, Max spacing: ${maxSpacing}px`);
    console.log(`Estimated columns: ${borders.length + 1}`);
    console.log(`First 5 borders at: ${borders.slice(0, 5).join(", ")}`);
    console.log(`Last 5 borders at: ${borders.slice(-5).join(", ")}`);

    // Determine tab type
    const estimatedCols = borders.length + 1;
    if (estimatedCols >= 20 && estimatedCols <= 26) {
      console.log(`→ DETECTED: QUAD TAB (${estimatedCols} columns)`);
    } else if (estimatedCols >= 10 && estimatedCols <= 14) {
      console.log(`→ DETECTED: NORMAL TAB (${estimatedCols} columns)`);
    } else {
      console.log(`→ UNKNOWN (${estimatedCols} columns)`);
    }
  }

  // Also try multiple strip positions to verify consistency
  console.log("\nVerifying at multiple Y positions...");
  for (const yPct of [0.25, 0.5, 0.75]) {
    const y = Math.floor(meta.height * yPct);
    const s = await sharp(imagePath)
      .extract({ left: 0, top: y, width: meta.width, height: 1 })
      .raw()
      .toBuffer();

    let count = 0;
    let inB = false;
    for (let x = 0; x < meta.width; x++) {
      const offset = x * channels;
      const brightness = (s[offset] + s[offset + 1] + s[offset + 2]) / 3;
      const isBright = brightness > threshold;
      if (isBright && !inB) { inB = true; }
      else if (!isBright && inB) { inB = false; count++; }
    }
    console.log(`  Y=${y} (${(yPct * 100).toFixed(0)}%): ${count} borders → ${count + 1} cols`);
  }
}

async function main() {
  await analyzeHorizontalStrip(
    path.join(TEMPLATES_DIR, "normal_tab_calibration.png"),
    "Normal Tab"
  );
  await analyzeHorizontalStrip(
    path.join(TEMPLATES_DIR, "quad_tab_calibration.png"),
    "Quad Tab"
  );
}

main().catch(console.error);
