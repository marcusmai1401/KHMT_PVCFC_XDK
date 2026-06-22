import { ChevronRight, GraduationCap, ShieldCheck, Trophy, Wrench, Zap } from "lucide-react";
import type React from "react";
import type { ObjectiveSectionPayload, ObjectiveStatus } from "../types/dashboard";
import { NoDataBlock, NoPlanBlock } from "./EmptyBlocks";
import { ObjectiveStatusBadge } from "./ObjectiveStatusBadge";
import { VisualBlockRenderer } from "./VisualBlockRenderer";

const objectiveIcons: Record<string, React.ReactNode> = {
  O1: <ShieldCheck size={19} />,
  O2: <Wrench size={19} />,
  O3: <ShieldCheck size={19} />,
  O4: <Zap size={19} />,
  O5: <GraduationCap size={19} />,
  O6: <Trophy size={19} />,
};

export function ObjectiveSection({
  section,
  onDrillDown,
}: {
  section: ObjectiveSectionPayload;
  onDrillDown?: (objectiveCode: string) => void;
}) {
  const code = section.objective_code || "";
  let visuals = section.visuals || [];
  const status: ObjectiveStatus = section.status || "no_data";
  const hasConclusion = Boolean(section.conclusion);

  if (code === "O5") {
    const fiSource = visuals.find((v) => v.payload?.fi_dashboard_summary);
    const fi_dashboard_summary = fiSource?.payload?.fi_dashboard_summary;
    const fi_counts_by_team = fiSource?.payload?.fi_counts_by_team;
    const o5FiBlock = visuals.find((v) => v.id === "o5_fi");

    const mergedVisuals = visuals
      .map((v) => {
        if (v.id === "o5_initiatives") {
          return {
            ...v,
            payload: {
              ...v.payload,
              fi_dashboard_summary,
              fi_counts_by_team,
              o5_fi_payload: o5FiBlock?.payload,
            },
          };
        }
        return v;
      })
      .filter((v) => v.id !== "o5_fi");

    const desiredOrder = ["o5_competency", "o5_tpm_narrative", "o5_initiatives", "o5_training"];
    visuals = [...mergedVisuals].sort((a, b) => {
      const ai = desiredOrder.indexOf(String(a.id));
      const bi = desiredOrder.indexOf(String(b.id));
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }

  const hasContent = visuals.length > 0 || hasConclusion;

  return (
    <section className="objective-section" data-objective-code={code}>
      <div className="objective-section-header">
        <span className="objective-icon">{objectiveIcons[String(code)] || <ShieldCheck size={19} />}</span>
        <div>
          <p className="objective-code">{code}</p>
          <h2>{section.title || ""}</h2>
          {section.target || section.result ? (
            <p className="objective-target-result">
              {section.target ? (
                <span><b>Mục tiêu:</b> {section.target}</span>
              ) : null}
              {section.result ? (
                <span><b>Kết quả:</b> {section.result}</span>
              ) : null}
            </p>
          ) : null}
        </div>
        <ObjectiveStatusBadge status={status} />
        {code ? (
          <button className="objective-drill-button" type="button" onClick={() => onDrillDown?.(String(code))}>
            <ChevronRight size={16} />
            KR liên quan
          </button>
        ) : null}
      </div>
      <div className="objective-section-body">
        {section.conclusion ? <div className="objective-conclusion">{section.conclusion}</div> : null}
        {visuals.length ? (
          <div className="objective-visual-grid">
            {visuals.map((visual, index) => <VisualBlockRenderer block={visual} key={visual.id || index} />)}
          </div>
        ) : null}
        {!hasContent && status === "no_plan" ? <NoPlanBlock /> : null}
        {!hasContent && status !== "no_plan" ? <NoDataBlock /> : null}
      </div>
    </section>
  );
}
