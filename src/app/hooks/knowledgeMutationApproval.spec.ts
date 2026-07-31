import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewKnowledgeMutation } from "../../shared/api/knowledge";
import {
  knowledgeFailureMessage,
  requestKnowledgeMutationApproval,
} from "./knowledgeMutationApproval";

vi.mock("../../shared/api/knowledge", () => ({
  previewKnowledgeMutation: vi.fn(),
}));

const previewMock = vi.mocked(previewKnowledgeMutation);
const t = (key: string) => `translated:${key}`;

describe("knowledgeMutationApproval", () => {
  beforeEach(() => {
    previewMock.mockReset();
  });

  it("does not prompt when the source is not archived", async () => {
    previewMock.mockResolvedValue({
      required: false,
      affectedItems: [],
      approval: null,
    });
    const confirm = vi.fn();
    const token = await requestKnowledgeMutationApproval({
      projectId: "p1",
      scope: "workspace",
      action: "write",
      path: "notes.md",
      t,
      confirm,
    });
    expect(token).toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("returns only the bound token after explicit confirmation", async () => {
    previewMock.mockResolvedValue({
      required: true,
      affectedItems: [{
        itemId: "i1",
        projectId: "p1",
        relativePath: "notes.md",
        title: "Notes",
        sourceKind: "markdown",
        contentHash: "hash",
        indexState: "ready",
        chunkCount: 1,
        locked: true,
        updatedAt: "2026-07-31",
      }],
      approval: {
        token: "bound-token",
        expiresAtUnixMs: 1,
        contentVersion: "version",
      },
    });
    const confirm = vi.fn((_message: string) => true);
    await expect(requestKnowledgeMutationApproval({
      projectId: "p1",
      scope: "workspace",
      action: "delete",
      path: "notes.md",
      t,
      confirm,
    })).resolves.toBe("bound-token");
    expect(confirm.mock.calls[0]?.[0]).toContain("notes.md");
  });

  it("does not expose unknown native details in UI messages", () => {
    expect(knowledgeFailureMessage("token=secret internal failure", t)).toBe(
      "translated:knowledge.error.failed",
    );
  });
});
