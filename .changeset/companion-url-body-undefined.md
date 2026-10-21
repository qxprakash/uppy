---
"@uppy/companion": patch
---

Return 400 instead of throwing a `TypeError` from `/url/meta` and `/url/get` when the request has no JSON body. Express 5's body-parser leaves `req.body` undefined for body-less or non-JSON requests.
