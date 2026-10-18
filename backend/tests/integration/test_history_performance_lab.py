"""Synthetic lab measurement; output is not a production latency claim."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import platform
import socket
import subprocess
import sys
from threading import Barrier
from time import perf_counter
import time

import httpx
import pytest
from sqlalchemy import event
from app.db.session import create_session, engine
from app.models.domain import SKCTKTModel, User

pytestmark = pytest.mark.skipif(engine.dialect.name != "postgresql", reason="PostgreSQL performance lab")


@contextmanager
def loopback_client(dataset):
    """Run the real single-worker server with only the harness's fake environment."""
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    log_path = Path(os.environ["OKR_TEST_MANIFEST"]).parent / f"uvicorn-{dataset}.log"
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning", "--no-access-log"], stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=20, trust_env=False) as client:
                deadline = perf_counter() + 30
                while True:
                    if process.poll() is not None:
                        raise RuntimeError(f"Synthetic uvicorn exited: {log_path}")
                    try:
                        if client.get("/health").status_code == 200:
                            break
                    except httpx.TransportError:
                        pass
                    if perf_counter() >= deadline:
                        raise TimeoutError(f"Synthetic uvicorn did not become ready: {log_path}")
                    time.sleep(.05)
                yield client
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


@pytest.mark.parametrize("dataset", ["uniform", "varied"])
@pytest.mark.parametrize("transport", ["in-process", "loopback"])
def test_history_5000_rows_ten_concurrent_clients(client, admin_headers, dataset, transport):
    if transport == "loopback":
        with loopback_client(dataset) as network_client:
            measure_history(network_client, admin_headers, dataset, transport)
    else:
        measure_history(client, admin_headers, dataset, transport)


def measure_history(client, admin_headers, dataset, transport):
    stamp = datetime(2026, 9, 1, tzinfo=timezone.utc)
    with create_session() as db:
        if dataset == "varied":
            db.add_all(User(id=f"perf-user-{i}", display_name=f"Nhân viên {i}", full_name=f"Nhân viên {i}", password_hash="not-a-valid-login-hash", role="Staff", team=["TBCH", "TBDL", "TEST-A", "TEST-B"][i % 4]) for i in range(40))
        rows = []
        for i in range(5000):
            varied = dataset == "varied"
            rows.append(SKCTKTModel(id=f"perf-{i:05}", sk_code=f"FI/09/2026-TBCH-{i}", team=["TBCH", "TBDL", "TEST-A", "TEST-B"][i % 4] if varied else "TBCH", title=f"Sáng kiến {i}", author_name=f"Nhân viên {i % 40}" if varied else "Synthetic Person", author_user_id=("" if i % 5 == 0 else f"perf-user-{i % 40}") if varied else "admin", content_description="Synthetic test only", completion_plan=["T10/2026", "Đã hoàn thành", "Chưa thực hiện"][i % 3] if varied else "T10/2026", status=["Approved", "Completed", "Rejected", "Deferred", "Submitted"][i % 5] if varied else "Approved", created_at=stamp.replace(month=1 + i % 12) if varied else stamp, consider_for_khmt=i % 2 == 0, khmt_month=1 + i % 12, khmt_year=2026, is_historical_import=varied and i % 5 == 0, status_history=[{"changed_by": f"perf-user-{(i + 1) % 40}", "comments": {"registration_month": 1 + i % 12, "registration_year": 2026}}] if varied and i % 5 else []))
        db.add_all(rows)
        db.commit()
    url = "/api/v1/fi/history?page=2&page_size=25&q=sang+kien" + ("&decisions=approved" if dataset == "uniform" else "")
    warm_queries = []
    page_query = []
    def before_query(conn, cursor, statement, parameters, context, many):
        context.lab_started = perf_counter()
    def after_query(conn, cursor, statement, parameters, context, many):
        warm_queries.append({"ms": (perf_counter() - context.lab_started) * 1000, "sql": statement[:180]})
        if statement.startswith("SELECT sk_ctkt.id,") and "LIMIT" in statement:
            page_query[:] = [statement, parameters]
    event.listen(engine, "before_cursor_execute", before_query)
    event.listen(engine, "after_cursor_execute", after_query)
    try:
        warm = client.get(url, headers=admin_headers)
    finally:
        event.remove(engine, "before_cursor_execute", before_query)
        event.remove(engine, "after_cursor_execute", after_query)
    page_plan = None
    if page_query:
        with engine.connect() as connection:
            page_plan = connection.exec_driver_sql("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + page_query[0], page_query[1]).scalar_one()
    assert warm.status_code == 200 and warm.json()["total"] == 5000
    payload = warm.json()
    for name in ("teams", "months", "authors", "submitters"):
        assert sum(option["count"] for option in payload["facets"][name]) == 5000
    if dataset == "varied":
        assert len(payload["facets"]["authors"]) == 40
        assert len(payload["facets"]["months"]) == 12
        assert payload["summary"]["approved"] == 2000
    barrier = Barrier(10)
    def worker(_):
        for _ in range(2):
            warmed = client.get(url, headers=admin_headers)
            assert warmed.status_code == 200
        barrier.wait(timeout=15)
        durations = []
        for _ in range(5):
            start = perf_counter()
            response = client.get(url, headers=admin_headers)
            durations.append((perf_counter() - start) * 1000)
            assert response.status_code == 200, response.text
            assert len(response.json()["items"]) == 25
        return durations
    with ThreadPoolExecutor(max_workers=10) as pool:
        durations = sorted(value for results in pool.map(worker, range(10)) for value in results)
    p95 = durations[math.ceil(len(durations) * .95) - 1]
    report = {"environment": "synthetic-local", "database": engine.dialect.name, "transport": "FastAPI TestClient/in-process HTTP; real loopback PostgreSQL", "platform": platform.platform(), "processor": platform.processor(), "logical_cpu_count": os.cpu_count(), "dataset_rows": 5000, "clients": 10, "requests": len(durations), "warmup_requests": 21, "p50_ms": durations[math.ceil(len(durations) * .5) - 1], "p95_ms": p95, "target_ms": 500, "target_met": p95 <= 500, "baseline_comparison": "pending same dataset/toolchain pre-remediation benchmark", "samples_ms": durations}
    report["dataset"] = dataset
    if transport == "loopback":
        report["transport"] = "httpx real loopback TCP HTTP; separate single-worker uvicorn; real loopback PostgreSQL"
    report["synthetic_users"] = 40 if dataset == "varied" else 0
    path = Path(os.environ["OKR_TEST_MANIFEST"]).parent / f"history-performance-{transport}-{dataset}.json"
    report["warmup_queries"] = warm_queries
    report["page_query_plan"] = page_plan
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"performance_report": str(path), "p95_ms": p95, "target_met": p95 <= 500}))
