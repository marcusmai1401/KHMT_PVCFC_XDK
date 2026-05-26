import { captureElementAsPng } from "../../utils/pngSnapshot";

export async function exportDashboardElementAsPng(element: HTMLElement, filename: string) {
  await captureElementAsPng(element, filename);
}
