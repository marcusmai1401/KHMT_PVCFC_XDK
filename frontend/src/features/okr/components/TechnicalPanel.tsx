import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { vn } from "../i18n";
import { NoDataBlock } from "./EmptyBlocks";
import type { TechnicalMetadata } from "../types/dashboard";
import type { TechnicalRole } from "../roleResolver";

function warningType(warning: Record<string, any>) {
  return String(warning.warning_type || warning.type || "UNKNOWN_WARNING");
}

export function TechnicalPanel({
  metadata,
  role,
  forceExpanded = false,
}: {
  metadata?: TechnicalMetadata | null;
  role: TechnicalRole;
  forceExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(forceExpanded);
  const warnings = metadata?.warnings ?? [];
  const references = metadata?.source_references ?? {};
  const canToggle = role === "Admin_User" || role === "Mixed_Role_User";

  useEffect(() => {
    setExpanded(forceExpanded);
  }, [role, forceExpanded]);

  const groupedWarnings = useMemo(() => {
    const groups = new Map<string, Array<Record<string, any>>>();
    warnings.forEach((warning) => {
      const type = warningType(warning);
      groups.set(type, [...(groups.get(type) || []), warning]);
    });
    return Array.from(groups.entries());
  }, [warnings]);

  return (
    <section className="technical-panel panel wide" aria-label="Thông tin kỹ thuật">
      <div className="panel-header">
        <div>
          <h2>Thông tin kỹ thuật</h2>
          <p className="muted">Metadata dashboard được thu gọn ở cuối trang.</p>
        </div>
        {canToggle ? (
          <button onClick={() => setExpanded((value) => !value)} type="button">
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {expanded ? "Thu gọn" : "Mở chi tiết"}
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="technical-panel-body">
          {groupedWarnings.length ? groupedWarnings.map(([type, items]) => (
            <div className="technical-group" key={type}>
              <div className="technical-group-header">
                <Info size={16} />
                <strong>{vn(type)}</strong>
                <code>{type}</code>
              </div>
              {items.map((warning, index) => (
                <div className="technical-warning" key={`${type}-${index}`}>
                  <span>{warning.reason || warning.message || "-"}</span>
                  <small>{vn(String(warning.severity || ""))}</small>
                </div>
              ))}
            </div>
          )) : <NoDataBlock message="Không có cảnh báo kỹ thuật." />}
          <details>
            <summary>Source references</summary>
            <pre>{JSON.stringify(references, null, 2)}</pre>
          </details>
        </div>
      ) : null}
    </section>
  );
}
