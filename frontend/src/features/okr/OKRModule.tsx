import { useState } from "react";
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

export function OKRModule({ role, currentUserId }: { role: string; currentUserId: string }) {
  const [activeTab, setActiveTab] = useState<OKRTab>("dashboard");

  return (
    <div className="okr-module-shell">
      <div className="okr-module-tabs" role="tablist" aria-label="OKR">
        <div className="segmented-control">
          {okrTabs.map((tab) => {
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
      </div>
      {activeTab === "dashboard" && <OKRWorkspace role={role} />}
      {activeTab === "web-input" && <WebInputForm role={role} currentUserId={currentUserId} />}
      {activeTab === "criteria" && <EvaluationReference kind="criteria" />}
      {activeTab === "principles" && <EvaluationReference kind="principles" />}
    </div>
  );
}
