// Creates empty directories for sharp's optional platform deps so electron-builder doesn't crash
const fs = require("fs");
const path = require("path");
const sharp = require("../node_modules/sharp/package.json");
const root = path.join(__dirname, "..");
const opts = Object.keys(sharp.optionalDependencies || {});
for (const dep of opts) {
  const dir = path.join(root, "node_modules", dep.replace("/", path.sep));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: dep, version: "0.0.0" }));
  }
}
console.log(`[stub-optionals] Ensured ${opts.length} sharp optional dep dirs exist`);
