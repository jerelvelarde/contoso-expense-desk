#!/usr/bin/env node
// Writes .br and .gz next to every compressible file in a built site, so
// server.mjs can serve them without compressing on each request.
// Usage: node deploy/web/precompress.mjs web/dist

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".xml", ".webmanifest", ".ttf", ".otf", ".wasm"]);
const MIN_BYTES = 1024;

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node deploy/web/precompress.mjs <dist_dir>");
  process.exit(2);
}

const br = promisify(brotliCompress);
const gz = promisify(gzip);

async function* walk(d) {
  for (const entry of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile()) yield p;
  }
}

const jobs = [];
let count = 0;
let before = 0;
let after = 0;
for await (const file of walk(dir)) {
  if (!COMPRESSIBLE.has(path.extname(file).toLowerCase())) continue;
  jobs.push(
    (async () => {
      const src = await readFile(file);
      if (src.length < MIN_BYTES) return;
      const [b, g] = await Promise.all([
        br(src, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: 11,
            [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
            [constants.BROTLI_PARAM_SIZE_HINT]: src.length,
          },
        }),
        gz(src, { level: 9 }),
      ]);
      // Only keep a variant that is meaningfully smaller.
      if (b.length < src.length * 0.9) await writeFile(`${file}.br`, b);
      if (g.length < src.length * 0.9) await writeFile(`${file}.gz`, g);
      count += 1;
      before += src.length;
      after += Math.min(b.length, src.length);
    })(),
  );
}
await Promise.all(jobs);
const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`precompressed ${count} files: ${mb(before)} MB -> ${mb(after)} MB (brotli)`);
