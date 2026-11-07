---
"@uppy/companion": patch
---

Replace the `webdav` and `node-fetch` dependencies with a small read-only WebDAV client in Companion. It sends the same PROPFIND and GET requests, parses the response with `fast-xml-parser` (now a direct dependency) and keeps the 5 MiB limit on listings. Small differences: credentials no longer follow a redirect to another origin (including the same host on another port), at most 10 redirects are followed (was 20), and a 303 redirect keeps the PROPFIND method. WebDAV URLs with embedded credentials are still rejected. Two fixes: properties are read from the successful `<propstat>` even when the server lists the missing ones first (folders were shown as empty files), and a 3xx response without a `Location` is an error instead of being downloaded as the file.
