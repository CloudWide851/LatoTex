import { describe, expect, it } from "vitest";
import { describeValidationIssue } from "./pluginMarketplaceUtils";

describe("pluginMarketplaceUtils", () => {
  it("localizes high-risk permission issues from structured params", () => {
    const text = describeValidationIssue(
      {
        code: "plugin.permission.high_risk",
        severity: "warning",
        message: "High-risk permission declared: network.fetch.",
        params: { permission: "network.fetch" },
      },
      (key) => key === "plugins.validationIssue.permissionHighRisk"
        ? "声明了高风险权限：{permission}。"
        : String(key),
    );

    expect(text).toBe("声明了高风险权限：network.fetch。");
  });

  it("localizes high-risk permission issues from legacy messages", () => {
    const text = describeValidationIssue(
      {
        code: "plugin.permission.high_risk",
        severity: "warning",
        message: "High-risk permission declared: process.spawn.",
      },
      (key) => key === "plugins.validationIssue.permissionHighRisk"
        ? "声明了高风险权限：{permission}。"
        : String(key),
    );

    expect(text).toBe("声明了高风险权限：process.spawn。");
  });
});
