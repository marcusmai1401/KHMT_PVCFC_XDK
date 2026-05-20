const STORAGE_KEY = "okr.last_selected_period";

export interface LastSelectedPeriod {
  month: number;
  year: number;
  savedAt: string;
}

function storage(): Storage | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  return window.localStorage;
}

function validPeriod(value: any): value is LastSelectedPeriod {
  return (
    Number.isInteger(value?.month) &&
    value.month >= 1 &&
    value.month <= 12 &&
    Number.isInteger(value?.year) &&
    value.year >= 2020 &&
    value.year <= 2100 &&
    typeof value?.savedAt === "string" &&
    !Number.isNaN(Date.parse(value.savedAt))
  );
}

export function readLastSelectedPeriod(): LastSelectedPeriod | null {
  try {
    const store = storage();
    const raw = store?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (validPeriod(parsed)) return parsed;
    store?.removeItem(STORAGE_KEY);
  } catch {
    return null;
  }
  return null;
}

export function writeLastSelectedPeriod(period: { month: number; year: number }): LastSelectedPeriod | null {
  const value = {
    month: Number(period.month),
    year: Number(period.year),
    savedAt: new Date().toISOString(),
  };
  if (!validPeriod(value)) return null;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    return null;
  }
  return value;
}
