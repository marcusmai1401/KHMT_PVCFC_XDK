import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";

type ObjectiveFilter = "All" | "O1" | "O2" | "O3" | "O4" | "O5" | "O6";

const objectiveFilters: ObjectiveFilter[] = ["All", "O1", "O2", "O3", "O4", "O5", "O6"];

const objectiveLabels: Record<ObjectiveFilter, string> = {
  All: "Tất cả",
  O1: "O1",
  O2: "O2",
  O3: "O3",
  O4: "O4",
  O5: "O5",
  O6: "O6",
};

function krSortKey(code: string): [number, number, string] {
  const match = /^O(\d+)\.KR(\d+)$/i.exec(code || "");
  if (!match) {
    return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, code || ""];
  }
  return [Number(match[1]), Number(match[2]), code];
}

function compareKrRows(left: any, right: any) {
  const leftKey = krSortKey(left.workshop_kr_code);
  const rightKey = krSortKey(right.workshop_kr_code);
  return leftKey[0] - rightKey[0] || leftKey[1] - rightKey[1] || leftKey[2].localeCompare(rightKey[2]);
}

export function AdminPanel() {
  const [mapping, setMapping] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [objectiveFilter, setObjectiveFilter] = useState<ObjectiveFilter>("All");

  useEffect(() => {
    api.krMapping()
      .then(setMapping)
      .catch((err) => setError(err.message));
  }, []);

  const sortedMapping = useMemo(() => [...mapping].sort(compareKrRows), [mapping]);

  const filteredMapping = useMemo(
    () =>
      objectiveFilter === "All"
        ? sortedMapping
        : sortedMapping.filter((row) => row.workshop_kr_code?.startsWith(`${objectiveFilter}.`)),
    [objectiveFilter, sortedMapping],
  );

  return (
    <div
      className="content-grid"
      data-snapshot-target="true"
      data-snapshot-name="quan-tri-kr-mapping"
    >
      {error && <p className="error">{error}</p>}
      <section className="panel wide">
        <div className="panel-header">
          <div>
            <h2>Bảng ánh xạ KR</h2>
            <p className="muted">{filteredMapping.length} / {mapping.length} KR</p>
          </div>
          <div className="segmented-control" aria-label="Lọc theo Objective">
            {objectiveFilters.map((filter) => (
              <button
                className={objectiveFilter === filter ? "active" : ""}
                key={filter}
                onClick={() => setObjectiveFilter(filter)}
                type="button"
              >
                {objectiveLabels[filter]}
              </button>
            ))}
          </div>
        </div>
        <div className="matrix">
          <table>
            <thead>
              <tr>
                <th>KR</th>
                <th>Cột</th>
                <th>Tên</th>
                <th>Mục tiêu</th>
              </tr>
            </thead>
            <tbody>
              {filteredMapping.map((row) => (
                <tr key={row.workshop_kr_code}>
                  <td>{row.workshop_kr_code}</td>
                  <td>{row.dashboard_column}</td>
                  <td>{row.kr_name}</td>
                  <td>{row.target_value}</td>
                </tr>
              ))}
              {filteredMapping.length === 0 && (
                <tr>
                  <td colSpan={4}>Không có KR trong nhóm {objectiveLabels[objectiveFilter]}.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
