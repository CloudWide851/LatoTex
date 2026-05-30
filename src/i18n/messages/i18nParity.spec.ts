import { describe, expect, it } from "vitest";
import { enUS } from "./en-US";
import { esES } from "./es-ES";
import { jaJP } from "./ja-JP";
import { zhCN } from "./zh-CN";

describe("i18n message parity", () => {
  it("keeps locale keys synchronized with en-US keys", () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(enUS).sort());
    expect(Object.keys(esES).sort()).toEqual(Object.keys(enUS).sort());
    expect(Object.keys(jaJP).sort()).toEqual(Object.keys(enUS).sort());
  });
});
