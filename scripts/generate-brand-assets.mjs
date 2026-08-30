import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmRoot = join(root, "node_modules", ".pnpm");

function packageFile(prefix, relativePath) {
  const folder = readdirSync(pnpmRoot).find((entry) => entry.startsWith(prefix));
  if (!folder) throw new Error(`Missing ${prefix} in node_modules. Run pnpm install first.`);
  const result = join(pnpmRoot, folder, relativePath);
  if (!existsSync(result)) throw new Error(`Missing brand dependency: ${result}`);
  return result;
}

const canvasEntry = packageFile(
  "@napi-rs+canvas@",
  "node_modules/@napi-rs/canvas/index.js",
);
const require = createRequire(import.meta.url);
const { createCanvas, GlobalFonts } = require(canvasEntry);

const manrope = packageFile(
  "@fontsource+manrope@",
  "node_modules/@fontsource/manrope/files/manrope-latin-600-normal.woff2",
);
const playfair = packageFile(
  "@fontsource+playfair-display@",
  "node_modules/@fontsource/playfair-display/files/playfair-display-latin-600-normal.woff2",
);

GlobalFonts.registerFromPath(manrope, "osChat Manrope");
GlobalFonts.registerFromPath(playfair, "osChat Playfair");

const width = 1200;
const height = 320;
// These measurements mirror osCode's 152px wordmark height and baseline inside
// the shared 1200 x 320 transparent canvas. "Chat" is naturally wider than
// "Code", so its tight word boundary is preserved without overlapping glyphs.
const fontSize = 190;
const baseline = 239;
const startX = 307;
const overlap = 12;
const output = join(root, "assets", "logo");
const colours = {
  "baby-blue": "#89cff0",
  black: "#101817",
  white: "#ffffff",
};

function layout(context) {
  context.font = `600 ${fontSize}px \"osChat Manrope\"`;
  const osWidth = context.measureText("os").width;
  return { chatX: startX + osWidth - overlap };
}

function drawWordmark(context, colour) {
  const { chatX } = layout(context);
  context.fillStyle = colour;
  context.textBaseline = "alphabetic";
  context.font = `600 ${fontSize}px \"osChat Manrope\"`;
  context.fillText("os", startX, baseline);
  context.font = `600 ${fontSize}px \"osChat Playfair\"`;
  context.fillText("Chat", chatX, baseline);
}

function png(name, colour) {
  const canvas = createCanvas(width, height);
  drawWordmark(canvas.getContext("2d"), colour);
  writeFileSync(join(output, `oschat-${name}.png`), canvas.toBuffer("image/png"));
}

const encodedManrope = readFileSync(manrope).toString("base64");
const encodedPlayfair = readFileSync(playfair).toString("base64");

function svg(name, colour) {
  const measureCanvas = createCanvas(1, 1);
  const { chatX } = layout(measureCanvas.getContext("2d"));
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">
  <title id="title">osChat</title>
  <style>
    @font-face { font-family: "osChat Manrope"; src: url(data:font/woff2;base64,${encodedManrope}) format("woff2"); font-weight: 600; }
    @font-face { font-family: "osChat Playfair"; src: url(data:font/woff2;base64,${encodedPlayfair}) format("woff2"); font-weight: 600; }
  </style>
  <text x="${startX}" y="${baseline}" fill="${colour}" font-family="osChat Manrope" font-size="${fontSize}" font-weight="600">os</text>
  <text x="${chatX.toFixed(2)}" y="${baseline}" fill="${colour}" font-family="osChat Playfair" font-size="${fontSize}" font-weight="600">Chat</text>
</svg>
`;
  writeFileSync(join(output, `oschat-${name}.svg`), source);
}

for (const [name, colour] of Object.entries(colours)) {
  png(name, colour);
  svg(name, colour);
}

svg("wordmark-dark", colours.black);
svg("wordmark-light", colours.white);

console.log("Generated osChat brand assets with Manrope 600 + Playfair Display 600.");
