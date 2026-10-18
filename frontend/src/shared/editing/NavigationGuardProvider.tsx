import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";

type Guard = {
  isDirty: () => boolean;
  save?: () => void | Promise<void>;
  discard?: () => void;
};

type PendingNavigation = {
  actionLabel: string;
  guard: Guard;
  resolve: (allowed: boolean) => void;
};

type NavigationGuardContextValue = {
  registerGuard: (key: string, guard: Guard) => () => void;
  requestNavigation: (actionLabel?: string) => Promise<boolean>;
};

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);
const standaloneNavigationGuard: NavigationGuardContextValue = {
  registerGuard: () => () => undefined,
  requestNavigation: () => Promise.resolve(true),
};

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const guards = useRef(new Map<string, Guard>());
  const [pending, setPending] = useState<PendingNavigation | null>(null);
  const pendingRef = useRef<PendingNavigation | null>(null);
  const [saving, setSaving] = useState(false);

  const registerGuard = useCallback((key: string, guard: Guard) => {
    guards.current.set(key, guard);
    return () => guards.current.delete(key);
  }, []);

  const requestNavigation = useCallback((actionLabel = "chuyển trang") => {
    if (pendingRef.current) return Promise.resolve(false);
    const guard = [...guards.current.values()].find((candidate) => candidate.isDirty());
    if (!guard) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      pendingRef.current = { actionLabel, guard, resolve };
      setPending(pendingRef.current);
    });
  }, []);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if ([...guards.current.values()].some((guard) => guard.isDirty())) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const pagehideHandler = (event: PageTransitionEvent) => {
      if ([...guards.current.values()].some((guard) => guard.isDirty())) {
        // pagehide is the last reliable lifecycle signal on mobile browsers.
        // It cannot show a dialog, but keep the event cancelable for hosts that
        // support it and let the in-app guard handle normal navigation.
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    window.addEventListener("pagehide", pagehideHandler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("pagehide", pagehideHandler);
    };
  }, []);

  const settle = useCallback((allowed: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(allowed);
  }, []);

  const saveAndGo = useCallback(async () => {
    if (!pending || saving) return;
    setSaving(true);
    try {
      await pending.guard.save?.();
      settle(![...guards.current.values()].some((guard) => guard.isDirty()));
    } catch {
      // The form displays the save error; navigation stays blocked.
      settle(false);
    } finally {
      setSaving(false);
    }
  }, [pending, saving, settle]);

  return (
    <NavigationGuardContext.Provider value={{ registerGuard, requestNavigation }}>
      {children}
      {pending && (
        <UnsavedChangesDialog
          actionLabel={pending.actionLabel}
          busy={saving}
          onStay={() => settle(false)}
          onDiscard={() => { pending.guard.discard?.(); settle(true); }}
          onSaveAndGo={saveAndGo}
        />
      )}
    </NavigationGuardContext.Provider>
  );
}

export function useNavigationGuard() {
  const context = useContext(NavigationGuardContext);
  // App is also rendered directly by lightweight SSR/unit harnesses.
  return context ?? standaloneNavigationGuard;
}
