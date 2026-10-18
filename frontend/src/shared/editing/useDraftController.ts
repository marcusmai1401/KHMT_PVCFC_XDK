import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";

export type DraftPhase = "loading" | "clean" | "dirty" | "saving" | "offline" | "conflict" | "error" | "locked" | "auth-required";

export type DraftSaveResult = {
  serverRevision?: number | null;
  savedAt?: string | null;
  value?: unknown;
};

export type DraftControllerState<T> = {
  contextKey: string;
  epoch: number;
  localRevision: number;
  acknowledgedLocalRevision: number;
  serverRevision: number | null;
  current: T;
  lastAcknowledged: T;
  phase: DraftPhase;
  error: ApiError | Error | null;
};

export type DraftSave<T> = (
  snapshot: T,
  expectedRevision: number | null,
  signal: AbortSignal,
) => Promise<DraftSaveResult | void>;

export type DraftControllerOptions<T> = {
  contextKey: string;
  initialValue: T;
  serverRevision?: number | null;
  save: DraftSave<T>;
  debounceMs?: number;
};

type Listener = () => void;

function clone<T>(value: T): T {
  // Drafts are JSON contracts. Fall back to the original value for non-JSON test fixtures.
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function isConflict(error: unknown) {
  return error instanceof ApiError && error.code === "VERSION_CONFLICT";
}

export class DraftController<T> {
  private stateValue: DraftControllerState<T>;
  private saveFn: DraftSave<T>;
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private listeners = new Set<Listener>();
  private destroyed = false;

  constructor(options: DraftControllerOptions<T>) {
    const initial = clone(options.initialValue);
    this.stateValue = {
      contextKey: options.contextKey,
      epoch: 0,
      localRevision: 0,
      acknowledgedLocalRevision: 0,
      serverRevision: options.serverRevision ?? null,
      current: initial,
      lastAcknowledged: clone(initial),
      phase: "clean",
      error: null,
    };
    this.saveFn = options.save;
    this.debounceMs = options.debounceMs ?? 1000;
  }

  get state(): DraftControllerState<T> {
    return this.stateValue;
  }

  get dirty(): boolean {
    return this.stateValue.localRevision > this.stateValue.acknowledgedLocalRevision;
  }

  subscribe(listener: Listener): () => void {
    this.destroyed = false;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  private setState(next: Partial<DraftControllerState<T>>) {
    this.stateValue = { ...this.stateValue, ...next };
    this.notify();
  }

  setSave(save: DraftSave<T>) {
    this.saveFn = save;
  }

  hydrate(contextKey: string, value: T, serverRevision: number | null = null) {
    this.clearTimer();
    this.abortController?.abort();
    const initial = clone(value);
    this.stateValue = {
      contextKey,
      epoch: this.stateValue.epoch + 1,
      localRevision: 0,
      acknowledgedLocalRevision: 0,
      serverRevision,
      current: initial,
      lastAcknowledged: clone(initial),
      phase: "clean",
      error: null,
    };
    this.notify();
  }

  update(next: T | ((current: T) => T)) {
    const current = this.stateValue.current;
    const value = typeof next === "function" ? (next as (value: T) => T)(current) : next;
    this.setState({
      current: value,
      localRevision: this.stateValue.localRevision + 1,
      phase: ["conflict", "locked", "auth-required"].includes(this.stateValue.phase) ? this.stateValue.phase : "dirty",
    });
    this.schedule();
  }

  markLocked() {
    this.clearTimer();
    this.setState({ phase: "locked", error: null });
  }

  markAuthRequired(error?: ApiError | Error | null) {
    this.clearTimer();
    this.setState({ phase: "auth-required", error: error ?? null });
  }

  markClean(serverRevision?: number | null, savedAt?: string | null) {
    this.clearTimer();
    const revision = this.stateValue.localRevision;
    this.setState({
      acknowledgedLocalRevision: revision,
      serverRevision: serverRevision ?? this.stateValue.serverRevision,
      lastAcknowledged: clone(this.stateValue.current),
      phase: "clean",
      error: null,
    });
    return savedAt;
  }

  acceptServerRevision(serverRevision: number | null) {
    this.setState({ serverRevision, phase: this.dirty ? "dirty" : "clean", error: null });
  }

  markConflict(error: Error) {
    this.clearTimer();
    this.setState({ phase: "conflict", error });
  }

  schedule() {
    this.clearTimer();
    if (this.destroyed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    this.clearTimer();
    if (this.destroyed) return;
    if (["conflict", "locked", "auth-required"].includes(this.stateValue.phase)) return;
    if (!this.dirty) return;
    if (this.inFlight) {
      // A manual save/navigation guard called while A is in flight must wait
      // for the latest snapshot B as well.  Returning only A would let the
      // caller leave while B is still dirty.
      const currentRequest = this.inFlight;
      await currentRequest;
      if (
        this.dirty
        && this.stateValue.phase === "dirty"
      ) {
        await this.flush();
      }
      return;
    }
    const sentEpoch = this.stateValue.epoch;
    const sentLocalRevision = this.stateValue.localRevision;
    const snapshot = clone(this.stateValue.current);
    const expectedRevision = this.stateValue.serverRevision;
    this.abortController = new AbortController();
    this.setState({ phase: "saving", error: null });
    this.inFlight = (async () => {
      try {
        const result = await this.saveFn(snapshot, expectedRevision, this.abortController!.signal);
        // A response from a previous period/tab must never acknowledge the new draft.
        if (this.stateValue.epoch === sentEpoch && this.stateValue.localRevision === sentLocalRevision) {
          this.setState({
            current: (result?.value as T | undefined) ?? snapshot,
            acknowledgedLocalRevision: sentLocalRevision,
            serverRevision: result?.serverRevision ?? expectedRevision,
            lastAcknowledged: (result?.value as T | undefined) ?? snapshot,
            phase: "clean",
            error: null,
          });
        } else if (this.stateValue.epoch === sentEpoch && this.dirty) {
          this.setState({
            acknowledgedLocalRevision: sentLocalRevision,
            serverRevision: result?.serverRevision ?? expectedRevision,
            lastAcknowledged: snapshot,
            phase: "dirty",
          });
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (this.stateValue.epoch !== sentEpoch) return;
        const typedError = error instanceof Error ? error : new Error("Không thể lưu bản nháp");
        if (isConflict(error)) {
          this.setState({ phase: "conflict", error: typedError });
        } else if (error instanceof ApiError && error.code === "NETWORK_ERROR") {
          this.setState({ phase: "offline", error: typedError });
        } else if (error instanceof ApiError && (error.code === "SESSION_EXPIRED" || error.code === "SESSION_REVOKED")) {
          this.setState({ phase: "auth-required", error: typedError });
        } else if (error instanceof ApiError && ["PERIOD_LOCKED", "REPORT_LOCKED", "FORBIDDEN"].includes(error.code)) {
          this.setState({ phase: "locked", error: typedError });
        } else {
          this.setState({ phase: "error", error: typedError });
        }
      } finally {
        this.inFlight = null;
        this.abortController = null;
        if (this.dirty && ["saving", "dirty"].includes(this.stateValue.phase)) {
          this.setState({ phase: "dirty" });
          this.schedule();
        }
      }
    })();
    await this.inFlight;
    if (this.stateValue.epoch === sentEpoch && this.dirty && this.stateValue.phase === "dirty") {
      await this.flush();
    }
  }

  retry() {
    if (["conflict", "locked", "auth-required"].includes(this.stateValue.phase)) return;
    this.setState({ phase: "dirty", error: null });
    return this.flush();
  }

  discardLocalChanges() {
    this.clearTimer();
    this.abortController?.abort();
    this.setState({
      epoch: this.stateValue.epoch + 1,
      current: clone(this.stateValue.lastAcknowledged),
      localRevision: this.stateValue.acknowledgedLocalRevision,
      phase: "clean",
      error: null,
    });
  }

  destroy() {
    this.destroyed = true;
    this.stateValue = { ...this.stateValue, epoch: this.stateValue.epoch + 1 };
    this.clearTimer();
    this.abortController?.abort();
    this.listeners.clear();
  }

  private clearTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

export function useDraftController<T>(options: DraftControllerOptions<T>) {
  const controllerRef = useRef<DraftController<T> | null>(null);
  if (!controllerRef.current) controllerRef.current = new DraftController(options);
  const controller = controllerRef.current;
  const [, rerender] = useState(0);

  useEffect(() => {
    controller.setSave(options.save);
    return controller.subscribe(() => rerender((value) => value + 1));
  }, [controller, options.save]);

  useEffect(() => () => controller.destroy(), [controller]);

  useEffect(() => {
    if (controller.state.contextKey !== options.contextKey) {
      controller.hydrate(options.contextKey, options.initialValue, options.serverRevision ?? null);
    }
  }, [controller, options.contextKey, options.initialValue, options.serverRevision]);

  const update = useCallback((next: T | ((current: T) => T)) => controller.update(next), [controller]);
  const flush = useCallback(() => controller.flush(), [controller]);
  const hydrate = useCallback((contextKey: string, value: T, serverRevision: number | null = null) => {
    controller.hydrate(contextKey, value, serverRevision);
  }, [controller]);
  const retry = useCallback(() => controller.retry(), [controller]);
  const discardLocalChanges = useCallback(() => controller.discardLocalChanges(), [controller]);
  const acceptServerRevision = useCallback((serverRevision: number | null) => controller.acceptServerRevision(serverRevision), [controller]);

  return {
    ...controller.state,
    dirty: controller.dirty,
    update,
    flush,
    hydrate,
    retry,
    discardLocalChanges,
    acceptServerRevision,
    controller,
  };
}
