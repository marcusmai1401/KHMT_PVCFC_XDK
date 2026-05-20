import type { ObjectiveStatus } from "../types/dashboard";

const labels: Record<ObjectiveStatus, string> = {
  completed: "Hoàn thành",
  at_risk: "Có rủi ro",
  failed: "Không đạt",
  no_plan: "Không có KH",
  no_data: "Chưa có dữ liệu",
};

export function ObjectiveStatusBadge({ status = "no_data" }: { status?: ObjectiveStatus }) {
  const safeStatus = labels[status] ? status : "no_data";
  return <span className={`objective-status objective-status-${safeStatus}`}>{labels[safeStatus]}</span>;
}
