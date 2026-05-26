import html2canvas from "html2canvas";
import { api } from "../api/client";

const EXPORT_BACKGROUND = "#f4f6f8";
const MAX_CANVAS_SIDE = 16000;
const EXPORT_DEBUG_PREFIX = "[PNG snapshot]";
const IMAGE_WAIT_TIMEOUT_MS = 2500;
const SNAPSHOT_TARGET_SELECTOR = "[data-snapshot-target='true']";
const SNAPSHOT_FALLBACK_SELECTOR = "[data-snapshot-fallback='true']";

function logDebug(step: string, payload?: Record<string, unknown>) {
  console.debug(EXPORT_DEBUG_PREFIX, step, payload ?? {});
  void api.clientDebugLog({
    source: "png-snapshot",
    event: step,
    data: payload ?? {},
  }).catch(() => undefined);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function canvasScale(width: number, height: number) {
  const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
  const sideScale = Math.min(
    MAX_CANVAS_SIDE / Math.max(width, 1),
    MAX_CANVAS_SIDE / Math.max(height, 1),
  );
  return Math.max(Math.min(deviceScale, sideScale), 0.25);
}

function blobFromCanvas(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Không thể tạo file PNG từ vùng này."));
    }, "image/png");
  });
}

function captureBox(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const width = Math.ceil(Math.max(rect.width, element.clientWidth));
  const height = Math.ceil(Math.max(rect.height, element.scrollHeight));
  return { height, width };
}

async function waitForImages(element: HTMLElement) {
  const images = Array.from(element.querySelectorAll("img"));
  await Promise.all(
    images.map((image) => {
      if (image.complete && image.naturalWidth > 0) return Promise.resolve();
      let imagePromise: Promise<unknown>;
      if (typeof image.decode === "function") {
        imagePromise = image.decode().catch(() => undefined);
      } else {
        imagePromise = new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
      }
      return Promise.race([
        imagePromise,
        new Promise<void>((resolve) => window.setTimeout(resolve, IMAGE_WAIT_TIMEOUT_MS)),
      ]);
    }),
  );
}

function injectSnapshotCss(clonedDocument: Document, exportId: string) {
  const style = clonedDocument.createElement("style");
  style.textContent = `
    [data-png-export-id="${exportId}"],
    [data-png-export-id="${exportId}"] * {
      animation: none !important;
      caret-color: transparent !important;
      transition: none !important;
    }
    [data-png-export-id="${exportId}"] [data-export-exclude] {
      visibility: hidden !important;
    }
    [data-png-export-id="${exportId}"] th,
    [data-png-export-id="${exportId}"] .fi-workspace-tabs {
      position: static !important;
      top: auto !important;
    }
  `;
  clonedDocument.head.appendChild(style);
}

export async function captureElementAsPng(element: HTMLElement, filename: string) {
  const exportId = `png-snapshot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const { height, width } = captureBox(element);
  const scale = canvasScale(width, height);

  logDebug("start", {
    filename,
    height,
    scale,
    width,
  });

  if (!width || !height) {
    throw new Error("Không tìm thấy vùng nội dung để xuất PNG.");
  }

  element.setAttribute("data-png-export-id", exportId);
  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
    await waitForImages(element);

    const canvas = await html2canvas(element, {
      allowTaint: false,
      backgroundColor: EXPORT_BACKGROUND,
      logging: false,
      scale,
      scrollX: -window.scrollX,
      scrollY: -window.scrollY,
      useCORS: true,
      width,
      windowHeight: Math.max(height, document.documentElement.clientHeight),
      windowWidth: document.documentElement.clientWidth,
      onclone: (clonedDocument) => {
        injectSnapshotCss(clonedDocument, exportId);
        const clonedElement = clonedDocument.querySelector<HTMLElement>(
          `[data-png-export-id="${exportId}"]`,
        );
        if (!clonedElement) return;
        clonedElement.style.background = EXPORT_BACKGROUND;
        clonedElement.style.width = `${width}px`;
        clonedElement.style.minWidth = `${width}px`;
      },
    });

    logDebug("canvas-ready", {
      canvasHeight: canvas.height,
      canvasWidth: canvas.width,
      cssHeight: height,
      cssWidth: width,
      scale,
    });

    const blob = await blobFromCanvas(canvas);
    logDebug("download", { filename, size: blob.size });
    downloadBlob(blob, filename);
  } catch (error) {
    logDebug("failed", {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "UnknownError",
    });
    throw error;
  } finally {
    element.removeAttribute("data-png-export-id");
  }
}

function isVisible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function firstVisibleTarget(selector: string) {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(isVisible) ?? null;
}

// Resolve the currently visible snapshot target. Modules can expose a specific
// target; the App-level fallback keeps future tabs exportable even before they
// add a dedicated sub-tab wrapper.
export function findActiveSnapshotTarget(): {
  element: HTMLElement;
  name: string;
} | null {
  const node = firstVisibleTarget(SNAPSHOT_TARGET_SELECTOR)
    ?? firstVisibleTarget(SNAPSHOT_FALLBACK_SELECTOR);
  if (!node) return null;
  const name = node.getAttribute("data-snapshot-name") || "snapshot";
  return { element: node, name };
}

function todayStamp() {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export function snapshotFilename(name: string) {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "snapshot";
  return `${slug}-${todayStamp()}.png`;
}
