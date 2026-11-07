---
"@uppy/companion": patch
---

Drop `express-prom-bundle`. The `/metrics` endpoint is now served by a small middleware built directly on `prom-client`, with the same metric names, help text, labels (`status_code`, `method`) and histogram buckets as before, plus the existing `up`, default Node.js and `companion_version` metrics.
