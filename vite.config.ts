import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = dirname(fileURLToPath(import.meta.url));

function resolveManualChunk(id: string) {
  const normalized = id.replace(/\\/g, "/");

  if (!normalized.includes("node_modules")) {
    return undefined;
  }

  if (normalized.includes("monaco-editor/esm/vs/basic-languages/")) {
    return "vendor-monaco-languages";
  }
  if (normalized.includes("@monaco-editor") || normalized.includes("monaco-editor")) {
    return "vendor-monaco";
  }
  if (normalized.includes("react-pdf") || normalized.includes("pdfjs-dist")) {
    return "vendor-pdf";
  }
  if (normalized.includes("exceljs")) {
    return "vendor-exceljs";
  }
  if (normalized.includes("papaparse")) {
    return "vendor-papaparse";
  }
  if (normalized.includes("react-markdown") || normalized.includes("remark-") || normalized.includes("rehype-") || normalized.includes("highlight.js")) {
    return "vendor-markdown";
  }
  if (normalized.includes("katex")) {
    return "vendor-katex";
  }
  if (normalized.includes("yjs") || normalized.includes("qrcode")) {
    return "vendor-collab";
  }
  if (normalized.includes("texlyre-busytex") || normalized.includes("pyodide")) {
    return "vendor-wasm";
  }
  if (normalized.includes("react") || normalized.includes("react-dom") || normalized.includes("scheduler")) {
    return "vendor-react";
  }

  return undefined;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(rootDir, "src"),
      "@app": resolve(rootDir, "src/app"),
      "@features": resolve(rootDir, "src/features"),
      "@shared": resolve(rootDir, "src/shared"),
      "@components": resolve(rootDir, "src/components"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "0.0.0.0",
    fs: {
      deny: ["**/src-tauri/target/**", "**/src-tauri/resources/python/**"],
    },
  },
  optimizeDeps: {
    entries: ["index.html"],
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
    copyPublicDir: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: resolveManualChunk,
      },
    },
  }
});
