---
"@uppy/thumbnail-generator": patch
---

Keep generating thumbnails after a queued file is gone. A file dropped by `uppy.clear()` while it waited in the queue stopped all later thumbnails, and uploads with `waitForThumbnailsBeforeUpload` never started. A file removed while its thumbnail was being made no longer leaks the thumbnail's blob URL or emits `thumbnail:error`.
