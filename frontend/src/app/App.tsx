import { useEffect, useState } from "react";
import {
  BarChart3,
  Bell,
  ClipboardCheck,
  FileSpreadsheet,
  History,
  Lightbulb,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { api, decodeToken, setToken } from "../api/client";
import { AdminPanel } from "../features/admin/AdminPanel";
import { ETModule } from "../features/et/ETModule";
import { FIWorkspace } from "../features/fi/FIWorkspace";
import { OKRModule } from "../features/okr/OKRModule";

type Tab = "okr" | "et" | "fi" | "admin";

const tabTitles: Record<Tab, string> = {
  okr: "OKR",
  et: "Năng lực ET",
  fi: "Luồng SK-CTKT",
  admin: "Quản trị hệ thống",
};

const testAccount = { userId: "test", password: "12345678" };

const sandboxIdentities = [
  { label: "Quản trị", userId: "admin", role: "Admin" },
  { label: "Lãnh đạo Xưởng", userId: "leader", role: "Workshop_Leader" },
  { label: "Đầu mối SK", userId: "fi", role: "FI_Coordinator" },
  { label: "TBHTĐK", userId: "TBHTĐK", role: "Team_Account" },
  { label: "TBCH", userId: "TBCH", role: "Team_Account" },
  { label: "TBĐL", userId: "TBĐL", role: "Team_Account" },
  { label: "TCĐK", userId: "TCĐK", role: "Team_Account" },
];

const roleLabels: Record<string, string> = {
  Admin: "Quản trị",
  Workshop_Leader: "Lãnh đạo Xưởng",
  FI_Coordinator: "Đầu mối SK",
  Team_Account: "Tài khoản đội/tổ",
};

const notificationLabels: Record<string, string> = {
  SK_SUBMITTED: "SK đã gửi duyệt",
  SK_NEED_MORE_INFO: "SK cần bổ sung",
  SK_REVIEWED: "SK đã được xem xét",
  SK_APPROVED: "SK đã phê duyệt",
  SK_REJECTED: "SK bị từ chối",
  SK_DEFERRED: "SK xem xét sau",
  SK_CANCELLED: "SK đã hủy",
  SK_COMPLETED: "SK đã hoàn tất",
  SK_STATUS_CHANGED: "SK đổi trạng thái",
};

const SIDEBAR_COLLAPSED_KEY = "okr.sidebar.collapsed";

function displayRole(value: string) {
  return roleLabels[value] ?? value;
}

function displayNotification(value: string) {
  return notificationLabels[value] ?? value;
}

function friendlyError(message: string) {
  if (message.includes("Invalid credentials")) {
    return "Sai tài khoản hoặc mật khẩu.";
  }
  if (message.includes("Not authenticated") || message.includes("Invalid token")) {
    return "Phiên đăng nhập không hợp lệ.";
  }
  if (message.includes("Insufficient role") || message.includes("Not allowed")) {
    return "Tài khoản không có quyền thực hiện thao tác này.";
  }
  return message;
}

function canAccessTab(role: string, candidate: Tab) {
  if (candidate === "admin") {
    return role === "Admin";
  }
  if (candidate === "et") {
    return ["Admin", "Workshop_Leader", "FI_Coordinator", "Team_Account"].includes(role);
  }
  return true;
}

export function App() {
  const [tab, setTab] = useState<Tab>("okr");
  const [role, setRole] = useState("");
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [sandbox, setSandbox] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resettingSandbox, setResettingSandbox] = useState(false);
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });

  const applySession = (accessToken: string, fallbackUserId: string) => {
    setToken(accessToken);
    const payload = decodeToken(accessToken);
    setRole(payload.role ?? "");
    setCurrentUserId(payload.sub ?? fallbackUserId);
    setSandbox(Boolean(payload.sandbox));
    setError("");
  };

  const login = (credentials?: { userId: string; password: string }) => {
    const loginUserId = credentials?.userId ?? userId;
    const loginPassword = credentials?.password ?? password;
    setUserId(loginUserId);
    setPassword(loginPassword);
    setNotice("");
    api.login(loginUserId, loginPassword)
      .then((response) => {
        applySession(response.access_token, loginUserId);
      })
      .catch((err) => setError(friendlyError(err.message)));
  };

  const switchSandboxRole = (nextUserId: string) => {
    api.sandboxSwitchRole(nextUserId)
      .then((response) => {
        applySession(response.access_token, nextUserId);
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
      })
      .catch((err) => setError(friendlyError(err.message)))
      .finally(() => setResettingSandbox(false));
  };

  const loadNotifications = () => {
    api.notifications().then(setNotifications).catch((err) => setError(friendlyError(err.message)));
  };

  const markRead = (id: string) => {
    api.markNotificationRead(id).then(loadNotifications).catch((err) => setError(friendlyError(err.message)));
  };

  useEffect(() => {
    if (role) {
      loadNotifications();
    }
  }, [role]);

  useEffect(() => {
    if (role && !canAccessTab(role, tab)) {
      setTab("okr");
    }
  }, [role, tab]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    }
  }, [sidebarCollapsed]);

  if (!role) {
    return (
      <main className="login-shell">
        <form
          className="login-panel"
          onSubmit={(event) => {
            event.preventDefault();
            login();
          }}
        >
          <div className="brand">
            <img src="/logo.webp" alt="PVCFC Logo" className="brand-logo" />
            <div>
              <strong>OKR Automation</strong>
              <span>Xưởng Điều khiển</span>
            </div>
          </div>
          <label className="login-field">
            <span>Tài khoản</span>
            <input autoComplete="username" placeholder="Nhập tài khoản" value={userId} onChange={(event) => setUserId(event.target.value)} />
          </label>
          <label className="login-field">
            <span>Mật khẩu</span>
            <input autoComplete="current-password" placeholder="Nhập mật khẩu" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button className="login-primary" type="submit">Đăng nhập</button>
          <div className="sandbox-login">
            <div>
              <strong>Môi trường kiểm thử</strong>
              <span>Dùng database sandbox, có thể reset bất cứ lúc nào.</span>
            </div>
            <button onClick={() => login(testAccount)} type="button">
              <ShieldCheck size={16} />
              Vào bản test
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          {notice && <p className="success">{notice}</p>}
        </form>
      </main>
    );
  }

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
          <strong>{sandbox ? "test" : currentUserId}</strong>
          <small>{sandbox ? `Đang xem: ${displayRole(role)}${role === "Team_Account" ? ` · ${currentUserId}` : ""}` : displayRole(role)}</small>
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
      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{tabTitles[tab]}</h1>
            <p>Vai trò: {displayRole(role)}</p>
          </div>
          <div className="topbar-tools">
            {sandbox && (
              <div className="sandbox-toolbar">
                <ShieldCheck size={16} />
                <select value={currentUserId} onChange={(event) => switchSandboxRole(event.target.value)}>
                  {sandboxIdentities.map((identity) => (
                    <option key={identity.userId} value={identity.userId}>
                      {identity.label}
                    </option>
                  ))}
                </select>
                <button onClick={resetSandbox} disabled={resettingSandbox} title="Reset dữ liệu kiểm thử">
                  <RotateCcw size={16} />
                  {resettingSandbox ? "Đang reset..." : "Reset test"}
                </button>
              </div>
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
                      <span>{item.payload?.sk_code ?? item.payload?.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <FileSpreadsheet size={26} />
          </div>
        </header>
        <div key={workspaceVersion}>
          {tab === "okr" && <OKRModule role={role} currentUserId={currentUserId} />}
          {tab === "et" && <ETModule role={role} currentUserId={currentUserId} />}
          {tab === "fi" && <FIWorkspace role={role} currentUserId={currentUserId} />}
          {tab === "admin" && <AdminPanel />}
        </div>
      </section>
    </main>
  );
}
