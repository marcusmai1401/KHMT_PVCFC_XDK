import { recoveryNamespace } from "../../api/client";

export type DraftRecoveryRecord<T> = {
  contextKey: string;
  namespace: string;
  userId: string;
  module: string;
  resource: string;
  schemaVersion: string;
  data: T;
  baseRevision: number | null;
  localRevision: number;
  updatedAt: string;
  expiresAt: string;
};

export type DraftRecoveryResult = {
  ok: boolean;
  warning?: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function scopedKey(namespace: string, userId: string, module: string, resource: string, schemaVersion: string) {
  return [namespace, userId, module, resource, schemaVersion]
    .map((value) => encodeURIComponent(value || "unknown"))
    .join(":");
}

function getSessionStorage(): StorageLike | null {
  try {
    return typeof globalThis.sessionStorage === "undefined" ? null : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

/** Session-scoped, account-scoped JSON recovery. Binary files are deliberately not accepted. */
export class DraftRecoveryStore<T> {
  private readonly key: string;
  private readonly storage: StorageLike | null;
  private readonly ttlMs: number;
  private readonly context: Omit<DraftRecoveryRecord<T>, "data" | "baseRevision" | "localRevision" | "updatedAt" | "expiresAt">;

  constructor(options: {
    namespace: string;
    userId: string;
    module: string;
    resource: string;
    schemaVersion: string;
    ttlMs?: number;
    storage?: StorageLike | null;
  }) {
    options = { ...options, namespace: `${recoveryNamespace()}:${options.namespace}` };
    this.key = scopedKey(options.namespace, options.userId, options.module, options.resource, options.schemaVersion);
    this.storage = options.storage === undefined ? getSessionStorage() : options.storage;
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.context = {
      contextKey: `${options.module}:${options.resource}`,
      namespace: options.namespace,
      userId: options.userId,
      module: options.module,
      resource: options.resource,
      schemaVersion: options.schemaVersion,
    };
  }

  read(now = Date.now()): DraftRecoveryRecord<T> | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return null;
      const record = JSON.parse(raw) as DraftRecoveryRecord<T>;
      if (!record || record.expiresAt === undefined || new Date(record.expiresAt).getTime() <= now) {
        this.storage.removeItem(this.key);
        return null;
      }
      if (record.namespace !== this.context.namespace || record.userId !== this.context.userId
        || record.module !== this.context.module || record.resource !== this.context.resource
        || record.schemaVersion !== this.context.schemaVersion) {
        return null;
      }
      return record;
    } catch {
      return null;
    }
  }

  write(data: T, baseRevision: number | null, localRevision: number, now = Date.now()): DraftRecoveryResult {
    if (!this.storage) return { ok: false, warning: "Không thể bật khôi phục bản nháp trên trình duyệt này." };
    const record: DraftRecoveryRecord<T> = {
      ...this.context,
      data,
      baseRevision,
      localRevision,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
    };
    try {
      // JSON serialization prevents accidentally persisting File/Blob instances.
      this.storage.setItem(this.key, JSON.stringify(record));
      return { ok: true };
    } catch {
      return {
        ok: false,
        warning: "Bộ nhớ phiên đã đầy. Hãy tải bản nháp xuống để tránh mất dữ liệu.",
      };
    }
  }

  remove(): void {
    try {
      this.storage?.removeItem(this.key);
    } catch {
      // Recovery is best-effort and must never block a save or navigation action.
    }
  }

  getStorageKey(): string {
    return this.key;
  }
}

export function downloadDraft<T>(filename: string, data: T): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
