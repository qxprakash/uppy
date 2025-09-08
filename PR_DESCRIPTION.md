# Fix Golden Retriever state cleanup on Firefox page refresh

## 🐛 **Problem**

Golden Retriever fails to recover files in Firefox when users refresh the page during upload. This works correctly in Chrome but breaks in Firefox due to browser-specific differences in how aborted uploads are handled.

### Root Cause

1. **User refreshes page during upload** → Browser aborts ongoing requests via `AbortController`
2. **Firefox immediately fires `complete` event** with empty `successful` array and `failed` array containing abort errors
3. **Golden Retriever's `handleComplete` always cleans up state** → localStorage cleared
4. **Page reloads with no saved state** → Recovery fails

### Browser Differences

- **Firefox**: Aggressively fires completion events when requests are aborted
- **Chrome**: Handles aborted requests more gracefully, doesn't immediately fire `complete` event

## 🛠️ **Solution**

Modify `handleComplete` to preserve state when uploads are aborted with no successful files:

### Before
```typescript
handleComplete = ({ successful }: UploadResult<M, B>): void => {
  const fileIDs = successful!.map((file) => file.id)  // Empty in Firefox!
  // Always cleans up state, even when successful is empty
  this.uppy.setState({ recoveredState: null })
  MetaDataStore.cleanup(this.uppy.opts.id)  // ← CLEARS localStorage
}
```

### After
```typescript
handleComplete = ({ successful, failed }: UploadResult<M, B>): void => {
  // Don't cleanup state if no files were successfully uploaded
  if (!successful || successful.length === 0) {
    // Log if uploads were aborted (helps with debugging)
    const wasAborted = failed?.some((file) => {
      const errorStr = file.error?.toString() || ''
      return errorStr.includes('Aborted') || errorStr.includes('AbortError') || errorStr.includes('DOMException')
    })
    if (wasAborted) {
      this.uppy.log('[GoldenRetriever] Upload was aborted, preserving state for recovery')
    }
    return  // ← PRESERVE state for recovery
  }

  // Only cleanup when we actually have successful uploads
  // ... cleanup logic
}
```

## ✅ **Testing**

### Manual Test
1. Add files to upload in Firefox
2. Start upload process
3. Immediately refresh page
4. **Before**: No files recovered, localStorage empty
5. **After**: Files recovered as ghost files, state preserved

### Automated Test
Added comprehensive test coverage in `index.test.ts`:
- ✅ Preserves state when uploads are aborted with no successful files
- ✅ Cleans up state when uploads are successful
- ✅ Handles mixed results (some successful, some aborted)
- ✅ Doesn't cleanup for non-abort errors

## 🔄 **Behavior Changes**

### No Breaking Changes
- **Existing functionality preserved**: Normal upload completion still works
- **Chrome behavior unchanged**: Already worked correctly
- **Firefox now matches Chrome**: State preserved on page refresh

### New Behavior
- **Aborted uploads with no successful files**: State preserved for recovery
- **Mixed results**: Still cleanup successful files, preserve failed ones
- **Better logging**: Clear indication when state is preserved due to aborts

## 📊 **Impact**

- **Fixes Firefox Golden Retriever recovery**
- **No performance impact**: Minimal additional logic
- **Better debugging**: Enhanced logging for abort scenarios
- **Cross-browser consistency**: Firefox now behaves like Chrome

## 🧪 **Reproduction Steps**

### Before Fix (Firefox)
1. Start file upload
2. Refresh page immediately
3. See abort errors in console
4. No files recovered on reload

### After Fix (Firefox)
1. Start file upload
2. Refresh page immediately
3. See "preserving state for recovery" log
4. Files recovered as ghost files on reload

---

**Fixes**: Firefox Golden Retriever state cleanup bug
**Type**: Bug fix
**Breaking**: No
**Browser**: Firefox compatibility improvement
