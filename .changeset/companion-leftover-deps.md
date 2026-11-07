---
"@uppy/companion": patch
---

Drop the `fast-safe-stringify`, `moment-timezone`, `lodash` and `@types/cors` dependencies. Redis pub/sub messages are serialized with a small local function that drops the same circular references, Zoom month ranges and recording names are computed with `Intl` instead of moment, option merging and progress throttling use small local helpers, and the `corsOrigins` option type is defined in Companion itself, so `@types/cors` is no longer installed with Companion. Zoom time zone data now comes from Node's ICU. Legacy zone abbreviations that `Intl` knows (such as `IST` or `PST`) are now used instead of falling back to UTC.
