import { afterEach, describe, expect, it } from "vitest";
import {
  registerAppDialogHost,
  requestAppChoice,
  requestAppConfirm,
  requestAppTextInput,
  type AppDialogBridgeEntry,
} from "./appDialogBridge";

let unregister: (() => void) | null = null;

afterEach(() => {
  unregister?.();
  unregister = null;
});

describe("appDialogBridge", () => {
  it("serializes requests and resolves each result through the owner", async () => {
    const visible: AppDialogBridgeEntry[] = [];
    unregister = registerAppDialogHost((entry) => {
      if (entry) visible.push(entry);
    });

    const confirmPromise = requestAppConfirm({ title: "Confirm" });
    const inputPromise = requestAppTextInput({ title: "Input", label: "Name" });
    expect(visible).toHaveLength(1);
    expect(visible[0].request.kind).toBe("confirm");

    visible[0].settle(true);
    await Promise.resolve();
    expect(await confirmPromise).toBe(true);
    expect(visible).toHaveLength(2);
    expect(visible[1].request.kind).toBe("text-input");

    visible[1].settle("Result");
    expect(await inputPromise).toBe("Result");
  });

  it("returns the active request to the queue while its host is remounted", async () => {
    const firstOwnerEntries: AppDialogBridgeEntry[] = [];
    unregister = registerAppDialogHost((entry) => {
      if (entry) firstOwnerEntries.push(entry);
    });
    const choicePromise = requestAppChoice({
      title: "Permission",
      choices: [{ id: "deny", label: "Deny" }],
    });
    const activeId = firstOwnerEntries[0]?.id;

    unregister();
    unregister = null;
    const secondOwnerEntries: AppDialogBridgeEntry[] = [];
    unregister = registerAppDialogHost((entry) => {
      if (entry) secondOwnerEntries.push(entry);
    });

    expect(secondOwnerEntries[0]?.id).toBe(activeId);
    secondOwnerEntries[0]?.settle("deny");
    expect(await choicePromise).toBe("deny");
  });
});
