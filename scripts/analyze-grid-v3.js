const sharp = require("sharp");
const path = require("path");

async function detectTabType(imagePath) {
  const img = sharp(imagePath);
  const meta = await img.metadata();
  const channels = meta.channels || 3;
  const results = [];

  // Sample multiple Y positions
  for (const yPct of [0.08, 0.15, 0.42, 0.58, 0.85, 0.92]) {
    const stripY = Math.floor(meta.height * yPct);
    const strip = await sharp(imagePath)
      .extract({ left: 0, top: stripY, width: meta.width, height: 1 })
      .raw()
      .toBuffer();

    const brightnesses = [];
    for (let x = 0; x < meta.width; x++) {
      const offset = x * channels;
      brightnesses.push((strip[offset] + strip[offset + 1] + strip[offset + 2]) / 3);
    }

    // Find top 2% brightness threshold
    const sorted = [...brightnesses].sort((a, b) => b - a);
    const threshold = sorted[Math.floor(sorted.length * 0.02)];

    // Find border clusters
    const rawBorders = [];
    let inBorder = false;
    let borderStart = 0;
    for (let x = 0; x < brightnesses.length; x++) {
      if (brightnesses[x] >= threshold && !inBorder) {
        inBorder = true;
        borderStart = x;
      } else if (brightnesses[x] < threshold && inBorder) {
        inBorder = false;
        rawBorders.push(Math.floor((borderStart + x) / 2));
      }
    }

    // Merge borders that are within 20px of each other (clover decoration noise)
    const merged = [];
    for (const b of rawBorders) {
      if (merged.length === 0 || b - merged[merged.length - 1] > 20) {
        merged.push(b);
      } else {
        // Update to average position
        merged[merged.length - 1] = Math.floor((merged[merged.length - 1] + b) / 2);
      }
    }

    const cols = merged.length + 1;
    results.push({ y: stripY, yPct, borders: merged.length, cols });
  }

  // Take majority vote on column count
  const colCounts = results.map(r => r.cols);
  console.log(`\n${path.basename(imagePath)}:`);
  console.log(`  Samples: ${results.map(r => `Y${(r.yPct*100).toFixed(0)}%=${r.cols}cols`).join(", ")}`);

  // Bucket into Normal(~12) vs Quad(~24)
  const normalVotes = colCounts.filter(c => c >= 10 && c <= 14).length;
  const quadVotes = colCounts.filter(c => c >= 20 && c <= 26).length;
  
  if (quadVotes > normalVotes) {
    console.log(`  → QUAD TAB (${quadVotes}/${colCounts.length} votes)`);
    return "quad";
  } else if (normalVotes > quadVotes) {
    console.log(`  → NORMAL TAB (${normalVotes}/${colCounts.length} votes)`);
    return "normal";
  } else {
    console.log(`  → UNCERTAIN (normal=${normalVotes}, quad=${quadVotes})`);
    return "unknown";
  }
}

async function main() {
  const dir = path.join(__dirname, "../src/templates");
  await detectTabType(path.join(dir, "normal_tab_calibration.png"));
  await detectTabType(path.join(dir, "quad_tab_calibration.png"));
}

main().catch(console.error);
