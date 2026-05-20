from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.config import settings

try:
    import redis
except Exception:  # pragma: no cover - optional dependency fallback
    redis = None

_memory_cache: dict[str, tuple[datetime, Any]] = {}
_redis_client = redis.Redis.from_url(settings.redis_url, decode_responses=True) if redis and settings.redis_url else None


def cache_get(key: str) -> Any | None:
    if _redis_client is not None:
        try:
            raw = _redis_client.get(key)
            return json.loads(raw) if raw is not None else None
        except Exception:
            return None
    item = _memory_cache.get(key)
    if not item:
        return None
    expires_at, value = item
    if expires_at < datetime.now(timezone.utc):
        _memory_cache.pop(key, None)
        return None
    return value


def cache_set(key: str, value: Any, ttl_seconds: int) -> None:
    if _redis_client is not None:
        try:
            _redis_client.setex(key, ttl_seconds, json.dumps(value, ensure_ascii=False))
        except Exception:
            return
        return
    _memory_cache[key] = (datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds), value)


def cache_delete_prefix(prefix: str) -> None:
    if _redis_client is not None:
        try:
            for key in _redis_client.scan_iter(f"{prefix}*"):
                _redis_client.delete(key)
        except Exception:
            return
        return
    for key in list(_memory_cache):
        if key.startswith(prefix):
            _memory_cache.pop(key, None)
