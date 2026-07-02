// pack-wrapper.js — Appends poe2-tools.exe to wrapper.exe with a size trailer
// Output: dist/poe2-tools-portable.exe (single file)
const fs = require("fs");
const path = require("path");

const wrapperPath = path.join(__dirname, "..", "launcher", "wrapper.exe");
const payloadPath = path.join(__dirname, "..", "dist", "poe2-tools.exe");
const outputPath = path.join(__dirname, "..", "dist", "poe2-tools-portable.exe");

if (!fs.existsSync(wrapperPath)) {
  console.error("[pack] wrapper.exe not found. Compile launcher/wrapper.cpp first.");
  process.exit(1);
}
if (!fs.existsSync(payloadPath)) {
  console.error("[pack] dist/poe2-tools.exe not found. Run electron-builder first.");
  process.exit(1);
}

const wrapper = fs.readFileSync(wrapperPath);
const payload = fs.readFileSync(payloadPath);

// Write: wrapper + payload + payload_size(8 bytes LE)
const trailer = Buffer.alloc(8);
trailer.writeBigUInt64LE(BigInt(payload.length));

const out = fs.createWriteStream(outputPath);
out.write(wrapper);
out.write(payload);
out.write(trailer);
out.end(() => {
  const totalMB = (wrapper.length + payload.length + 8) / 1024 / 1024;
  console.log(`[pack] Created ${outputPath} (${totalMB.toFixed(1)}MB)`);
  console.log(`       Wrapper: ${(wrapper.length / 1024).toFixed(0)}KB + Payload: ${(payload.length / 1024 / 1024).toFixed(1)}MB`);
});
