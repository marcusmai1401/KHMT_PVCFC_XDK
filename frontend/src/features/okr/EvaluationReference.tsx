import { evaluationCriteria, evaluationPrinciples } from "./evaluationReferenceData";

type ReferenceKind = "criteria" | "principles";

export function EvaluationReference({ kind }: { kind: ReferenceKind }) {
  const data = kind === "criteria" ? evaluationCriteria : evaluationPrinciples;

  return (
    <div className="content-grid">
      <section className="panel wide">
        <div className="panel-header">
          <div>
            <h2>{data?.title ?? (kind === "criteria" ? "Tiêu chí đánh giá" : "Nguyên tắc đánh giá")}</h2>
            <p className="muted">{data?.sheet}</p>
          </div>
        </div>
        {kind === "criteria" ? <CriteriaTable data={data} /> : <PrinciplesTable data={data} />}
      </section>
    </div>
  );
}

function CriteriaTable({ data }: { data: any }) {
  return (
    <>
      <div className="matrix">
        <table className="reference-table">
          <thead>
            <tr>
              <th>STT</th>
              <th>Mức đánh giá</th>
              <th>Tiêu chí</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows?.map((row: any) => (
              <tr key={row.index}>
                <td>{row.index}</td>
                <td>{row.level}</td>
                <td>{row.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.notes?.length > 0 && (
        <div className="reference-notes">
          {data.notes.map((note: string) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}
    </>
  );
}

function PrinciplesTable({ data }: { data: any }) {
  return (
    <div className="matrix">
      <table className="reference-table">
        <thead>
          <tr>
            <th>Nguyên tắc</th>
            <th>Nội dung</th>
          </tr>
        </thead>
        <tbody>
          {data?.rows?.map((row: any) => (
            <tr key={row.principle}>
              <td>{row.principle}</td>
              <td>{row.content}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
