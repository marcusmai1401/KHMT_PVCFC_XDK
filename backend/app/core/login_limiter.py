"""Small, bounded login limiter with a Redis path and a conservative fallback.

The fallback is intentionally described as degraded: it protects a single
process only.  It must never be presented as a global quota when Redis is
configured but unavailable.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import hashlib
import math
import threading
import time
from typing import Any

from app.core.config import settings

try:  # pragma: no cover - exercised when a Redis deployment is configured.
    import redis
except ModuleNotFoundError:  # pragma: no cover - minimal local installs.
    redis = None  # type: ignore[assignment]


WINDOW_SECONDS = 10 * 60
PAIR_LIMIT = 10
IP_LIMIT = 100


@dataclass
class _Bucket:
    count: int = 0
    reset_at: float = 0.0


class LoginLimiter:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._local: dict[str, _Bucket] = defaultdict(_Bucket)
        # A missing Redis configuration is still a process-local quota. Health
        # must not advertise global protection merely because no ping failed.
        self._degraded = True
        self._redis = None
        if redis is not None and settings.redis_url:
            try:
                self._redis = redis.Redis.from_url(settings.redis_url, decode_responses=True, socket_connect_timeout=0.5, socket_timeout=0.5)
                self._redis.ping()
                self._degraded = False
            except Exception:
                self._redis = None
                self._degraded = True

    @staticmethod
    def _identity(value: str) -> str:
        normalized = str(value or "").strip().casefold()
        # The limiter key/log identity is not the raw account identifier.
        return hashlib.sha256(f"{settings.jwt_secret}:login:{normalized}".encode("utf-8")).hexdigest()[:32]

    def _keys(self, ip: str, user_id: str) -> tuple[str, str]:
        return (
            f"okr:login:ip:{self._identity(ip)}",
            f"okr:login:pair:{self._identity(ip)}:{self._identity(user_id)}",
        )

    def _limits(self) -> tuple[int, int]:
        return IP_LIMIT, PAIR_LIMIT

    def _redis_count(self, key: str) -> int | None:
        if self._redis is None:
            return None
        try:
            value = self._redis.get(key)
            return int(value or 0)
        except Exception:
            self._degraded = True
            self._redis = None
            return None

    def _local_count(self, key: str, now: float) -> int:
        bucket = self._local[key]
        if bucket.reset_at <= now:
            bucket.count = 0
            bucket.reset_at = now + WINDOW_SECONDS
        return bucket.count

    def _prune_local(self, now: float) -> None:
        # A process-local fallback is deliberately degraded, but it must still
        # have a hard memory bound when an attacker rotates fake identities.
        expired = [key for key, bucket in self._local.items() if bucket.reset_at <= now]
        for key in expired:
            self._local.pop(key, None)
        if len(self._local) > 4096:
            oldest = sorted(self._local.items(), key=lambda item: item[1].reset_at)
            for key, _ in oldest[: len(self._local) - 4096]:
                self._local.pop(key, None)

    def check(self, ip: str, user_id: str, *, now: float | None = None) -> int:
        """Return seconds to wait, or zero when another attempt is allowed."""
        current = time.monotonic() if now is None else now
        ip_key, pair_key = self._keys(ip, user_id)
        ip_limit, pair_limit = self._limits()
        counts: list[tuple[int, int]] = []
        retry_times = []
        if self._redis is not None:
            ip_count = self._redis_count(ip_key)
            pair_count = self._redis_count(pair_key)
            if ip_count is not None and pair_count is not None:
                counts = [(ip_count, ip_limit), (pair_count, pair_limit)]
                try:
                    retry_times = [max(1, self._redis.ttl(key)) for key, count, limit in [(ip_key, ip_count, ip_limit), (pair_key, pair_count, pair_limit)] if count >= limit]
                except Exception:
                    self._degraded = True
                    self._redis = None
                    retry_times = [WINDOW_SECONDS] if any(count >= limit for count, limit in counts) else []
        if not counts:
            with self._lock:
                self._prune_local(current)
                counts = [
                    (self._local_count(ip_key, current), ip_limit),
                    (self._local_count(pair_key, current), pair_limit),
                ]
                retry_times = [max(1, math.ceil(self._local[key].reset_at - current)) for key, (count, limit) in zip((ip_key, pair_key), counts) if count >= limit]
                self._prune_local(current)
        return max(retry_times, default=0)

    def record_failure(self, ip: str, user_id: str, *, now: float | None = None) -> None:
        current = time.monotonic() if now is None else now
        keys = self._keys(ip, user_id)
        if self._redis is not None:
            try:
                self._redis.eval("""
                    for i, key in ipairs(KEYS) do
                        local count = redis.call('INCR', key)
                        if count == 1 then redis.call('EXPIRE', key, ARGV[1]) end
                    end
                    return 1
                """, len(keys), *keys, WINDOW_SECONDS)
                return
            except Exception:
                self._degraded = True
                self._redis = None
        with self._lock:
            self._prune_local(current)
            for key in keys:
                bucket = self._local[key]
                if bucket.reset_at <= current:
                    bucket.count = 0
                    bucket.reset_at = current + WINDOW_SECONDS
                bucket.count += 1
            self._prune_local(current)

    def health(self) -> dict[str, Any]:
        return {
            "backend": "redis" if self._redis is not None else "in-process",
            "degraded": self._degraded,
            "status": "degraded" if self._degraded else "ready",
            "warning": "Limiter is single-process because shared Redis is unavailable." if self._degraded else None,
            "window_seconds": WINDOW_SECONDS,
            "pair_limit": PAIR_LIMIT,
            "ip_limit": IP_LIMIT,
        }


login_limiter = LoginLimiter()
