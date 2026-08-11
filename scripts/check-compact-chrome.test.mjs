import assert from "node:assert/strict";
import {
  findCompactChromeViolations,
  isCompactChromeContentSurface,
} from "./check-compact-chrome.mjs";

assert.deepEqual(
  findCompactChromeViolations('<h1 className="text-xl">Title</h1>'),
  [{ rule: "large-type", line: 1, detail: "text-xl" }],
);
assert.deepEqual(
  findCompactChromeViolations('<h1 className="text-[17px]">Title</h1>'),
  [{ rule: "large-type", line: 1, detail: "text-[17px]" }],
);
assert.deepEqual(
  findCompactChromeViolations('<h1 className="text-base">Title</h1>'),
  [],
);
assert.equal(
  isCompactChromeContentSurface("src/app/components/markdown/MarkdownPreviewPane.tsx"),
  true,
);
assert.deepEqual(
  findCompactChromeViolations(
    '<article className="text-3xl">User document</article>',
    "src/app/components/markdown/MarkdownPreviewPane.tsx",
  ),
  [],
);
assert.deepEqual(
  findCompactChromeViolations('<p>{t("workspace.subtitle")}</p>'),
  [{ rule: "visible-subtitle", line: 1, detail: 't("workspace.subtitle")' }],
);
assert.deepEqual(
  findCompactChromeViolations('<InfoHint content={t("workspace.subtitle")} />'),
  [],
);
assert.deepEqual(
  findCompactChromeViolations('<pre>{this.state.errorMessage}</pre>'),
  [{ rule: "raw-error", line: 1, detail: "this.state.errorMessage" }],
);

console.log("Compact chrome fixture tests passed.");
