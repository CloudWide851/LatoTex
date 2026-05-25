import { describe, expect, it } from "vitest";
import {
  colorForShareIdentity,
  createShareEditAnnotation,
  mergeShareEditAnnotation,
} from "./shareEditAnnotations";

describe("shareEditAnnotations", () => {
  it("creates a colored annotation for remote insertions", () => {
    const annotation = createShareEditAnnotation({
      event: {
        seq: 12,
        from: "web-a",
        update: "ignored",
        participantId: "p-web-a",
        username: "Alice",
        createdAt: "2026-05-25T10:00:00Z",
      },
      path: "main.tex",
      before: "hello",
      after: "hello world",
      fallbackUsername: "Collaborator",
    });

    expect(annotation).toMatchObject({
      id: "share-edit-12-p-web-a",
      participantId: "p-web-a",
      username: "Alice",
      start: 5,
      end: 11,
      kind: "insert",
      color: colorForShareIdentity("p-web-a"),
    });
  });

  it("anchors deletion annotations without a highlighted range", () => {
    const annotation = createShareEditAnnotation({
      event: { seq: 3, from: "web-b", update: "ignored" },
      path: "main.tex",
      before: "alpha beta",
      after: "alpha ",
      fallbackUsername: "Collaborator",
    });

    expect(annotation?.kind).toBe("delete");
    expect(annotation?.start).toBe(6);
    expect(annotation?.end).toBe(6);
  });

  it("dedupes and caps merged annotations", () => {
    const base = Array.from({ length: 25 }, (_, index) => ({
      id: `old-${index}`,
      seq: index,
      path: "main.tex",
      participantId: "p",
      username: "User",
      color: "#2563eb",
      start: 0,
      end: 1,
      kind: "insert" as const,
      createdAt: "2026-05-25T10:00:00Z",
    }));

    expect(mergeShareEditAnnotation(base, base[24])).toHaveLength(24);
  });
});
