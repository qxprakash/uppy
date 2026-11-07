---
"@uppy/core": minor
"@uppy/dashboard": patch
"@uppy/golden-retriever": patch
---

Drop `lodash` and `p-retry`. `@uppy/core` now has its own `debounce` and `throttle` (exported from `@uppy/core/utils`, with the same timing as lodash's) and an internal retry helper for Companion uploads that keeps the existing behaviour: up to 10 retries with 1s, 2s, 4s, ... delays, no retry on auth errors, non-retryable HTTP errors or non-network `TypeError`s. `@uppy/dashboard` and `@uppy/golden-retriever` use the new helpers instead of `lodash`.
