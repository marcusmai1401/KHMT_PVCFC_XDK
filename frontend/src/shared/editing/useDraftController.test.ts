import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import { DraftController } from "./useDraftController";

describe("DraftController", () => {
  beforeEach(() => vi.useFakeTimers());

  it("does not restart autosave when an in-flight request completes after unmount", async () => {
    let finish: (() => void) | undefined;
    const save = vi.fn(() => new Promise<void>(resolve => {finish = resolve;}));
    const controller = new DraftController({contextKey: "et:closed", initialValue: {text: ""}, save});
    controller.update({text: "A"});
    const pending = controller.flush();
    controller.update({text: "B"});
    controller.destroy();
    finish?.();
    await pending;
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not resurrect discarded edits when an aborted request still returns", async () => {
    let complete: ((value: {serverRevision: number; value: {text: string}}) => void) | undefined;
    const controller = new DraftController({contextKey: "et:one", initialValue: {text: "server"}, save: () => new Promise(resolve => {complete = resolve;})});
    controller.update({text: "discard me"});
    const pending = controller.flush();
    controller.discardLocalChanges();
    complete?.({serverRevision: 1, value: {text: "discard me"}});
    await pending;
    expect(controller.state.current).toEqual({text: "server"});
    expect(controller.dirty).toBe(false);
    controller.destroy();
  });

  it("keeps a newer edit dirty while an older autosave is still in flight", async () => {
    let resolveFirst: ((value: { serverRevision: number }) => void) | undefined;
    const save = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue({ serverRevision: 2 });
    const controller = new DraftController({
      contextKey: "okr:user:period",
      initialValue: { text: "" },
      save,
      debounceMs: 1000,
    });

    controller.update({ text: "first" });
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);

    controller.update({ text: "second" });
    resolveFirst?.({ serverRevision: 1 });
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.dirty).toBe(true);
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual({ text: "second" });
    expect(save.mock.calls[1][1]).toBe(1);
    expect(controller.dirty).toBe(false);
  });

  it("preserves local content when the server reports a revision conflict", async () => {
    const save = vi.fn().mockRejectedValue(new ApiError("newer server revision", {
      status: 409,
      code: "VERSION_CONFLICT",
      currentRevision: 4,
    }));
    const controller = new DraftController({
      contextKey: "fi:user:record",
      initialValue: { title: "local" },
      serverRevision: 3,
      save,
      debounceMs: 0,
    });
    controller.update({ title: "local edit" });
    await controller.flush();
    expect(controller.state.phase).toBe("conflict");
    expect(controller.state.current).toEqual({ title: "local edit" });
    expect(controller.dirty).toBe(true);
    controller.update({ title: "merge in progress" });
    await vi.advanceTimersByTimeAsync(1000);
    await controller.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(controller.state.phase).toBe("conflict");
  });

  it("makes manual flush wait for the latest snapshot after an in-flight save", async () => {
    let resolveFirst: ((value: { serverRevision: number }) => void) | undefined;
    const save = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue({ serverRevision: 2 });
    const controller = new DraftController({
      contextKey: "okr:user:period",
      initialValue: { text: "" },
      save,
      debounceMs: 1000,
    });

    controller.update({ text: "A" });
    const firstFlush = controller.flush();
    await Promise.resolve();
    controller.update({ text: "B" });
    const latestFlush = controller.flush();
    expect(save).toHaveBeenCalledTimes(1);

    resolveFirst?.({ serverRevision: 1 });
    await latestFlush;
    await firstFlush;
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual({ text: "B" });
    expect(save.mock.calls[1][1]).toBe(1);
    expect(controller.dirty).toBe(false);
  });
});
