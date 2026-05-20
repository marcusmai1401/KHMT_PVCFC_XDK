export const VN_STRINGS: Record<string, string> = {
  EMPTY_CHART_DATA: "Chưa có dữ liệu biểu đồ cho kỳ này",
  UNCONFIRMED_EXCEL_BLOCKS: "Một số vùng Excel chưa xác nhận mapping",
  needs_confirmation: "Cần xác nhận",
  Target: "Mục tiêu",
  LOW: "Mức thấp",
  MEDIUM: "Mức trung bình",
  HIGH: "Mức cao",
  OBJECTIVE_SECTIONS_BUILD_FAILED: "Không dựng được dashboard theo mục tiêu",
};

export function vn(token: string): string {
  return VN_STRINGS[token] ?? token;
}
