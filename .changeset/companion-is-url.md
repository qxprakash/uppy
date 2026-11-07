---
"@uppy/companion": patch
---

Drop the `validator` dependency. URLs given to Companion (remote file URLs, WebDAV servers, upload destinations and `periodicPingUrls`) are now checked with the WHATWG URL parser that Node's HTTP clients use, and rejected when the host written in the URL is not the host that would be requested (for example `http://example.com\@evil.com`). Otherwise the same URLs are accepted as before.
