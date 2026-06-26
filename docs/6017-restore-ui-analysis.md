# #6017 — Restore UI while encoding: fix deep-dive & design analysis

This document captures two things from the #6017 work:

1. **The fix deep-dive** — the exact "does not allow removing files during an upload" error, why it happened, and how it was fixed.
2. **The design analysis** — why a seemingly simple UI change (don't show the "restored" screen when the page is refreshed after encoding has started) was hard to implement, i.e. where we were fighting Uppy's current design.

---

## Part 1 — Deep dive: the `clear()` error and its fix

### The symptom

After GoldenRetriever restored a Transloadit session (page refreshed while the assembly was encoding), the StatusBar showed **Complete + Done**, but clicking **Done** threw:

```
Uncaught Error: The installed uploader plugin does not allow removing files during an upload.
    at Uppy.clear (Uppy.js:229)
    at Dashboard.opts.doneButtonHandler (Dashboard.js:100)
```

The same throw also blocked the file-remove `×` button and "Add more".

### Step 1 — What `clear()` actually checks

`Done` calls `uppy.clear()`, which throws under exactly one condition (`@uppy/core/src/Uppy.ts`):

```ts
clear() {
  const { capabilities, currentUploads } = this.getState()
  if (Object.keys(currentUploads).length > 0 && !capabilities.individualCancellation) {
    throw new Error('The installed uploader plugin does not allow removing files during an upload.')
  }
  ...
}
```

Transloadit sets `individualCancellation: false`, so the throw reduces to: **`currentUploads` is non-empty.** The real question was never "why does Done fail" — it's **"why is there still a `currentUploads` batch after everything looks done?"**

### Step 2 — Why the batch becomes a "zombie"

In a normal upload, `currentUploads` is created by `uppy.upload()` → `#createUpload`, and **retired** at the end of `#runUpload` → `#removeUpload`.

A recovered Transloadit session **never calls `uppy.upload()`**:

- On reload, GoldenRetriever's `#restore` puts the in-progress batch back into `state.currentUploads` (from the snapshot) and sets `state.recoveredState`.
- Transloadit's `#onRestored` reconnects to the assembly out-of-band and finishes it via its `AssemblyWatcher` — **not** through `#runUpload`.

So nothing ever calls `#removeUpload`. The batch sits in `currentUploads` forever = the zombie. The fix had to retire it from GoldenRetriever once the recovered upload is done.

### Step 3 — The first fixes, and why they failed

The cleanup in GR's `#handleStateUpdate` was meant to clear the recovered batch "when the upload is done." The mistake was **how "done" was defined**:

- v1 keyed off `progress.complete`.
- v2 keyed off `uploadComplete && !processing` (matching `isAllComplete`)…
- …**but both still required `!file.error`.**

It kept failing, and the cause was incorrectly suspected to be a stale Vite bundle for several rounds (it wasn't — `@uppy/*` is served straight from `lib`, so a page reload picks up a rebuild). That was the wrong loop: guessing instead of measuring.

### Step 4 — Instrumenting, and the decisive evidence

Temporary `console.warn` traces in `#handleStateUpdate` dumped each file's flags on every state update. The restore state, right before the throw, was unambiguous:

```
files = [{ uc:true, pp:false, pre:false, c:true, e:true } × 6]
```

**Every file had `error: true`** (alongside `uploadComplete:true`, `complete:true`, no processing).

That `uc:true + c:true + e:true` shape is produced by exactly one place — the **AssemblyWatcher's assembly-error handler** (`@uppy/transloadit`), which on a failed assembly emits, per file:

```ts
this.uppy.emit('upload-error', file, error)     // → file.error = true
this.uppy.emit('postprocess-complete', file)    // → progress.complete = true, postprocess cleared
```

### Step 5 — The actual root cause (a signal mismatch)

Two completion signals **disagree** for an errored-but-uploaded file:

| Consumer | Condition | Result for errored files |
|---|---|---|
| **Done button** (`getObjectOfFilesPerState().isAllComplete`) | `uploadComplete` + no processing — **ignores per-file `error`** | **true** → shows Done |
| **The GR cleanup (buggy)** | `uploadComplete` + no processing + **`!error`** | **false** → never retires the batch |

So the UI offered **Done**, but the cleanup refused to retire the zombie batch because the files were errored. → `clear()` saw a non-empty `currentUploads` → threw.

(There was also a deeper reason the files were errored at all: the assembly was genuinely failing server-side — a separate issue from this fix.)

### Step 6 — The fix

Align the cleanup to the **same terminal condition the UI uses** — drop the `!error` clause, so the batch is retired whenever every file is uploaded and no longer processing, **whether it succeeded or errored**:

```ts
// in @uppy/golden-retriever #handleStateUpdate, on a files change:
const recovering = nextState.recoveredState != null
const recoveredFiles = Object.values(nextState.files)
const recoveredUploadTerminal =
  recoveredFiles.length > 0 &&
  recoveredFiles.every(
    (f) => f.progress.uploadComplete && !f.progress.preprocess && !f.progress.postprocess,
  )

if (recovering && (recoveredFiles.length === 0 || recoveredUploadTerminal)) {
  // retire ONLY the recovered batch's ids, never a concurrent live upload()
  const recoveredUploadIds = new Set(Object.keys(nextState.recoveredState?.currentUploads ?? {}))
  const currentUploads = Object.fromEntries(
    Object.entries(nextState.currentUploads).filter(([id]) => !recoveredUploadIds.has(id)),
  )
  this.uppy.setState({ recoveredState: null, currentUploads, allowNewUpload: true })
}
```

Safety properties:

- **Gated on `recoveredState`** → only fires for a GoldenRetriever-restored session; normal uploads (any plugin) and a user-confirmed resume (which clears `recoveredState` first) are untouched.
- **Surgical clear** → removes only the recovered batch's upload IDs, so a *new* `upload()` started during recovery keeps its own batch (its `#runUpload`/`addResultData` won't read an `undefined` entry).
- **`allowNewUpload: true`** → restores a usable end state.

### Net effect

Once a restored upload reaches a terminal state, the zombie `currentUploads` is retired in the same tick the UI shows Done. So `Done → clear()`, the file-remove `×`, and "Add more" all work — for both successful and errored restores.

### Files changed for #6017 overall

- `@uppy/status-bar` + `@uppy/dashboard` StatusBar: show processing (not a dead "press Upload to resume" prompt) on restore-while-encoding, and hide the resume button.
- `@uppy/dashboard` Dashboard: suppress the "Session restored" banner in that case.
- `@uppy/golden-retriever`: the zombie-batch fix above (retire the recovered batch at terminal state).
- `@uppy/thumbnail-generator`: an unrelated queue-dedup memory-leak fix found along the way.

---

## Part 2 — Why this "simple UI change" was hard (fighting the design)

The feature *looked* like a UI tweak — "don't show the restored screen when refreshing after encoding has started" — but it actually required introducing a state the system doesn't model. The friction was real and pointed at genuine seams in Uppy's design.

### 1. `recoveredState` conflates two different situations

GoldenRetriever's "recovered" state was designed around **one** mental model: *"page reloaded mid-upload; the blobs may be gone; the user must confirm to re-upload."* The banner, the "press Upload to resume" button, the `restore-confirmed` handshake, and the still-open `currentUploads` batch all assume that.

The Transloadit-encoding case is a *fundamentally different* situation — bytes are already on the server, nothing needs re-uploading, work continues without the user — but it's represented by the **same** `recoveredState` flag. So "don't show the restored screen here" really means *"disambiguate a state that was never designed to be disambiguated."* That is not a UI change; it is adding a new concept.

### 2. The real iceberg: two completion paths that never converge

This is the deepest reason. Core's entire upload lifecycle — `currentUploads`, `#removeUpload`, the `complete` event, postprocessors — **only runs inside `uppy.upload()`**. But restore reconnects and finishes the assembly **out-of-band**, via Transloadit's AssemblyWatcher, *not* through `#runUpload`.

So there are two parallel "completion" mechanisms that don't meet. Every bug hit — Done throws, `×` throws, Add-more blocked, the `complete` event never firing — is the *same* root: core still thinks an upload is in progress because the out-of-band path never told it otherwise. We were patching symptoms of that one divergence.

### 3. "Done" has three different definitions

`uploadComplete` (bytes sent) vs `progress.complete` (post-processing done) vs `isAllComplete` (derived, and **ignores errors**). Different consumers use different ones. The Done button used one; the cleanup used another; they disagreed exactly on errored files. When one concept has three subtly different encodings, any cross-cutting change has to reconcile them — and that is precisely where the final bug hid.

### 4. The "screen" is emergent, not owned

There is no single "recovery screen" component. It is the StatusBar's `getUploadingState`, StatusBarUI's `showUploadBtn`, and the Dashboard's banner each **independently** reading `recoveredState`. Nobody owns "are we in recovery UI?" So changing the behavior means touching every consumer that interprets the flag — which is why a one-line-feeling change fanned out across three packages.

### 5. Event-bus architecture distributes the logic

The flow only exists as a sequence of emissions (`restored` → reconnect → `postprocess-complete` → …) across core + golden-retriever + transloadit + tus + status-bar. There is no orchestrator to reason about end-to-end, so it is easy for one participant (core's `currentUploads`) to be left inconsistent because another (Transloadit) took a shortcut.

### What the *clean* fix would have been

The architecturally-correct version is to **not let restore bypass the lifecycle** — restore-of-an-already-uploaded assembly should re-enter the same completion path `uppy.upload()` uses (essentially what `restore-confirmed` → `uppy.restore(uploadId)` already does), so `currentUploads`, `complete`, and postprocessors all resolve through one path. Then `recoveredState` clears naturally and the UI needs *zero* special-casing.

Instead we patched the **display** and the **dangling state** separately, because making that re-entry automatic (without the user click) is a bigger, riskier core/transloadit change — the "state-machine fixes" the original PR #6278 was reaching for.

### Honest caveats

- **Not all of it was the architecture's fault — some was process.** Several rounds were lost suspecting the Vite cache instead of instrumenting. The moment the actual per-file state was dumped, the cause was obvious in one read. Evidence-first would have cut this in half.
- The remaining glitch (UI shows **Complete** when the restore actually *all-errored*) is the **same** root cause again — `isAllComplete` ignoring per-file errors. Worth fixing centrally rather than per-consumer.

### Takeaway

We were not fighting Uppy for no reason — we were fighting a genuine architectural gap: **completion isn't centralized, "recovered" is overloaded, and "done" isn't defined once.** The high-leverage follow-up is not more patches but unifying the restore completion path so this class of bug cannot recur.
