import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { callTool, handleMcpMessage } from "./latotex-mcp.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "latotex-mcp-test-"));
  fs.writeFileSync(path.join(root, "main.tex"), "\\begin{document}Hello\\end{document}\n", "utf8");
  return root;
}

test("standalone MCP defaults to read-only without compile", () => {
  const root = fixture();
  try {
    const response = handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { projectRoot: root, allowWrite: false, allowCompile: false },
    );
    const names = response.result.tools.map((tool) => tool.name);
    assert(!names.includes("compile_tex"));
    assert(!names.includes("apply_latex_edit"));
    assert.throws(
      () => callTool(root, false, "compile_tex", { mainPath: "main.tex" }, false),
      /compile_disabled/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("standalone MCP rejects traversal and keeps writes opt-in", () => {
  const root = fixture();
  try {
    assert.throws(() => callTool(root, false, "read_tex", { path: "../outside.tex" }), /path_outside_project/);
    assert.throws(
      () => callTool(root, false, "apply_latex_edit", {
        path: "main.tex",
        search: "Hello",
        replace: "Changed",
      }),
      /write_disabled/,
    );
    const result = callTool(root, true, "apply_latex_edit", {
      path: "main.tex",
      search: "Hello",
      replace: "Changed",
    });
    assert.equal(result.changed, true);
    assert.match(fs.readFileSync(path.join(root, "main.tex"), "utf8"), /Changed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("standalone MCP bounds text tool output", () => {
  const root = fixture();
  try {
    fs.writeFileSync(path.join(root, "large.tex"), "x".repeat(20_000), "utf8");
    const result = callTool(root, false, "read_tex", { path: "large.tex", maxChars: 512 });
    assert.equal(Array.from(result.content).length, 512);
    assert.equal(result.truncated, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
