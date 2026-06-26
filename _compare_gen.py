import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "backend"))
from app.services.okr.historical_snapshot import (
    _narrative_boxes,
    _narrative_band,
    _plain_text,
    extract_dashboard_narratives,
)

# Mirror the frontend display transforms so reviewers see what the USER sees.
STATUS_RE = re.compile(r"^(.*?)\s*[-–]\s*((?:Không có KH|Hoàn thành|Lũy kế|Đang|Trễ|Chưa)[\s\S]*)$")


def short_code(code):
    i = code.find(".KR")
    return code[i + 1:] if i >= 0 else code


def strip_kr_prefix(title):
    return re.sub(r"^KR\s*0*\d+\s*[.\-:]?\s*", "", title, flags=re.I).strip() or title


def strip_bullet(line):
    return re.sub(r"^\s*[-*•+]\s+", "", line).strip()


def split_status(title):
    m = STATUS_RE.match(title)
    if m and len(m.group(1).strip()) > 4:
        return m.group(1).strip(), m.group(2).strip()
    return title, None


def rendered(kr):
    name, status = split_status(strip_kr_prefix(kr["title"]))
    return {
        "chip": short_code(kr["code"]),
        "displayed_title": name,
        "displayed_status_pill": status,
        "displayed_lines": [strip_bullet(x) for x in kr["lines"]],
    }


out = {}
for month in ("02", "03"):
    data = Path(fr"KHMT_T1_T2_T3_T4/OKR tháng {month}-2026 - X.ĐK.xlsx").read_bytes()
    boxes = _narrative_boxes(data)
    rep = extract_dashboard_narratives(data)["report"]
    out[month] = {}
    for band in ("O1", "O2", "O3", "O4", "O5", "O6"):
        raw = []
        for b in sorted(boxes, key=lambda x: (x["row"], x["col"])):
            if _narrative_band(b) != band:
                continue
            tag = "TEAM-ADD(excluded)" if "hang muc phat sinh" in _plain_text(b["lines"][0]) else ""
            for ln in b["lines"]:
                if ln.strip():
                    raw.append({"col": b["col"], "row": b["row"], "tag": tag, "text": ln})
        r = rep.get(band, {"krs": [], "notes": []})
        out[month][band] = {
            "raw_excel_lines": raw,
            "rendered_report": {
                "krs": [rendered(k) for k in r["krs"]],
                "notes": [strip_bullet(n) for n in r["notes"]],
            },
        }

Path("_compare.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print("WROTE _compare.json", Path("_compare.json").stat().st_size, "bytes")
