import io, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "backend"))
from app.services.okr.historical_snapshot import _narrative_boxes, _narrative_band, _plain_text

OUT = io.StringIO()
def w(*a): print(*a, file=OUT)

for month in ("01", "02", "03", "04"):
    data = Path(fr"KHMT_T1_T2_T3_T4/OKR tháng {month}-2026 - X.ĐK.xlsx").read_bytes()
    boxes = [b for b in _narrative_boxes(data) if _narrative_band(b) == "O4"]
    boxes.sort(key=lambda b: (b["col"], b["row"]))
    w(f"\n===== MONTH {month}: O4 band has {len(boxes)} boxes =====")
    for b in boxes:
        skip = "hang muc phat sinh" in _plain_text(b["lines"][0])
        w(f"  col={b['col']:>2} row={b['row']:>3} {'[TEAM-ADD,skipped]' if skip else ''} lines={len(b['lines'])}")
        for ln in b["lines"][:3]:
            w(f"      | {ln[:80]}")
        if len(b["lines"]) > 3:
            w(f"      | ... (+{len(b['lines'])-3} more)")

Path("_o4_geom.txt").write_text(OUT.getvalue(), encoding="utf-8")
print("WROTE", len(OUT.getvalue()))
