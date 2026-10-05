---
'@uppy/companion': patch
---

@uppy/companion: make silent and swallowed error paths observable.

- The remote OAuth credentials handler (`getCredentialsOverrideMiddleware`) now
  logs the error and responds with a 424 instead of sending the "Could not fetch
  credentials" page with a default 200 status, so a failed credential fetch (a
  misconfigured Template Credential, or a bad `transloadit_gateway`) is no longer
  invisible to logs and monitoring.
- The Redis pub/sub emitter now logs publish/subscribe and invalid-message
  failures. Previously these emitted `error` with no listener, which threw and
  crashed the process via an unhandled rejection or uncaught exception. Note
  that a failed Redis connection is now logged (once) instead of crashing
  Companion, so cross-instance events stop working until Companion is restarted.
- Failing to abort a tus upload (on pause or cancel) and failing to delete a
  temp file are now logged instead of being swallowed or left unhandled.
