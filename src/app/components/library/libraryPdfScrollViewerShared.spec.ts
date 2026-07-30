import { describe, expect, it, vi } from "vitest";
import {
  ensurePdfScrollSyncGroup,
  publishPdfScrollSync,
  type LibraryPdfScrollSyncGroup,
} from "./libraryPdfScrollViewerShared";

describe("libraryPdfScrollViewerShared", () => {
  it("publishes a measured anchor to peers without echoing it to the leader", () => {
    const ref: { current: LibraryPdfScrollSyncGroup | null } = { current: null };
    const group = ensurePdfScrollSyncGroup(ref);
    const source = vi.fn();
    const translated = vi.fn();
    group?.viewers.set("source", source);
    group?.viewers.set("translated", translated);
    const anchor = { page: 4, pageFocusRatio: 0.25, absoluteRatio: 0.6 };

    const message = publishPdfScrollSync(group!, "source", anchor);

    expect(source).not.toHaveBeenCalled();
    expect(translated).toHaveBeenCalledOnce();
    expect(translated).toHaveBeenCalledWith(message);
    expect(group?.lastMessage).toEqual(message);
  });
});
