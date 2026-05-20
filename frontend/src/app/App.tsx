import { useEffect, useState } from "react";
import {
  BarChart3,
  Bell,
  ClipboardCheck,
  FileSpreadsheet,
  FileText,
  History,
  Lightbulb,
  PanelLeftClose,
  PanelLeftOpen,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { api, decodeToken, setToken } from "../api/client";
import { AdminPanel } from "../features/admin/AdminPanel";
import { ETModule } from "../features/et/ETModule";
import { FIWorkspace } from "../features/fi/FIWorkspace";
import { EvaluationReference } from "../features/okr/EvaluationReference";
import { OKRWorkspace } from "../features/okr/OKRWorkspace";
import { WebInputForm } from "../features/web-input/WebInputForm";

type Tab = "okr" | "web-input" | "criteria" | "principles" | "et" | "fi" | "admin";

const tabTitles: Record<Tab, string> = {
  okr: "Bảng OKR",
  "web-input": "Nhập liệu OKR",
  criteria: "Tiêu chí đánh giá",
  principles: "Nguyên tắc đánh giá",
  et: "Năng lực ET",
  fi: "Luồng SK-CTKT",
  admin: "Quản trị hệ thống",
};

const demoAccounts = [
  { label: "Quản trị", userId: "admin", password: "admin-pass" },
  { label: "Lãnh đạo Xưởng", userId: "leader", password: "leader-pass" },
  { label: "Đầu mối SK", userId: "fi", password: "fi-pass" },
  { label: "TBHTĐK", userId: "TBHTĐK", password: "tbhtdk-pass" },
  { label: "TBCH", userId: "TBCH", password: "tbch-pass" },
  { label: "TBĐL", userId: "TBĐL", password: "tbdl-pass" },
  { label: "TCĐK", userId: "TCĐK", password: "tcdk-pass" },
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
  SK_DEFERRED: "SK tạm hoãn",
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
  const [notifications, setNotifications] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });

  const login = (credentials?: { userId: string; password: string }) => {
    const loginUserId = credentials?.userId ?? userId;
    const loginPassword = credentials?.password ?? password;
    setUserId(loginUserId);
    setPassword(loginPassword);
    api.login(loginUserId, loginPassword)
      .then((response) => {
        setToken(response.access_token);
        const payload = decodeToken(response.access_token);
        setRole(payload.role ?? "");
        setCurrentUserId(payload.sub ?? loginUserId);
        setError("");
      })
      .catch((err) => setError(friendlyError(err.message)));
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
        <section className="login-panel">
          <div className="brand">
            <ShieldCheck size={24} />
            <div>
              <strong>OKR Automation</strong>
              <span>Xưởng Điều khiển</span>
            </div>
          </div>
          <input placeholder="Tài khoản" value={userId} onChange={(event) => setUserId(event.target.value)} />
          <input placeholder="Mật khẩu" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <div className="demo-login-tabs" aria-label="Tài khoản đăng nhập nhanh">
            {demoAccounts.map((account) => (
              <button key={account.userId} onClick={() => login(account)} type="button">
                {account.label}
              </button>
            ))}
          </div>
          <button onClick={() => login()} type="button">Đăng nhập</button>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">
            <ShieldCheck size={24} />
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
          <strong>{currentUserId}</strong>
          <small>{displayRole(role)}</small>
        </div>
        <nav>
          <button className={tab === "okr" ? "active" : ""} onClick={() => setTab("okr")} title="OKR">
            <BarChart3 size={18} />
            <span>OKR</span>
          </button>
          <button className={tab === "web-input" ? "active" : ""} onClick={() => setTab("web-input")} title="Nhập liệu OKR">
            <FileText size={18} />
            <span>Nhập liệu OKR</span>
          </button>
          <button className={tab === "criteria" ? "active" : ""} onClick={() => setTab("criteria")} title="Tiêu chí đánh giá">
            <ClipboardCheck size={18} />
            <span>Tiêu chí đánh giá</span>
          </button>
          <button className={tab === "principles" ? "active" : ""} onClick={() => setTab("principles")} title="Nguyên tắc đánh giá">
            <Scale size={18} />
            <span>Nguyên tắc đánh giá</span>
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
        {tab === "okr" && <OKRWorkspace role={role} />}
        {tab === "web-input" && <WebInputForm role={role} currentUserId={currentUserId} />}
        {tab === "criteria" && <EvaluationReference kind="criteria" />}
        {tab === "principles" && <EvaluationReference kind="principles" />}
        {tab === "et" && <ETModule role={role} currentUserId={currentUserId} />}
        {tab === "fi" && <FIWorkspace role={role} currentUserId={currentUserId} />}
        {tab === "admin" && <AdminPanel />}
      </section>
    </main>
  );
}
