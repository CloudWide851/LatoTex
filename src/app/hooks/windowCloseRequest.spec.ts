import { describe, expect, it } from "vitest";
import { resolveNativeWindowClosePlan } from "./windowCloseRequest";

describe("windowCloseRequest", () => {
  it("allows native close when exit behavior has no dirty tabs", () => {
    expect(resolveNativeWindowClosePlan(["main.tex"], [], "exit")).toEqual({
      type: "allow-native-close",
    });
  });

  it("delegates close when behavior is ask and nothing is dirty", () => {
    expect(resolveNativeWindowClosePlan(["main.tex"], [], "ask")).toEqual({
      type: "delegate-close",
      candidatePaths: ["main.tex"],
      dirtyPaths: [],
      reason: "closeBehavior",
    });
  });

  it("delegates close when behavior is tray and nothing is dirty", () => {
    expect(resolveNativeWindowClosePlan(["main.tex"], [], "tray")).toEqual({
      type: "delegate-close",
      candidatePaths: ["main.tex"],
      dirtyPaths: [],
      reason: "closeBehavior",
    });
  });

  it("always delegates to the unsaved guard when tabs are dirty", () => {
    expect(resolveNativeWindowClosePlan(["main.tex", "notes.tex"], ["notes.tex"], "exit")).toEqual({
      type: "delegate-close",
      candidatePaths: ["main.tex", "notes.tex"],
      dirtyPaths: ["notes.tex"],
      reason: "dirty",
    });
  });
});
