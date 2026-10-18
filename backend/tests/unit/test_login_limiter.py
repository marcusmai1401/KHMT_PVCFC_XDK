from app.core.login_limiter import LoginLimiter
from app.core import login_limiter as module
from types import SimpleNamespace


def test_health_reports_local_quota_as_degraded_without_redis(monkeypatch):
    monkeypatch.setattr(module.settings, "redis_url", "")
    health = LoginLimiter().health()
    assert health["backend"] == "in-process"
    assert health["degraded"] is True and health["status"] == "degraded"
    assert "single-process" in health["warning"]


def test_health_reports_missing_redis_library_as_degraded(monkeypatch):
    monkeypatch.setattr(module.settings, "redis_url", "redis://synthetic.invalid")
    monkeypatch.setattr(module, "redis", None)
    assert LoginLimiter().health()["degraded"] is True


def test_health_tracks_shared_store_failure_without_network(monkeypatch):
    class FakeRedis:
        unavailable = False

        def ping(self):
            if self.unavailable:
                raise OSError("synthetic unavailable")

        def get(self, key):
            self.ping()
            return None

    store = FakeRedis()
    monkeypatch.setattr(module.settings, "redis_url", "redis://synthetic.invalid")
    monkeypatch.setattr(module, "redis", SimpleNamespace(Redis=SimpleNamespace(from_url=lambda *args, **kwargs: store)))
    limiter = LoginLimiter()
    assert limiter.health()["backend"] == "redis"
    assert limiter.health()["degraded"] is False
    store.unavailable = True
    assert limiter.check("192.0.2.1", "synthetic", now=1) == 0
    assert limiter.health()["degraded"] is True
    assert limiter.health()["backend"] == "in-process"
    assert LoginLimiter().health()["degraded"] is True


def test_failed_ttl_read_is_bounded_and_reports_degraded(monkeypatch):
    def unavailable(*args):
        raise OSError("synthetic timeout")

    store = SimpleNamespace(ping=lambda: None, get=lambda key: 2, ttl=unavailable)
    monkeypatch.setattr(module.settings, "redis_url", "redis://synthetic.invalid")
    monkeypatch.setattr(module, "redis", SimpleNamespace(Redis=SimpleNamespace(from_url=lambda *args, **kwargs: store)))
    limiter = LoginLimiter()
    monkeypatch.setattr(limiter, "_limits", lambda: (2, 2))
    assert limiter.check("192.0.2.2", "synthetic", now=1) == module.WINDOW_SECONDS
    assert limiter.health()["degraded"] is True
    assert limiter.health()["backend"] == "in-process"
    assert limiter.check("192.0.2.2", "synthetic", now=module.WINDOW_SECONDS + 1) == 0


def test_limiter_counts_normalized_pair_and_shared_ip_scope(monkeypatch):
    limiter = LoginLimiter()
    monkeypatch.setattr(limiter, "_limits", lambda: (2, 2))

    assert limiter.check("192.0.2.10", "Admin", now=10) == 0
    limiter.record_failure("192.0.2.10", "Admin", now=10)
    limiter.record_failure("192.0.2.10", "admin", now=10)
    assert limiter.check("192.0.2.10", "ADMIN", now=10) > 0
    # A different account behind the same NAT is protected by the IP bucket,
    # while the account pair is not globally locked.
    assert limiter.check("192.0.2.10", "other", now=10) > 0


def test_limiter_expiry_and_fallback_memory_bound(monkeypatch):
    limiter = LoginLimiter()
    monkeypatch.setattr(limiter, "_limits", lambda: (100_000, 100_000))
    for index in range(5000):
        limiter.record_failure("198.51.100.1", f"user-{index}", now=10)
    assert len(limiter._local) <= 4096
    after_window = 10 + 601
    limiter.record_failure("198.51.100.1", "user-expired", now=after_window)
    assert limiter.check("198.51.100.1", "user-expired", now=after_window) == 0
    assert limiter.health()["backend"] == "in-process"


def test_retry_after_counts_down_instead_of_restarting_window(monkeypatch):
    limiter = LoginLimiter()
    monkeypatch.setattr(limiter, "_limits", lambda: (2, 2))
    limiter.record_failure("192.0.2.5", "synthetic", now=10)
    limiter.record_failure("192.0.2.5", "synthetic", now=20)
    assert limiter.check("192.0.2.5", "synthetic", now=600) == 10
    assert limiter.check("192.0.2.5", "synthetic", now=610) == 0
