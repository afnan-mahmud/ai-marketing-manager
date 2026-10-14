// Copies non-TS runtime assets (SQL migrations, markdown resources) from src/ to dist/.
import { cpSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const dist = join(root, "dist");
const exts = new Set([".sql", ".md"]);

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (exts.has(extname(name))) {
      const target = join(dist, relative(src, p));
      mkdirSync(dirname(target), { recursive: true });
      cpSync(p, target);
    }
  }
}
walk(src);
