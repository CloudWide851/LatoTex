import { describe, expect, it } from "vitest";
import { getVirtualRange } from "./VirtualizedList";

describe("VirtualizedList range helper", () => {
  it("renders a bounded initial range with overscan", () => {
    expect(getVirtualRange({
      itemCount: 1000,
      scrollTop: 0,
      viewportHeight: 100,
      estimatedItemHeight: 20,
      overscan: 2,
    })).toEqual({
      start: 0,
      end: 9,
      before: 0,
      after: 19820,
    });
  });

  it("adds before and after spacer heights for scrolled ranges", () => {
    expect(getVirtualRange({
      itemCount: 1000,
      scrollTop: 400,
      viewportHeight: 100,
      estimatedItemHeight: 20,
      overscan: 2,
    })).toEqual({
      start: 18,
      end: 27,
      before: 360,
      after: 19460,
    });
  });
});
