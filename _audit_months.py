import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "backend"))
from app.services.okr.historical_snapshot import (
    _narrative_boxes,
    _narrative_band,
    _plain_text,
    extract_dashboard_narratives,
)

OUT = io.StringIO()
def w(*a): print(*a, file=OUT)


def norm(s: str) -> str:
    return " ".join(str(s or "").split()).strip()


def captured_strings(nar: dict) -> set:
    s = set()
    rep = nar.get("report", {})
    for band in rep.values():
        for kr in band.get("krs", []):
            s.add(norm(kr.get("title")))
            for ln in kr.get("lines", []):
                s.add(norm(ln))
        for n in band.get("notes", []):
            s.add(norm(n))
    for code, obj in (nar.get("objectives") or {}).items():
        s.add(norm(obj.get("full")))
    for code, lines in (nar.get("kr_details") or {}).items():
        for ln in lines:
            s.add(norm(ln))
    for v in (nar.get("violations") or []):
        s.add(norm(v))
    for k, v in (nar.get("extras") or {}).items():
        s.add(norm(v))
    return {x for x in s if x}


for month in ("01", "02", "03", "04"):
    xlsx = fr"KHMT_T1_T2_T3_T4/OKR tháng {month}-2026 - X.ĐK.xlsx"
    data = Path(xlsx).read_bytes()
    boxes = _narrative_boxes(data)
    nar = extract_dashboard_narratives(data)
    rep = nar["report"]
    cap = captured_strings(nar)

    w("\n" + "#" * 100)
    w(f"MONTH {month}: {len(boxes)} boxes")
    w("#" * 100)

    # Full report
    for band in ("O1", "O2", "O3", "O4", "O5", "O6"):
        b = rep.get(band)
        if not b:
            continue
        w(f"\n--- {band} ---")
        for kr in b["krs"]:
            w(f"  [{kr['code']}] {kr['title']}")
            for ln in kr["lines"]:
                w(f"        - {ln}")
        for n in b["notes"]:
            w(f"  NOTE: {n}")

    # Lost lines (real content not surfaced anywhere)
    lost = []
    for box in sorted(boxes, key=lambda b: (b["row"], b["col"])):
        if "hang muc phat sinh" in _plain_text(box["lines"][0]):
            continue
        for ln in box["lines"]:
            n = norm(ln)
            if n and n not in cap:
                lost.append((_narrative_band(box), ln))
    w(f"\n=== LOST ({len(lost)}) ===")
    for band, ln in lost:
        w(f"   [{band}] {ln}")

Path("_audit_months.txt").write_text(OUT.getvalue(), encoding="utf-8")
print("WROTE", len(OUT.getvalue()))
