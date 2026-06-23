import { ClipboardList, StickyNote } from "lucide-react";
import type { ObjectiveReport as ObjectiveReportData } from "../types/dashboard";

// Trailing progress states the Excel writes inline in a KR heading, e.g.
// "… - Không có KH trong tháng" or "… - Hoàn thành 170/188 HM ~ 90.4 %".
const STATUS_RE = /^(.*?)\s*[-–]\s*((?:Không có KH|Hoàn thành|Lũy kế|Đang|Trễ|Chưa)[\s\S]*)$/;

function shortCode(code: string) {
  const idx = code.indexOf(".KR");
  return idx >= 0 ? code.slice(idx + 1) : code;
}

// Drop the leading "KR 10." / "KR02" label — the code chip already carries it —
// without touching the descriptive wording itself.
function stripKrPrefix(title: string) {
  return title.replace(/^KR\s*0*\d+\s*[.\-:]?\s*/i, "").trim() || title;
}

function stripBullet(line: string) {
  return line.replace(/^\s*[-*•+]\s+/, "").trim();
}

function splitStatus(title: string): { name: string; status: string | null } {
  const match = title.match(STATUS_RE);
  if (match && match[1].trim().length > 4) {
    return { name: match[1].trim(), status: match[2].trim() };
  }
  return { name: title, status: null };
}

export function ObjectiveReport({ report }: { report: ObjectiveReportData }) {
  const krs = Array.isArray(report.krs) ? report.krs : [];
  const notes = Array.isArray(report.notes) ? report.notes : [];
  if (!krs.length && !notes.length) return null;

  return (
    <section className="objective-report" aria-label="Chi tiết báo cáo trong kỳ">
      <header className="objective-report-head">
        <span className="objective-report-head-icon">
          <ClipboardList size={15} />
        </span>
        <h3>Chi tiết báo cáo trong kỳ</h3>
      </header>

      {krs.length ? (
        <div className="objective-report-grid">
          {krs.map((kr) => {
            const { name, status } = splitStatus(stripKrPrefix(kr.title));
            return (
              <article className="objective-report-kr" key={kr.code}>
                <div className="objective-report-kr-head">
                  <span className="objective-report-kr-code">{shortCode(kr.code)}</span>
                  <p className="objective-report-kr-title">{name}</p>
                  {status ? <span className="objective-report-kr-status">{status}</span> : null}
                </div>
                {kr.lines.length ? (
                  <ul className="objective-report-lines">
                    {kr.lines.map((line, index) => (
                      <li key={index}>{stripBullet(line)}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

      {notes.length ? (
        <div className="objective-report-notes">
          <span className="objective-report-notes-label">
            <StickyNote size={13} /> Ghi chú khác
          </span>
          <ul>
            {notes.map((note, index) => (
              <li key={index}>{stripBullet(note)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
