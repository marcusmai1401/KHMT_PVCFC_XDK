import html2canvas from "html2canvas";
import { api } from "../../api/client";

const EXPORT_BACKGROUND = "#f4f6f8";
const MAX_CANVAS_SIDE = 16000;
const EXPORT_DEBUG_PREFIX = "[OKR PNG export]";

function logExportDebug(step: string, payload?: Record<string, unknown>) {
  console.debug(EXPORT_DEBUG_PREFIX, step, payload ?? {});
  void api.clientDebugLog({
    source: "okr-png-export",
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

function expandScrollableContent(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".matrix, .compact-kr-list").forEach((node) => {
    node.style.maxHeight = "none";
    node.style.maxWidth = "none";
    node.style.overflow = "visible";
    node.style.width = `${Math.max(node.clientWidth, node.scrollWidth)}px`;
  });

  root.querySelectorAll<HTMLElement>("table").forEach((table) => {
    const width = Math.max(table.clientWidth, table.scrollWidth);
    table.style.minWidth = `${width}px`;
    table.style.width = `${width}px`;
  });
}

function expandedExportWidth(element: HTMLElement) {
  const sourceRect = element.getBoundingClientRect();
  let width = Math.ceil(Math.max(sourceRect.width, element.scrollWidth, 1200));
  element.querySelectorAll<HTMLElement>(".matrix, table, .compact-kr-list").forEach((node) => {
    const rect = node.getBoundingClientRect();
    const relativeRight = rect.left - sourceRect.left + Math.max(node.clientWidth, node.scrollWidth);
    width = Math.max(width, Math.ceil(relativeRight));
  });
  return width;
}

function canvasScale(width: number, height: number) {
  const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
  const sideScale = Math.min(MAX_CANVAS_SIDE / Math.max(width, 1), MAX_CANVAS_SIDE / Math.max(height, 1));
  return Math.max(Math.min(deviceScale, sideScale), 0.25);
}

function blobFromCanvas(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Không thể tạo file PNG từ dashboard."));
      }
    }, "image/png");
  });
}

export async function exportDashboardElementAsPng(element: HTMLElement, filename: string) {
  const exportId = `okr-export-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const width = expandedExportWidth(element);
  const height = Math.ceil(Math.max(element.scrollHeight, element.getBoundingClientRect().height));
  const scale = canvasScale(width, height);

  logExportDebug("start", {
    filename,
    height,
    matrixCount: element.querySelectorAll(".matrix").length,
    scale,
    tableCount: element.querySelectorAll("table").length,
    width,
  });

  if (!width || !height) {
    throw new Error("Không tìm thấy vùng dashboard để xuất PNG.");
  }

  element.setAttribute("data-png-export-id", exportId);
  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    const canvas = await html2canvas(element, {
      allowTaint: false,
      backgroundColor: EXPORT_BACKGROUND,
      logging: true,
      scale,
      scrollX: 0,
      scrollY: -window.scrollY,
      useCORS: true,
      width,
      windowHeight: Math.max(height, document.documentElement.clientHeight),
      windowWidth: Math.max(width, document.documentElement.clientWidth),
      onclone: (clonedDocument) => {
        const clonedElement = clonedDocument.querySelector<HTMLElement>(`[data-png-export-id="${exportId}"]`);
        if (!clonedElement) return;
        clonedElement.querySelectorAll("[data-export-exclude]").forEach((node) => node.remove());
        clonedElement.style.background = EXPORT_BACKGROUND;
        clonedElement.style.maxWidth = "none";
        clonedElement.style.width = `${width}px`;
        expandScrollableContent(clonedElement);
      },
    });

    logExportDebug("canvas-ready", {
      canvasHeight: canvas.height,
      canvasWidth: canvas.width,
      cssHeight: height,
      cssWidth: width,
      scale,
    });

    const blob = await blobFromCanvas(canvas);
    logExportDebug("download", { filename, size: blob.size });
    downloadBlob(blob, filename);
  } catch (error) {
    logExportDebug("failed", {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "UnknownError",
    });
    throw error;
  } finally {
    element.removeAttribute("data-png-export-id");
  }
}
