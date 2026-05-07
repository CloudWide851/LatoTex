import { describe, expect, it } from "vitest";
import { enUS } from "./en-US";
import { zhCN } from "./zh-CN";

describe("i18n message parity", () => {
  it("keeps zh-CN keys synchronized with en-US keys", () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(enUS).sort());
  });
});
