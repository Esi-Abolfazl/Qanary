import { describe, it, expect, vi } from "vitest";

// ---------- mock @tauri-apps/plugin-updater ----------
// We build stub Update objects whose `install` fn is a spy, so we can verify
// which object checkForUpdate leaves in `pending`.

type MockUpdate = {
  available: boolean;
  version: string;
  body?: string;
  download: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
};

function makeUpdate(version: string): MockUpdate {
  return {
    available: true,
    version,
    body: `notes for ${version}`,
    download: vi.fn(),
    install: vi.fn(),
  };
}

let mockUpdate: MockUpdate | null = null;

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(async () => mockUpdate),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

// Import after mocks are registered.
// The module is a singleton — each test uses unique version numbers so inter-test
// state (the module-level `pending`) does not interfere.
import { checkForUpdate, downloadUpdate, installAndRelaunch } from "./update";

describe("checkForUpdate — guard", () => {
  it("stores the update handle on first check", async () => {
    mockUpdate = makeUpdate("0.1.0");
    const info = await checkForUpdate();
    expect(info?.version).toBe("0.1.0");
  });

  it("same-version re-check does NOT replace the stored handle", async () => {
    // handleA lands first (different version from any earlier test).
    const handleA = makeUpdate("1.0.1");
    mockUpdate = handleA;
    await checkForUpdate(); // pending = handleA

    // Second check: same version → guard must preserve handleA.
    const handleB = makeUpdate("1.0.1");
    mockUpdate = handleB;
    await checkForUpdate(); // pending must stay handleA

    await installAndRelaunch().catch(() => {}); // relaunch mock throws — ignore
    expect(handleA.install).toHaveBeenCalled();
    expect(handleB.install).not.toHaveBeenCalled();
  });

  it("newer version replaces the stored handle", async () => {
    // Start from the version left by the previous test (1.0.1), then bump to 1.0.2.
    const handleA = makeUpdate("1.0.2");
    mockUpdate = handleA;
    await checkForUpdate(); // pending = handleA (1.0.1 → 1.0.2, version changed)

    const handleB = makeUpdate("1.0.3");
    mockUpdate = handleB;
    await checkForUpdate(); // pending = handleB (1.0.2 → 1.0.3)

    await installAndRelaunch().catch(() => {});
    expect(handleB.install).toHaveBeenCalled();
    expect(handleA.install).not.toHaveBeenCalled();
  });

  it("returns null when no update available", async () => {
    mockUpdate = null;
    const info = await checkForUpdate();
    expect(info).toBeNull();
  });
});

describe("downloadUpdate", () => {
  it("calls download on the pending handle and fires progress callbacks", async () => {
    const handle = makeUpdate("2.0.0");
    mockUpdate = handle;
    await checkForUpdate(); // pending = handle

    handle.download.mockImplementation(async (cb: (e: unknown) => void) => {
      cb({ event: "Started", data: { contentLength: 1000 } });
      cb({ event: "Progress", data: { chunkLength: 500 } });
      cb({ event: "Finished" });
    });
    const onProgress = vi.fn();
    await downloadUpdate(onProgress);
    expect(handle.download).toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith(100);
  });
});
