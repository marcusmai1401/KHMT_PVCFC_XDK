import { AlertCircle, CalendarX } from "lucide-react";

export function NoPlanBlock({ message = "Không có KH trong tháng" }: { message?: string | null }) {
  return (
    <div className="objective-empty objective-empty-plan">
      <CalendarX size={18} />
      <span>{message || "Không có KH trong tháng"}</span>
    </div>
  );
}

export function NoDataBlock({ message = "Chưa có dữ liệu" }: { message?: string | null }) {
  return (
    <div className="objective-empty objective-empty-data">
      <AlertCircle size={18} />
      <span>{message || "Chưa có dữ liệu"}</span>
    </div>
  );
}
