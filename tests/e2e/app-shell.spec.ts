import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

let server: Server;
let baseUrl: string;
let postedComments = 0;

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
    if (url.pathname === "/api/join" && request.method === "POST") {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({
        participantId: "participant-e2e",
        participantToken: "token-e2e",
        participants: [{ id: "participant-e2e", username: "E2E", color: "#2563eb", lastSeenAt: new Date().toISOString() }],
      }));
      return;
    }
    if (url.pathname === "/api/presence/ping" && request.method === "POST") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        participants: [{ id: "participant-e2e", username: "E2E", color: "#2563eb", lastSeenAt: new Date().toISOString() }],
      }));
      return;
    }
    if (url.pathname === "/api/comments/list") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ comments: [] }));
      return;
    }
    if (url.pathname === "/api/comments/post" && request.method === "POST") {
      postedComments += 1;
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        comments: [{
          id: `comment-${postedComments}`,
          username: "E2E",
          text: "Looks good",
          quote: "",
          source: "tex",
          createdAt: new Date().toISOString(),
        }],
      }));
      return;
    }
    if (url.pathname === "/api/pdf/status") {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ state: "missing", updatedAt: null, sizeBytes: 0, version: null }));
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

test("share bootstrap keeps private document state out of the public payload", async ({ request }) => {
  const response = await request.get(`${baseUrl}/api/bootstrap`);
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload).not.toHaveProperty("comments");
  expect(payload).not.toHaveProperty("pdfState");
  expect(payload).not.toHaveProperty("pdfUpdatedAt");
  expect(payload).not.toHaveProperty("hasPdf");
  expect(payload).not.toHaveProperty("password");
  expect(payload.passwordRequired).toBe(true);
});

test("share collaboration browser endpoints accept the mocked workflow", async ({ request }) => {
  const join = await request.post(`${baseUrl}/api/join`, {
    data: { sid: "e2e-session", pwd: "secret", clientId: "client-e2e", username: "E2E" },
  });
  expect(join.ok()).toBe(true);
  const joined = await join.json();
  expect(joined.participantId).toBe("participant-e2e");

  const ping = await request.post(`${baseUrl}/api/presence/ping`, {
    data: {
      sid: "e2e-session",
      pwd: "secret",
      participantId: joined.participantId,
      participantToken: joined.participantToken,
      action: "focus",
    },
  });
  expect(ping.ok()).toBe(true);

  const comments = await request.get(
    `${baseUrl}/api/comments/list?sid=e2e-session&pwd=secret&participantId=${joined.participantId}&participantToken=${joined.participantToken}`,
  );
  expect(comments.ok()).toBe(true);

  const pdfStatus = await request.get(`${baseUrl}/api/pdf/status?sid=e2e-session&pwd=secret`);
  expect(pdfStatus.ok()).toBe(true);
  await expect(pdfStatus.json()).resolves.toMatchObject({ state: "missing" });
});
