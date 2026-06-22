import { useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardCheck, FileText, Gauge, Scale } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { WebInputForm } from "../web-input/WebInputForm";
import { EvaluationReference } from "./EvaluationReference";
import { OKRWorkspace } from "./OKRWorkspace";

type OKRTab = "dashboard" | "web-input" | "criteria" | "principles";

const okrTabs: Array<{ id: OKRTab; label: string; icon: LucideIcon }> = [
  { id: "dashboard", label: "OKR dashboard", icon: Gauge },
  { id: "web-input", label: "Nhập liệu OKR", icon: FileText },
  { id: "criteria", label: "Tiêu chí đánh giá", icon: ClipboardCheck },
  { id: "principles", label: "Nguyên tắc đánh giá", icon: Scale },
];

const snapshotNames: Record<OKRTab, string> = {
  dashboard: "okr-dashboard",
  "web-input": "okr-nhap-lieu",
  criteria: "okr-tieu-chi-danh-gia",
  principles: "okr-nguyen-tac-danh-gia",
};

export function OKRModule({
  role,
  currentUserId,
  currentTeam,
  editMode = true,
  tabsHost = null,
}: {
  role: string;
  currentUserId: string;
  currentTeam?: string | null;
  editMode?: boolean;
  // Node trong topbar (do App cung cấp) để render hàng tab lên chung với tiêu đề.
  tabsHost?: HTMLElement | null;
}) {
  const [activeTab, setActiveTab] = useState<OKRTab>("dashboard");
  const canUseOkrWebInput = role === "Admin";
  const visibleTabs = okrTabs.filter((tab) => canUseOkrWebInput || tab.id !== "web-input");

  const tabsControl = (
    <div className="segmented-control okr-topbar-tabs" role="tablist" aria-label="OKR">
      {visibleTabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "active" : ""}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            type="button"
          >
            <Icon size={16} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      className="okr-module-shell"
      data-snapshot-target="true"
      data-snapshot-name={snapshotNames[activeTab]}
    >
      {/* Hàng tab được "portal" lên topbar để nằm chung hàng với tiêu đề "OKR".
          Khi host chưa sẵn sàng (vd: render standalone) thì hiển thị tại chỗ. */}
      {tabsHost
        ? createPortal(tabsControl, tabsHost)
        : <div className="okr-module-tabs">{tabsControl}</div>}
      {activeTab === "dashboard" && <OKRWorkspace role={role} editMode={editMode} />}
      {canUseOkrWebInput && activeTab === "web-input" && (
        <WebInputForm role={role} currentUserId={currentUserId} currentTeam={currentTeam} editMode={editMode} />
      )}
      {activeTab === "criteria" && <EvaluationReference kind="criteria" />}
      {activeTab === "principles" && <EvaluationReference kind="principles" />}
    </div>
  );
}
