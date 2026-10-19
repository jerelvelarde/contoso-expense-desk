// Render QA stills from one bundle: node qa.mjs <seconds...>  (writes out/qa/s<sec>.jpg at half scale)
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
import fs from "node:fs";

const secs = process.argv.slice(2).map(Number);
const out = path.resolve("out/qa");
fs.mkdirSync(out, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const composition = await selectComposition({ serveUrl, id: "ApprovalsThatLearn" });
for (const s of secs) {
  const frame = Math.round(s * composition.fps);
  await renderStill({ serveUrl, composition, frame, output: path.join(out, `s${s}.jpg`), imageFormat: "jpeg", jpegQuality: 85, scale: 0.5 });
  console.log("still", s);
}
