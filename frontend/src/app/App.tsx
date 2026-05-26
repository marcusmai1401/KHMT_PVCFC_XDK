import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bell,
  ClipboardCheck,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FlaskConical,
  History,
  ImageDown,
  KeyRound,
  Lightbulb,
  LogIn,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import { api, decodeToken, setToken, type LoginResponse } from "../api/client";
import { AdminPanel } from "../features/admin/AdminPanel";
import { ChangePasswordForm } from "../features/auth/ChangePasswordForm";
import { ETModule } from "../features/et/ETModule";
import { FIWorkspace } from "../features/fi/FIWorkspace";
import { OKRModule } from "../features/okr/OKRModule";
import { captureElementAsPng, findActiveSnapshotTarget, snapshotFilename } from "../utils/pngSnapshot";

type Tab = "okr" | "et" | "fi" | "admin";

const tabTitles: Record<Tab, string> = {
  okr: "OKR",
  et: "Năng lực ET",
  fi: "Luồng SK-CTKT",
  admin: "Quản trị hệ thống",
};

const tabSnapshotNames: Record<Tab, string> = {
  okr: "okr",
  et: "nang-luc-et",
  fi: "fi",
  admin: "quan-tri",
};

const roleLabels: Record<string, string> = {
  Admin: "Quản trị",
  Workshop_Leader: "Lãnh đạo Xưởng",
  FI_Coordinator: "Đầu mối FI",
  Team_Account: "Tài khoản đội/tổ",
  Staff: "Nhân viên",
};

const notificationLabels: Record<string, string> = {
  SK_SUBMITTED: "FI đã gửi duyệt",
  SK_NEED_MORE_INFO: "FI cần bổ sung",
  SK_REVIEWED: "FI đã được xem xét",
  SK_APPROVED: "FI đã phê duyệt",
  SK_REJECTED: "FI bị từ chối",
  SK_DEFERRED: "FI xem xét sau",
  SK_CANCELLED: "FI đã hủy",
  SK_COMPLETED: "FI đã hoàn tất",
  SK_STATUS_CHANGED: "FI đổi trạng thái",
  SK_CONTENT_EDITED: "Tác giả đã chỉnh sửa SK — cần xét duyệt lại",
  OKR_TEAM_SUBMITTED: "Đội/Tổ đã nộp OKR",
};

const ROLE_ORDER = ["Admin", "Workshop_Leader", "FI_Coordinator", "Team_Account", "Staff"];

const SIDEBAR_COLLAPSED_KEY = "okr.sidebar.collapsed";
const REAL_TOKEN_KEY = "okr.real.token";
const REMEMBER_FLAG_KEY = "okr.remember.enabled";
const REMEMBERED_USER_KEY = "okr.remember.user";
const PERSISTED_TOKEN_KEY = "okr.session.token";

type SandboxIdentity = {
  id: string;
  display_name: string;
  role: string;
  team: string | null;
};

function displayRole(value: string) {
  return roleLabels[value] ?? value;
}

function displayNotification(value: string) {
  return notificationLabels[value] ?? value;
}

function friendlyError(message: string) {
  if (message.includes("Invalid credentials")) return "Sai tài khoản hoặc mật khẩu.";
  if (message.includes("Not authenticated") || message.includes("Invalid token")) return "Phiên đăng nhập không hợp lệ.";
  if (message.includes("Insufficient role") || message.includes("Not allowed")) return "Tài khoản không có quyền thực hiện thao tác này.";
  return message;
}

function canAccessTab(role: string, candidate: Tab) {
  if (candidate === "admin") return role === "Admin";
  if (candidate === "et") return ["Admin", "Workshop_Leader", "FI_Coordinator", "Team_Account", "Staff"].includes(role);
  return true;
}

export function App() {
  const [tab, setTab] = useState<Tab>("okr");
  const [role, setRole] = useState("");
  const [userId, setUserId] = useState(() => {
    if (typeof window !== "undefined") {
      return window.localStorage.getItem(REMEMBERED_USER_KEY) ?? "";
    }
    return "";
  });
  const [rememberMe, setRememberMe] = useState(() => {
    if (typeof window !== "undefined") {
      return window.localStorage.getItem(REMEMBER_FLAG_KEY) === "true";
    }
    return false;
  });
  const [restoringSession, setRestoringSession] = useState(() => {
    if (typeof window === "undefined") return false;
    return Boolean(window.localStorage.getItem(PERSISTED_TOKEN_KEY));
  });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentDisplayName, setCurrentDisplayName] = useState<string | null>(null);
  const [currentTeam, setCurrentTeam] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [voluntaryChange, setVoluntaryChange] = useState(false);
  const [sandbox, setSandbox] = useState(false);
  const [hasRealSession, setHasRealSession] = useState(false);
  const [sandboxIdentities, setSandboxIdentities] = useState<SandboxIdentity[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resettingSandbox, setResettingSandbox] = useState(false);
  const [exportingPng, setExportingPng] = useState(false);
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });

  const applySession = (response: LoginResponse, fallbackUserId: string) => {
    setToken(response.access_token);
    const payload = decodeToken(response.access_token);
    setRole(response.role ?? payload.role ?? "");
    setCurrentUserId(payload.sub ?? fallbackUserId);
    setCurrentDisplayName(response.display_name ?? null);
    setCurrentTeam(response.team ?? payload.team ?? null);
    setMustChangePassword(Boolean(response.must_change_password));
    setSandbox(Boolean(payload.sandbox));
    setVoluntaryChange(false);
    setError("");
    if (typeof window !== "undefined" && response.access_token && !payload.sandbox) {
      const shouldPersist = window.localStorage.getItem(REMEMBER_FLAG_KEY) === "true";
      if (shouldPersist) {
        window.localStorage.setItem(PERSISTED_TOKEN_KEY, response.access_token);
      }
    }
  };

  const logout = () => {
    setToken("");
    setRole("");
    setCurrentUserId("");
    setCurrentDisplayName(null);
    setCurrentTeam(null);
    setMustChangePassword(false);
    setVoluntaryChange(false);
    setSandbox(false);
    setHasRealSession(false);
    setNotifications([]);
    setSandboxIdentities([]);
    if (typeof window !== "undefined") {
      const stillRemember = window.localStorage.getItem(REMEMBER_FLAG_KEY) === "true";
      setUserId(stillRemember ? (window.localStorage.getItem(REMEMBERED_USER_KEY) ?? "") : "");
      window.localStorage.removeItem(PERSISTED_TOKEN_KEY);
      window.sessionStorage.removeItem(REAL_TOKEN_KEY);
    } else {
      setUserId("");
    }
    setPassword("");
    setError("");
    setNotice("");
  };

  const login = (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    if (submitting || !userId.trim() || !password) return;
    setNotice("");
    setSubmitting(true);

    if (typeof window !== "undefined") {
      if (rememberMe) {
        window.localStorage.setItem(REMEMBERED_USER_KEY, userId.trim());
        window.localStorage.setItem(REMEMBER_FLAG_KEY, "true");
      } else {
        window.localStorage.removeItem(REMEMBERED_USER_KEY);
        window.localStorage.removeItem(REMEMBER_FLAG_KEY);
        window.localStorage.removeItem(PERSISTED_TOKEN_KEY);
      }
    }

    api.login(userId.trim(), password)
      .then((response) => {
        applySession(response, userId.trim());
        setPassword("");
      })
      .catch((err) => setError(friendlyError(err.message)))
      .finally(() => setSubmitting(false));
  };

  const enterSandbox = () => {
    if (typeof window !== "undefined") {
      // Lưu token thật để có thể quay về (cookie/state — đơn giản dùng sessionStorage).
      // Token thật vẫn được giữ trong api/client `token` module-level — lấy ra qua document/check.
    }
    api.sandboxEnter()
      .then((response) => {
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(REAL_TOKEN_KEY, JSON.stringify({
            access_token: "", // sẽ re-login bằng UI nếu muốn quay về
            display_name: currentDisplayName,
            role,
            team: currentTeam,
            user_id: currentUserId,
          }));
        }
        setHasRealSession(true);
        applySession(response, response.role ?? "admin");
        setNotice("Đã vào môi trường kiểm thử với vai trò Quản trị.");
      })
      .catch((err) => setError(friendlyError(err.message)));
  };

  const exitSandbox = () => {
    // Đơn giản: logout sandbox + yêu cầu admin login lại để trở về production session.
    if (!confirm("Thoát môi trường kiểm thử và đăng xuất? Bạn sẽ cần đăng nhập lại bằng tài khoản admin để trở về production.")) return;
    logout();
  };

  const switchSandboxRole = (nextUserId: string) => {
    if (!nextUserId) return;
    api.sandboxSwitchRole(nextUserId)
      .then((response) => {
        applySession(response, nextUserId);
        loadNotifications();
      })
      .catch((err) => setError(friendlyError(err.message)));
  };

  const resetSandbox = () => {
    if (resettingSandbox) return;
    if (!confirm("Reset toàn bộ dữ liệu kiểm thử? Database production sẽ không bị ảnh hưởng.")) return;
    setResettingSandbox(true);
    setError("");
    setNotice("");
    api.sandboxReset()
      .then(() => {
        setNotice("Đã reset dữ liệu kiểm thử.");
        setWorkspaceVersion((value) => value + 1);
        loadNotifications();
        loadSandboxIdentities();
      })
      .catch((err) => setError(friendlyError(err.message)))
      .finally(() => setResettingSandbox(false));
  };

  const loadNotifications = () => {
    api.notifications().then(setNotifications).catch((err) => setError(friendlyError(err.message)));
  };

  const loadSandboxIdentities = () => {
    api.sandboxIdentities()
      .then(setSandboxIdentities)
      .catch(() => {});
  };

  const markRead = (id: string) => {
    api.markNotificationRead(id).then(loadNotifications).catch((err) => setError(friendlyError(err.message)));
  };

  const handleSnapshot = () => {
    if (exportingPng) return;
    const target = findActiveSnapshotTarget();
    if (!target) {
      setError("Không tìm thấy vùng nội dung để xuất PNG ở tab hiện tại.");
      return;
    }
    setError("");
    setExportingPng(true);
    captureElementAsPng(target.element, snapshotFilename(target.name))
      .catch((err) => setError(friendlyError(err.message ?? "Không thể xuất PNG.")))
      .finally(() => setExportingPng(false));
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedToken = window.localStorage.getItem(PERSISTED_TOKEN_KEY);
    if (!savedToken) {
      setRestoringSession(false);
      return;
    }
    setToken(savedToken);
    api.me()
      .then((profile) => {
        const fallback = window.localStorage.getItem(REMEMBERED_USER_KEY) ?? profile.user_id;
        applySession(
          {
            access_token: savedToken,
            display_name: profile.display_name,
            role: profile.role,
            team: profile.team,
            must_change_password: profile.must_change_password,
          },
          fallback,
        );
      })
      .catch(() => {
        setToken("");
        window.localStorage.removeItem(PERSISTED_TOKEN_KEY);
      })
      .finally(() => setRestoringSession(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (role) loadNotifications();
  }, [role]);

  useEffect(() => {
    if (sandbox) loadSandboxIdentities();
    else setSandboxIdentities([]);
  }, [sandbox]);

  useEffect(() => {
    if (role && !canAccessTab(role, tab)) setTab("okr");
  }, [role, tab]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    }
  }, [sidebarCollapsed]);

  const groupedIdentities = useMemo(() => {
    const groups: Record<string, SandboxIdentity[]> = {};
    sandboxIdentities.forEach((identity) => {
      const key = identity.role;
      if (!groups[key]) groups[key] = [];
      groups[key].push(identity);
    });
    Object.values(groups).forEach((items) =>
      items.sort((a, b) => a.display_name.localeCompare(b.display_name, "vi"))
    );
    return ROLE_ORDER.filter((r) => groups[r]?.length).map((r) => ({ role: r, items: groups[r] }));
  }, [sandboxIdentities]);

  if (restoringSession) {
    return (
      <main className="auth-shell" aria-busy="true">
        <div className="auth-bg" aria-hidden="true">
          <div className="auth-bg-orb auth-bg-orb-a" />
          <div className="auth-bg-orb auth-bg-orb-b" />
          <div className="auth-bg-grid" />
        </div>
        <div className="auth-boot">
          <div className="auth-boot-mark">
            <img src="/logo.webp" alt="PVCFC" />
          </div>
          <div className="auth-boot-spinner" aria-hidden="true" />
          <p>Đang khôi phục phiên đăng nhập…</p>
        </div>
      </main>
    );
  }

  if (role && (mustChangePassword || voluntaryChange)) {
    return (
      <ChangePasswordForm
        forced={mustChangePassword && !voluntaryChange}
        displayName={currentDisplayName}
        userId={currentUserId}
        onChanged={(response) => {
          applySession(response, currentUserId);
          setNotice("Đã đổi mật khẩu thành công.");
        }}
        onCancel={voluntaryChange ? () => setVoluntaryChange(false) : undefined}
      />
    );
  }

  if (!role) {
    return (
      <main className="auth-shell">
        <div className="auth-bg" aria-hidden="true">
          <div className="auth-bg-orb auth-bg-orb-a" />
          <div className="auth-bg-orb auth-bg-orb-b" />
          <div className="auth-bg-grid" />
          <div className="auth-bg-noise" />
        </div>
        <div className="auth-content">
          <div className="auth-hero">
            <div className="auth-hero-brand">
              <div className="auth-hero-logo">
                <img src="/logo.webp" alt="PVCFC" />
              </div>
              <div className="auth-hero-name">
                <strong>Tổng Công Ty Phân Bón Dầu Khí Cà Mau</strong>
                <span className="auth-hero-factory">Nhà máy Đạm Cà Mau</span>
                <span className="auth-hero-tagline">Xưởng Điều khiển</span>
              </div>
            </div>

            <p className="auth-hero-lede">
              Chung một niềm tin - Vươn mình phát triển
            </p>

            <ul className="auth-hero-features">
              <li>
                <span className="auth-hero-feature-ico"><BarChart3 size={18} /></span>
                <div>
                  <strong>OKR theo tháng</strong>
                  <small>Theo dõi tiến độ, cảnh báo lệch chỉ tiêu, tổng hợp tự động.</small>
                </div>
              </li>
              <li>
                <span className="auth-hero-feature-ico"><Lightbulb size={18} /></span>
                <div>
                  <strong>Sáng kiến – CTKT</strong>
                  <small>Đăng ký, xét duyệt và lưu vết toàn bộ vòng đời cải tiến.</small>
                </div>
              </li>
              <li>
                <span className="auth-hero-feature-ico"><ClipboardCheck size={18} /></span>
                <div>
                  <strong>Năng lực ET</strong>
                  <small>Khung năng lực, đánh giá định kỳ và lộ trình học tập cá nhân hoá.</small>
                </div>
              </li>
            </ul>

            <div className="auth-hero-foot">
              <div className="auth-hero-copyright">
                © {new Date().getFullYear()} PVCFC · Đội ngũ Xưởng Điều khiển
              </div>
              <div className="auth-credits">
                <ShieldCheck size={12} className="auth-credits-icon" />
                Sản phẩm được phát triển bởi Mai Thái Bảo &amp; Lâm Phùng Phước Vinh
              </div>
              <p className="auth-external-notice">
                Anh/ chị thuộc các đơn vị khác, có nhu cầu tham khảo website thì liên hệ qua email <a href="mailto:baomt@pvcfc.com.vn" className="auth-notice-link">baomt@pvcfc.com.vn</a> hoặc Zalo: <a href="https://zalo.me/0945569945" target="_blank" rel="noopener noreferrer" className="auth-notice-link">0945569945</a> để được cấp quyền truy cập.
              </p>
            </div>
          </div>

          <form className="auth-card" onSubmit={login} autoComplete="on" noValidate>
            <div className="auth-card-glow" aria-hidden="true" />
            <header className="auth-card-head">
              <span className="auth-card-eyebrow">
                <ShieldCheck size={12} />
                Hệ thống nội bộ
              </span>
              <h1>Đăng nhập</h1>
            </header>

            <div className="auth-card-body">
              <label className="auth-field">
                <span>Tài khoản</span>
                <div className="auth-input">
                  <LogIn size={16} className="auth-input-icon" />
                  <input
                    autoComplete="username"
                    placeholder="ví dụ: baomt"
                    value={userId}
                    onChange={(event) => setUserId(event.target.value)}
                  />
                </div>
              </label>

              <label className="auth-field">
                <span>Mật khẩu</span>
                <div className="auth-input">
                  <KeyRound size={16} className="auth-input-icon" />
                  <input
                    autoComplete="current-password"
                    placeholder="Nhập mật khẩu"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="auth-input-toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    title={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>

              <div className="auth-options">
                <label className="auth-remember">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                  />
                  <span className="auth-remember-custom" aria-hidden="true"></span>
                  <span className="auth-remember-label">Duy trì đăng nhập trên thiết bị này</span>
                </label>
              </div>

              <button className="auth-submit" type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <span className="auth-submit-spinner" aria-hidden="true" />
                    Đang xác thực…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} />
                    Đăng nhập
                  </>
                )}
              </button>

              {error && (
                <p className="auth-error" role="alert">
                  <span className="auth-error-dot" aria-hidden="true" />
                  {error}
                </p>
              )}
              {notice && (
                <p className="auth-success" role="status">
                  <ShieldCheck size={14} />
                  {notice}
                </p>
              )}
            </div>

            <footer className="auth-card-foot">
              <p className="auth-help">
                Quên mật khẩu? Vui lòng liên hệ Zalo:{" "}
                <a href="https://zalo.me/0945569945" target="_blank" rel="noopener noreferrer" className="auth-help-link">
                  0945569945
                </a>
              </p>
            </footer>
          </form>
        </div>
      </main>
    );
  }

  const isAdminProd = role === "Admin" && !sandbox;

  return (
    <main className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">
            <img src="/logo.webp" alt="PVCFC Logo" className="brand-logo" />
            <div>
              <strong>OKR Automation</strong>
              <span>Xưởng Điều khiển</span>
            </div>
          </div>
          <button
            aria-label={sidebarCollapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((value) => !value)}
            title={sidebarCollapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
            type="button"
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <div className="field">
          <span>Tài khoản</span>
          <strong>{currentDisplayName ?? currentUserId}</strong>
          <small>
            {sandbox
              ? `Kiểm thử · ${displayRole(role)}${currentTeam ? ` · ${currentTeam}` : ""}`
              : `${displayRole(role)}${currentTeam ? ` · ${currentTeam}` : ""}`}
          </small>
          <div className="account-actions">
            {!sandbox && (
              <button
                className="account-action"
                onClick={() => setVoluntaryChange(true)}
                title="Đổi mật khẩu"
                type="button"
              >
                <KeyRound size={14} />
                <span>Đổi mật khẩu</span>
              </button>
            )}
            {isAdminProd && (
              <button
                className="account-action"
                onClick={enterSandbox}
                title="Vào môi trường kiểm thử để giả lập các tài khoản"
                type="button"
              >
                <FlaskConical size={14} />
                <span>Kiểm thử</span>
              </button>
            )}
            {sandbox && hasRealSession && (
              <button
                className="account-action"
                onClick={exitSandbox}
                title="Thoát môi trường kiểm thử"
                type="button"
              >
                <Undo2 size={14} />
                <span>Thoát kiểm thử</span>
              </button>
            )}
            <button
              className="account-action"
              onClick={logout}
              title="Đăng xuất"
              type="button"
            >
              <LogOut size={14} />
              <span>Đăng xuất</span>
            </button>
          </div>
        </div>
        <nav>
          <button className={tab === "okr" ? "active" : ""} onClick={() => setTab("okr")} title="OKR">
            <BarChart3 size={18} />
            <span>OKR</span>
          </button>
          {canAccessTab(role, "et") && (
            <button className={tab === "et" ? "active" : ""} onClick={() => setTab("et")} title="Năng lực ET">
              <ClipboardCheck size={18} />
              <span>Năng lực ET</span>
            </button>
          )}
          <button className={tab === "fi" ? "active" : ""} onClick={() => setTab("fi")} title="FI">
            <Lightbulb size={18} />
            <span>FI</span>
          </button>
          {canAccessTab(role, "admin") && (
            <button className={tab === "admin" ? "active" : ""} onClick={() => setTab("admin")} title="Quản trị">
              <History size={18} />
              <span>Quản trị</span>
            </button>
          )}
        </nav>
      </aside>
      <section className={`workspace ${tab === "fi" ? "fi-workspace-shell" : ""}`}>
        <header className="topbar">
          <div>
            <h1>{tabTitles[tab]}</h1>
            <p>Vai trò: {displayRole(role)}{currentTeam ? ` · ${currentTeam}` : ""}</p>
          </div>
          <div className="topbar-tools">
            {sandbox && (
              <div className="sandbox-toolbar" title="Đang ở môi trường kiểm thử">
                <span className="sandbox-pill"><FlaskConical size={14} /> Kiểm thử</span>
                <select
                  value={currentUserId}
                  onChange={(event) => switchSandboxRole(event.target.value)}
                  aria-label="Giả lập tài khoản"
                >
                  {groupedIdentities.length === 0 && (
                    <option value={currentUserId}>{currentDisplayName ?? currentUserId}</option>
                  )}
                  {groupedIdentities.map((group) => (
                    <optgroup key={group.role} label={displayRole(group.role)}>
                      {group.items.map((identity) => (
                        <option key={identity.id} value={identity.id}>
                          {identity.display_name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button onClick={resetSandbox} disabled={resettingSandbox} title="Reset dữ liệu kiểm thử">
                  <RotateCcw size={16} />
                  {resettingSandbox ? "Đang reset..." : "Reset"}
                </button>
              </div>
            )}
            {role === "Admin" && (
              <button
                className="topbar-snapshot-btn"
                data-export-exclude="true"
                disabled={exportingPng}
                onClick={handleSnapshot}
                title="Tải PNG snapshot tab hiện tại"
                type="button"
              >
                <ImageDown size={17} />
                <span>{exportingPng ? "Đang xuất..." : "Tải PNG"}</span>
              </button>
            )}
            <div className="notifications">
              <button title="Tải lại thông báo" onClick={loadNotifications}>
                <Bell size={17} />
                {notifications.filter((item) => !item.read).length}
              </button>
              {notifications.length > 0 && (
                <div className="notification-list">
                  {notifications.slice(0, 4).map((item) => (
                    <button key={item.id} className={item.read ? "read" : ""} onClick={() => markRead(item.id)}>
                      <strong>{displayNotification(item.event)}</strong>
                      <span>{item.payload?.sk_code ?? item.payload?.id ?? item.payload?.team}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <FileSpreadsheet size={26} />
          </div>
        </header>
        <div
          data-snapshot-fallback="true"
          data-snapshot-name={tabSnapshotNames[tab]}
          key={workspaceVersion}
        >
          {tab === "okr" && <OKRModule role={role} currentUserId={currentUserId} currentTeam={currentTeam} />}
          {tab === "et" && <ETModule role={role} currentUserId={currentUserId} />}
          {tab === "fi" && <FIWorkspace role={role} currentUserId={currentUserId} currentTeam={currentTeam} displayName={currentDisplayName} />}
          {tab === "admin" && <AdminPanel />}
        </div>
      </section>
    </main>
  );
}
