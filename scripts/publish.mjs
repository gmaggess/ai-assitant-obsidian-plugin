// Copies the built plugin into an Obsidian vault's plugins folder.
// Only release files are copied; the vault's data.json and history.json are left alone.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const vault = process.env.OBSIDIAN_VAULT ?? "/Users/gmaggess/Obsidian/gmaggess";
const { id, version } = JSON.parse(readFileSync("manifest.json", "utf8"));
const files = ["main.js", "manifest.json", "styles.css"];

for (const f of files) {
  if (!existsSync(f)) { console.error(`Missing ${f}. Run the build first.`); process.exit(1); }
}
if (!existsSync(join(vault, ".obsidian"))) {
  console.error(`Not an Obsidian vault: ${vault} (set OBSIDIAN_VAULT to override)`);
  process.exit(1);
}

const dest = join(vault, ".obsidian", "plugins", id);
mkdirSync(dest, { recursive: true });
for (const f of files) copyFileSync(f, join(dest, f));

console.log(`Published ${id} v${version} to ${dest}`);
console.log("Reload Obsidian (Cmd+R) or toggle the plugin off/on to pick up the new build.");
