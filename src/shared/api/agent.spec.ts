import { beforeEach, describe, expect, it, vi } from "vitest";
import { listAgentRuntimes } from "./agent";
import { invokeCommand } from "./core";

vi.mock("./core", () => ({
  invokeCommand: vi.fn(),
}));

describe("agent runtime API", () => {
  beforeEach(() => {
    vi.mocked(invokeCommand).mockReset();
  });

  it("reads the explicit cached runtime snapshot command", async () => {
    vi.mocked(invokeCommand).mockResolvedValue([]);

    await listAgentRuntimes();

    expect(invokeCommand).toHaveBeenCalledWith("agent_runtime_list_cached");
  });
});
