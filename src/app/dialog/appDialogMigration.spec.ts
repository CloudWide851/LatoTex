import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(candidate);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [candidate] : [];
  });
}

describe("app dialog migration", () => {
  it("keeps application workflows off browser confirm and prompt dialogs", () => {
    const srcRoot = path.resolve(process.cwd(), "src");
    const violations = sourceFiles(srcRoot).filter((file) => (
      /window\.(?:confirm|prompt)\s*\(/.test(readFileSync(file, "utf8"))
    ));

    expect(violations).toEqual([]);
  });
});
