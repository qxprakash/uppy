---
"@uppy/companion": patch
---

Drop the `connect-redis` dependency. When Redis is configured, express sessions are now stored by a small built-in store that writes the same keys (`COMPANION_REDIS_EXPRESS_SESSION_PREFIX` + session id), the same JSON values and the same expiry as before, so existing sessions keep working after the upgrade.
