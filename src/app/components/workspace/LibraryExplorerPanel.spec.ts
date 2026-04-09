import { describe, expect, it } from "vitest";
import { filterPaperNodes } from "./LibraryExplorerPanel";
import type { ResourceNode } from "../../../shared/types/app";

describe("filterPaperNodes", () => {
  it("keeps empty library folders visible while hiding companion pdf files", () => {
    const tree: ResourceNode[] = [
      {
        name: "papers",
        relativePath: "papers",
        kind: "directory",
        children: [
          {
            name: "empty",
            relativePath: "papers/empty",
            kind: "directory",
            children: [],
          },
          {
            name: "demo.bib",
            relativePath: "papers/demo.bib",
            kind: "file",
            children: [],
          },
          {
            name: "demo.pdf",
            relativePath: "papers/demo.pdf",
            kind: "file",
            children: [],
          },
        ],
      },
    ];

    const filtered = filterPaperNodes(tree);
    const papers = filtered[0];

    expect(papers.children.map((child) => child.relativePath)).toEqual([
      "papers/empty",
      "papers/demo.bib",
    ]);
  });
});
