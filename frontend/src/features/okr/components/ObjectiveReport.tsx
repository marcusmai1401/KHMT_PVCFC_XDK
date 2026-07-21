import { ClipboardList, StickyNote } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
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

function useDenseReportGrid() {
  const gridRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver === "undefined") return;

    const resizeCards = () => {
      const styles = window.getComputedStyle(grid);
      const rowHeight = Number.parseFloat(styles.gridAutoRows) || 4;
      const rowGap = Number.parseFloat(styles.rowGap) || 10;
      grid.querySelectorAll<HTMLElement>("[data-report-card]").forEach((card) => {
        const span = Math.ceil((card.getBoundingClientRect().height + rowGap) / (rowHeight + rowGap));
        const rowEnd = `span ${Math.max(span, 1)}`;
        if (card.style.gridRowEnd !== rowEnd) card.style.gridRowEnd = rowEnd;
      });
    };

    grid.classList.add("is-masonry-ready");
    const observer = new ResizeObserver(resizeCards);
    observer.observe(grid);
    grid.querySelectorAll<HTMLElement>("[data-report-card]").forEach((card) => observer.observe(card));
    resizeCards();
    return () => {
      observer.disconnect();
      grid.classList.remove("is-masonry-ready");
    };
  }, []);

  return gridRef;
}

export function ObjectiveReport({ report }: { report: ObjectiveReportData }) {
  const krs = Array.isArray(report.krs) ? report.krs : [];
  const notes = Array.isArray(report.notes) ? report.notes : [];
  const gridRef = useDenseReportGrid();
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
        <div className="objective-report-grid" ref={gridRef}>
          {krs.map((kr) => {
            const { name, status } = splitStatus(stripKrPrefix(kr.title));
            return (
              <article className="objective-report-kr" data-report-card key={kr.code}>
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
                ) : (
                  <p className="objective-report-empty">Chưa có diễn giải chi tiết trong tệp nguồn.</p>
                )}
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
