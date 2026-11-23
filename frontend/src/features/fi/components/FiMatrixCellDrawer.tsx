import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Image as ImageIcon,
  Info,
  Loader2,
  Lock,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../../../api/client";
import type {
  FiDashboardCellResponse,
  FiDashboardPoolResponse,
  FiKhmtMatrixData,
  MatrixDrawerSelection,
} from "../types/fiDashboard";
import { displayTeamLabel, formatCount, krTierLabel } from "../utils/fiMetrics";
import { FiKhmtMonthPicker } from "./FiKhmtMonthPicker";

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .trim();
}

function formatDateShort(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("vi-VN");
}

function isItemCompleted(item: any): boolean {
  if (!item) return false;
  if (item.completed_at || item.status === "Completed") return true;
  const plan = String(item.completion_plan ?? "").trim();
  return /^đã\s+hoàn\s+thành/i.test(plan);
}

function regPeriodText(item: any): string {
  const history = Array.isArray(item?.status_history) ? item.status_history : [];
  const comments = history[0]?.comments ?? {};
  const month = Number(comments.registration_month);
  const year = Number(comments.registration_year);
  if (Number.isFinite(month) && month >= 1 && month <= 12) {
    return `ĐK T${month}/${Number.isFinite(year) && year > 2000 ? year : new Date(item.created_at || Date.now()).getFullYear()}`;
  }
  if (item?.created_at) {
    const dt = new Date(item.created_at);
    if (!Number.isNaN(dt.getTime())) return `ĐK T${dt.getMonth() + 1}/${dt.getFullYear()}`;
  }
  return "";
}

export function FiMatrixCellDrawer({
  selection,
  role,
  editMode,
  khmtMatrix,
  suspended = false,
  refreshNonce = 0,
  onClose,
  onOpenDetail,
  onOpenInHistory,
  onOpenReviewForTeam,
  onDataChanged,
}: {
  selection: MatrixDrawerSelection | null;
  role: string;
  editMode: boolean;
  khmtMatrix?: FiKhmtMatrixData | null;
  suspended?: boolean;
  refreshNonce?: number;
  onClose: () => void;
  onOpenDetail: (item: any) => void;
  onOpenInHistory: (filters: {
    team: string;
    khmt?: "in" | "out";
    khmtPeriod?: string;
    registrationMonth?: number;
    registrationYear?: number;
    decision?: "approved" | "pending";
  }) => void;
  onOpenReviewForTeam?: (team: string) => void;
  onDataChanged: () => void;
}) {
  const [cellData, setCellData] = useState<FiDashboardCellResponse | null>(null);
  const [poolData, setPoolData] = useState<FiDashboardPoolResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [poolQuery, setPoolQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestEpoch = useRef(0);

  const selectionKey = selection
    ? selection.kind === "cell"
      ? `cell:${selection.team}:${selection.year}:${selection.month}:${selection.mode}`
      : `pool:${selection.team}:${selection.poolKind}`
    : "";

  const loadSelection = (sel: MatrixDrawerSelection, signal?: AbortSignal) => {
    const epoch = ++requestEpoch.current;
    setLoading(true);
    setError("");
    if (sel.kind === "cell") {
      api
        .fiDashboardCell(
          { team: sel.team, year: sel.year, month: sel.month, mode: sel.mode },
          { signal },
        )
        .then((data) => {
          if (epoch !== requestEpoch.current) return;
          setCellData(data);
          setPoolData(null);
        })
        .catch((err) => {
          if (signal?.aborted || epoch !== requestEpoch.current) return;
          setError(err?.message || "Không tải được dữ liệu ô ma trận.");
        })
        .finally(() => {
          if (epoch === requestEpoch.current) setLoading(false);
        });
    } else {
      api
        .fiDashboardPool({ team: sel.team, kind: sel.poolKind }, { signal })
        .then((data) => {
          if (epoch !== requestEpoch.current) return;
          setPoolData(data);
          setCellData(null);
        })
        .catch((err) => {
          if (signal?.aborted || epoch !== requestEpoch.current) return;
          setError(err?.message || "Không tải được danh sách SK.");
        })
        .finally(() => {
          if (epoch === requestEpoch.current) setLoading(false);
        });
    }
  };

  useEffect(() => {
    setPoolQuery("");
    setNotice("");
    setError("");
    if (!selection) {
      setCellData(null);
      setPoolData(null);
      return;
    }
    const controller = new AbortController();
    loadSelection(selection, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  useEffect(() => {
    if (!selection || refreshNonce === 0) return;
    const controller = new AbortController();
    loadSelection(selection, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  useEffect(() => {
    if (!selection || suspended) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection, suspended, onClose]);

  const filteredAvailablePool = useMemo(() => {
    const source = cellData?.available_pool ?? [];
    const term = normalizeSearch(poolQuery);
    if (!term) return source;
    const tokens = term.split(/\s+/).filter(Boolean);
    return source.filter((item) => {
      const hay = normalizeSearch(`${item.sk_code} ${item.title} ${item.author_name}`);
      return tokens.every((tok) => hay.includes(tok));
    });
  }, [cellData?.available_pool, poolQuery]);

  if (!selection) return null;

  const effectiveCanEditCell = Boolean(
    cellData?.cell.can_edit_khmt && (role !== "Admin" || editMode),
  );
  const effectiveCanEditPool = Boolean(
    poolData?.can_edit_khmt && (role !== "Admin" || editMode),
  );
  const adminReadOnlyHint =
    role === "Admin"
    && !editMode
    && ((cellData?.cell.can_edit_khmt ?? false) || (poolData?.can_edit_khmt ?? false));

  const assignToCell = async (item: any, month: number, year: number) => {
    if (busyId) return;
    setBusyId(item.id);
    setError("");
    setNotice("");
    try {
      const updated = await api.assignKhmt(
        item.id,
        month,
        year,
        item.server_revision ?? item.revision ?? 0,
      );
      setNotice(`Đã đưa ${updated.sk_code || item.title} vào KHMT T${month}/${year}.`);
      loadSelection(selection);
      onDataChanged();
    } catch (err: any) {
      setError(err?.message || "Không thể ghi nhận SK vào KHMT.");
      loadSelection(selection);
      onDataChanged();
    } finally {
      setBusyId(null);
    }
  };

  const removeFromCell = async (item: any) => {
    if (busyId) return;
    setBusyId(item.id);
    setError("");
    setNotice("");
    try {
      const updated = await api.clearKhmt(item.id, item.server_revision ?? item.revision ?? 0);
      setNotice(`Đã trả ${updated.sk_code || item.title} về kho chưa gán KHMT.`);
      loadSelection(selection);
      onDataChanged();
    } catch (err: any) {
      setError(err?.message || "Không thể bỏ SK khỏi KHMT.");
      loadSelection(selection);
      onDataChanged();
    } finally {
      setBusyId(null);
    }
  };

  const titleText = selection.kind === "cell"
    ? `${displayTeamLabel(selection.team)} · ${selection.mode === "khmt" ? "KHMT" : "Đăng ký"} T${selection.month}/${selection.year}`
    : `${displayTeamLabel(selection.team)} · ${selection.poolKind === "unassigned_approved" ? "Kho SK đã duyệt chưa vào KHMT" : "SK đang chờ duyệt"}`;

  return (
    <div
      className="fi-drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="fi-drawer fi-cell-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={titleText}
      >
        <header className="fi-drawer-head">
          <div className="fi-drawer-head-title">
            <span className="fi-drawer-eyebrow">
              <CalendarDays size={14} />
              {selection.kind === "cell"
                ? (selection.mode === "khmt" ? "Chi tiết phân bổ KHMT" : "Chi tiết đăng ký theo tháng")
                : (selection.poolKind === "unassigned_approved" ? "Kho sẵn sàng gán KHMT" : "Hàng đợi chờ xét duyệt")}
            </span>
            <h2>{titleText}</h2>
          </div>
          <button type="button" className="fi-drawer-close" aria-label="Đóng" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="fi-drawer-body">
          {loading && !cellData && !poolData && (
            <p className="loading-inline" role="status">
              <Loader2 size={15} className="icon-spin" />
              Đang tải dữ liệu...
            </p>
          )}

          {error && <p className="error" role="alert">{error}</p>}
          {notice && <p className="success" role="status">{notice}</p>}

          {selection.kind === "cell" && cellData && (
            <>
              <div className="fi-cell-drawer-status-bar">
                <span className={`fi-cell-tier-badge tone-${cellData.cell.kr_tier}`}>
                  <strong>{formatCount(cellData.cell.count)} FI</strong>
                  {selection.mode === "khmt" && <span>· {krTierLabel(cellData.cell.kr_tier)}</span>}
                </span>
                {cellData.cell.is_locked && (
                  <span className="fi-cell-lock-badge">
                    <Lock size={12} />
                    Đã chốt kỳ
                  </span>
                )}
                {cellData.cell.report_assessment && (
                  <span className="fi-cell-assess-badge">
                    OKR: <strong>{cellData.cell.report_assessment}</strong>
                    {cellData.cell.required_count !== null && ` (định mức ${cellData.cell.required_count})`}
                  </span>
                )}
              </div>

              {selection.mode === "khmt" && (cellData.cell.quota_status === "shortage" || cellData.cell.quota_status === "excess") && (
                <div className="fi-drawer-alert tone-warning" role="note">
                  <AlertTriangle size={15} />
                  <span>
                    {cellData.cell.quota_status === "shortage" && cellData.cell.required_count !== null
                      ? `Đang thiếu ${cellData.cell.required_count - cellData.cell.count} FI so với định mức "${cellData.cell.report_assessment}" (${cellData.cell.required_count} FI).`
                      : cellData.cell.required_count !== null
                        ? `Đang gán ${cellData.cell.count} FI, vượt định mức "${cellData.cell.report_assessment}" (${cellData.cell.required_count} FI). Hệ thống vẫn cho phép lưu nhưng gắn dấu cảnh báo ! trên bảng.`
                        : `Đang gán ${cellData.cell.count} FI (vượt định mức tối đa 3 FI/tháng). Hệ thống vẫn cho phép lưu nhưng gắn dấu cảnh báo ! trên bảng.`}
                  </span>
                </div>
              )}

              {selection.mode === "khmt" && cellData.cell.is_locked && (
                <div className="fi-drawer-alert tone-neutral" role="note">
                  <Lock size={15} />
                  <span>
                    Kỳ T{selection.month}/{selection.year} đã chốt
                    {cellData.cell.lock_reason ? ` (${cellData.cell.lock_reason})` : ""}.
                    Cần Quản trị mở chốt tại <strong>Quản trị → Chốt KHMT &amp; FI</strong> để điều chỉnh.
                  </span>
                </div>
              )}

              {selection.mode === "khmt" && adminReadOnlyHint && (
                <div className="fi-drawer-alert tone-info" role="note">
                  <Info size={15} />
                  <span>Bật chế độ <strong>“Chỉnh sửa”</strong> ở góc trên để thêm hoặc bỏ SK trực tiếp tại đây.</span>
                </div>
              )}

              <section className="fi-drawer-section">
                <div className="fi-drawer-section-head">
                  <h3>
                    {selection.mode === "khmt"
                      ? `SK đang xét vào KHMT T${selection.month}/${selection.year}`
                      : `SK đăng ký trong T${selection.month}/${selection.year}`}
                  </h3>
                  <span className="fi-drawer-count">{cellData.items.length}</span>
                </div>

                {cellData.items.length === 0 ? (
                  <div className="fi-drawer-empty">
                    <p>
                      {selection.mode === "khmt"
                        ? `Chưa có SK-CTKT nào được ghi nhận vào KHMT T${selection.month}/${selection.year}.`
                        : `Chưa có SK-CTKT nào đăng ký trong T${selection.month}/${selection.year}.`}
                    </p>
                    {selection.mode === "khmt" && (
                      <small>Định mức O5.KR13: ≥ 1 FI đạt Hoàn thành · ≥ 3 FI đạt Hoàn thành tốt / Xuất sắc.</small>
                    )}
                  </div>
                ) : (
                  <div className="fi-drawer-list">
                    {cellData.items.map((item) => (
                      <article className="fi-drawer-item" key={item.id}>
                        <div className="fi-drawer-item-top">
                          <span className="fi-drawer-code">{item.sk_code}</span>
                          <span className="fi-drawer-item-meta">
                            {regPeriodText(item)}
                            {item.image_count > 0 && (
                              <>
                                {" · "}
                                <ImageIcon size={12} /> {item.image_count}
                              </>
                            )}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="fi-drawer-item-title"
                          onClick={() => onOpenDetail(item)}
                        >
                          {item.title}
                        </button>
                        <div className="fi-drawer-item-sub">
                          <span>Tác giả: <strong>{item.author_name}</strong></span>
                          {isItemCompleted(item) ? (
                            <span className="fi-drawer-pill tone-done">
                              <CheckCircle2 size={12} /> Đã hoàn thành
                            </span>
                          ) : (
                            <span className="fi-drawer-pill tone-planned">
                              <Clock3 size={12} /> Đang thực hiện
                            </span>
                          )}
                        </div>
                        <div className="fi-drawer-item-actions">
                          <button
                            type="button"
                            className="fi-drawer-link-btn"
                            onClick={() => onOpenDetail(item)}
                          >
                            Xem chi tiết
                          </button>
                          {selection.mode === "khmt" && effectiveCanEditCell && (
                            <>
                              <FiKhmtMonthPicker
                                item={item}
                                khmtMatrix={khmtMatrix}
                                busy={busyId !== null}
                                triggerLabel="Chuyển tháng"
                                onAssign={(rec, m, y) => assignToCell(rec, m, y)}
                                onClear={(rec) => removeFromCell(rec)}
                              />
                              <button
                                type="button"
                                className="fi-drawer-danger-btn"
                                disabled={busyId !== null}
                                onClick={() => void removeFromCell(item)}
                              >
                                <Trash2 size={13} />
                                {busyId === item.id ? "Đang bỏ..." : `Bỏ khỏi T${selection.month}`}
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              {selection.mode === "khmt" && (
                <section className="fi-drawer-section fi-drawer-pool-section">
                  <div className="fi-drawer-section-head">
                    <h3>Kho SK đã duyệt chưa vào KHMT ({displayTeamLabel(selection.team)})</h3>
                    <span className="fi-drawer-count">{cellData.available_pool.length}</span>
                  </div>

                  {cellData.available_pool.length > 0 ? (
                    <>
                      <label className="fi-drawer-search">
                        <Search size={14} aria-hidden="true" />
                        <input
                          type="search"
                          placeholder="Tìm nhanh trong kho (mã SK, tiêu đề, tác giả)..."
                          value={poolQuery}
                          onChange={(event) => setPoolQuery(event.target.value)}
                        />
                      </label>
                      <div className="fi-drawer-list">
                        {filteredAvailablePool.map((item) => (
                          <article className="fi-drawer-item is-pool-item" key={item.id}>
                            <div className="fi-drawer-item-top">
                              <span className="fi-drawer-code">{item.sk_code}</span>
                              <span className="fi-drawer-item-meta">
                                {item.approved_at ? `Duyệt ${formatDateShort(item.approved_at)}` : regPeriodText(item)}
                              </span>
                            </div>
                            <button
                              type="button"
                              className="fi-drawer-item-title"
                              onClick={() => onOpenDetail(item)}
                            >
                              {item.title}
                            </button>
                            <div className="fi-drawer-item-sub">
                              <span>Tác giả: <strong>{item.author_name}</strong></span>
                            </div>
                            <div className="fi-drawer-item-actions">
                              <button
                                type="button"
                                className="fi-drawer-link-btn"
                                onClick={() => onOpenDetail(item)}
                              >
                                Xem chi tiết
                              </button>
                              {effectiveCanEditCell && (
                                <button
                                  type="button"
                                  className="fi-drawer-primary-btn"
                                  disabled={busyId === item.id}
                                  onClick={() => void assignToCell(item, selection.month, selection.year)}
                                >
                                  <Plus size={14} />
                                  {busyId === item.id ? "Đang thêm..." : `Đưa vào T${selection.month}/${selection.year}`}
                                </button>
                              )}
                            </div>
                          </article>
                        ))}
                        {filteredAvailablePool.length === 0 && (
                          <p className="muted">Không có SK nào trong kho khớp “{poolQuery}”.</p>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="fi-drawer-empty compact">
                      <p>Đội {displayTeamLabel(selection.team)} hiện không còn SK đã duyệt nào trong kho dự phòng.</p>
                    </div>
                  )}

                  {cellData.cell.pending_count_for_team > 0 && (
                    <div className="fi-drawer-pending-nudge">
                      <span>
                        Đội <strong>{displayTeamLabel(selection.team)}</strong> đang có{" "}
                        <strong>{cellData.cell.pending_count_for_team} SK chờ xét duyệt</strong>.
                      </span>
                      {onOpenReviewForTeam ? (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => {
                            onClose();
                            onOpenReviewForTeam(selection.team);
                          }}
                        >
                          Mở hàng đợi duyệt <ArrowRight size={13} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => {
                            onClose();
                            onOpenInHistory({ team: selection.team, decision: "pending" });
                          }}
                        >
                          Xem danh sách chờ <ArrowRight size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </section>
              )}
            </>
          )}

          {selection.kind === "pool" && poolData && (
            <>
              {adminReadOnlyHint && selection.poolKind === "unassigned_approved" && (
                <div className="fi-drawer-alert tone-info" role="note">
                  <Info size={15} />
                  <span>Bật chế độ <strong>“Chỉnh sửa”</strong> ở góc trên để chọn tháng KHMT trực tiếp.</span>
                </div>
              )}
              <section className="fi-drawer-section">
                <div className="fi-drawer-section-head">
                  <h3>
                    {selection.poolKind === "unassigned_approved"
                      ? `SK đã duyệt chưa vào KHMT (${poolData.total})`
                      : `SK đang chờ xét duyệt (${poolData.total})`}
                  </h3>
                </div>
                {poolData.items.length === 0 ? (
                  <div className="fi-drawer-empty">
                    <p>
                      {selection.poolKind === "unassigned_approved"
                        ? "Không còn SK đã duyệt nào chưa đưa vào KHMT."
                        : "Không có SK nào đang chờ xét duyệt."}
                    </p>
                  </div>
                ) : (
                  <div className="fi-drawer-list">
                    {poolData.items.map((item) => (
                      <article className="fi-drawer-item" key={item.id}>
                        <div className="fi-drawer-item-top">
                          <span className="fi-drawer-code">{item.sk_code}</span>
                          <span className="fi-drawer-item-meta">
                            {regPeriodText(item)}
                            {item.approved_at ? ` · Duyệt ${formatDateShort(item.approved_at)}` : ""}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="fi-drawer-item-title"
                          onClick={() => onOpenDetail(item)}
                        >
                          {item.title}
                        </button>
                        <div className="fi-drawer-item-sub">
                          <span>Tác giả: <strong>{item.author_name}</strong></span>
                        </div>
                        <div className="fi-drawer-item-actions">
                          <button
                            type="button"
                            className="fi-drawer-link-btn"
                            onClick={() => onOpenDetail(item)}
                          >
                            Xem chi tiết
                          </button>
                          {selection.poolKind === "unassigned_approved" && effectiveCanEditPool && (
                            <FiKhmtMonthPicker
                              item={item}
                              khmtMatrix={khmtMatrix}
                              busy={busyId === item.id}
                              onAssign={(rec, m, y) => assignToCell(rec, m, y)}
                              onClear={(rec) => removeFromCell(rec)}
                            />
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="fi-drawer-foot">
          {selection.kind === "cell" ? (
            <button
              type="button"
              className="fi-drawer-foot-btn"
              onClick={() => {
                onClose();
                if (selection.mode === "khmt") {
                  onOpenInHistory({
                    team: selection.team,
                    khmt: "in",
                    khmtPeriod: `${selection.year}-${selection.month}`,
                  });
                } else {
                  onOpenInHistory({
                    team: selection.team,
                    registrationMonth: selection.month,
                    registrationYear: selection.year,
                  });
                }
              }}
            >
              <ExternalLink size={14} />
              Mở trong Lịch sử FI
            </button>
          ) : (
            <button
              type="button"
              className="fi-drawer-foot-btn"
              onClick={() => {
                onClose();
                if (selection.poolKind === "pending" && onOpenReviewForTeam) {
                  onOpenReviewForTeam(selection.team);
                } else {
                  onOpenInHistory({
                    team: selection.team,
                    decision: selection.poolKind === "pending" ? "pending" : "approved",
                    khmt: selection.poolKind === "unassigned_approved" ? "out" : undefined,
                  });
                }
              }}
            >
              <ExternalLink size={14} />
              {selection.poolKind === "pending" && onOpenReviewForTeam
                ? "Mở trong Xét duyệt SK-CTKT"
                : "Mở trong Lịch sử FI"}
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}
