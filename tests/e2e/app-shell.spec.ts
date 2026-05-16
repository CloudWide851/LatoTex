import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

let server: Server;
let baseUrl: string;

const shareRoot = resolve("src-tauri/resources/core/share-page");
const logoPath = resolve("src/assets/branding/logo-icon-rounded.svg");

function contentType(filePath: string) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/api/bootstrap") {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({
        ok: true,
        sessionId: "e2e-session",
        targetPath: "main.tex",
        expiresAt: "2026-05-16T00:00:00Z",
        status: "running",
        tunnelState: "disabled",
        tunnelError: null,
        sessionName: "E2E Share",
        sessionCreatedAt: "2026-05-16T00:00:00Z",
        passwordRequired: true,
      }));
      return;
    }
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (url.pathname === "/assets/logo-icon-rounded.svg") {
      const bytes = await readFile(logoPath);
      response.writeHead(200, { "Content-Type": "image/svg+xml" });
      response.end(bytes);
      return;
    }

    const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/assets\//, "");
    const filePath = normalize(join(shareRoot, relative));
    if (!filePath.startsWith(shareRoot)) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }
    try {
      const bytes = await readFile(filePath);
      response.writeHead(200, { "Content-Type": contentType(filePath) });
      response.end(bytes);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });
  await new Promise<void>((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address) {
        baseUrl = `http://127.0.0.1:${address.port}`;
      }
      resolveServer();
    });
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
});

test("share page shell renders without horizontal overflow", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#share-root")).toBeVisible();
  await expect(page.locator("body")).not.toHaveText("");

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
  expect(consoleErrors.filter((entry) => !entry.includes("ResizeObserver"))).toEqual([]);
});
