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
  const visuals = section.visuals || [];
  const status: ObjectiveStatus = section.status || "no_data";
  const hasConclusion = Boolean(section.conclusion);
  const hasContent = visuals.length > 0 || hasConclusion;

  return (
    <section className="objective-section" data-objective-code={code}>
      <div className="objective-section-header">
        <span className="objective-icon">{objectiveIcons[String(code)] || <ShieldCheck size={19} />}</span>
        <div>
          <p className="objective-code">{code}</p>
          <h2>{section.title || ""}</h2>
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
