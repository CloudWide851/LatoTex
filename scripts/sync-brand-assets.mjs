import fs from "node:fs";
import path from "node:path";

const sourceLogo = path.resolve("src/assets/branding/logo.svg");
const tauriLogo = path.resolve("src-tauri/icons/logo.svg");

if (!fs.existsSync(sourceLogo)) {
  console.error(`Brand logo is missing: ${sourceLogo}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(tauriLogo), { recursive: true });
const sourceContent = fs.readFileSync(sourceLogo);
const currentContent = fs.existsSync(tauriLogo) ? fs.readFileSync(tauriLogo) : null;
if (!currentContent || !sourceContent.equals(currentContent)) {
  fs.writeFileSync(tauriLogo, sourceContent);
  console.log("Brand logo synced to src-tauri/icons/logo.svg");
} else {
  console.log("Brand logo already synced");
}

