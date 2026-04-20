import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

const projectRoot = process.cwd();
const outDir = path.resolve(projectRoot, "src-tauri/resources/core/share-page");
const jsOutfile = path.join(outDir, "share_page.js");
const cssOutfile = path.join(outDir, "share_page.css");
const htmlOutfile = path.join(outDir, "index.html");

const shareHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>LatoTex Share</title>
    <link rel="stylesheet" href="/assets/share_page.css" />
  </head>
  <body>
    <div id="share-root"></div>
    <script type="module" src="/assets/share_page.js"></script>
  </body>
</html>
`;

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function main() {
  await ensureDir(outDir);

  const cssInput = await fs.readFile(path.resolve(projectRoot, "src/share-page/index.css"), "utf8");
  const cssResult = await postcss([
    tailwindcss({ config: path.resolve(projectRoot, "tailwind.config.ts") }),
    autoprefixer(),
  ]).process(cssInput, {
    from: path.resolve(projectRoot, "src/share-page/index.css"),
    to: cssOutfile,
  });
  await fs.writeFile(cssOutfile, cssResult.css, "utf8");

  await build({
    entryPoints: [path.resolve(projectRoot, "src/share-page/main.tsx")],
    outfile: jsOutfile,
    bundle: true,
    format: "esm",
    target: "es2021",
    jsx: "automatic",
    minify: true,
    sourcemap: false,
    logLevel: "info",
    define: {
      "process.env.NODE_ENV": "\"production\"",
    },
  });

  await fs.writeFile(htmlOutfile, shareHtml, "utf8");
  console.log(`Share page assets built in ${outDir}`);
}

await main();
