import { describe, expect, it } from "vitest";
import { DraftRecoveryStore } from "./DraftRecoveryStore";
import { setToken } from "../../api/client";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("DraftRecoveryStore", () => {
  it("isolates sandbox drafts from the same account in the normal environment", () => {
    const session = storage();
    const options = { namespace: "okr", userId: "alice", module: "fi", resource: "active", schemaVersion: "1", storage: session };
    setToken("");
    const normal = new DraftRecoveryStore(options);
    normal.write({ text: "normal draft" }, 0, 1);
    setToken(`test.${btoa(JSON.stringify({sandbox: true}))}.test`);
    const sandbox = new DraftRecoveryStore(options);
    expect(sandbox.read()).toBeNull();
    sandbox.write({ text: "sandbox draft" }, 0, 1);
    setToken("");
    expect(new DraftRecoveryStore(options).read()?.data).toEqual({text: "normal draft"});
  });
  it("scopes records to the account and expires them", () => {
    const session = storage();
    const store = new DraftRecoveryStore({
      namespace: "okr",
      userId: "alice",
      module: "web-input",
      resource: "TBCH:4:2026",
      schemaVersion: "1",
      ttlMs: 100,
      storage: session,
    });
    expect(store.write({ text: "draft" }, 2, 3, 1000).ok).toBe(true);
    expect(store.read(1050)?.data).toEqual({ text: "draft" });
    expect(store.read(1100)).toBeNull();
    expect(new DraftRecoveryStore({
      namespace: "okr",
      userId: "bob",
      module: "web-input",
      resource: "TBCH:4:2026",
      schemaVersion: "1",
      storage: session,
    }).read()).toBeNull();
  });
});
