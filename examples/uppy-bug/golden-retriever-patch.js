// Temporary patch for Golden Retriever Firefox bug
// This should be integrated into the main Golden Retriever plugin

export function patchGoldenRetriever(goldenRetrieverInstance) {
  // Store original handleComplete method
  const originalHandleComplete = goldenRetrieverInstance.handleComplete;

  // Replace with patched version
  goldenRetrieverInstance.handleComplete = ({ successful, failed, uploadID }) => {
    console.log('🔧 PATCHED handleComplete called')
    console.log('- Successful:', successful?.length || 0)
    console.log('- Failed:', failed?.length || 0)
    console.log('- Upload ID:', uploadID)

    // Check if this completion is due to abort vs actual completion
    const wasAborted = failed?.some(file => {
      const errorStr = file.error?.toString() || '';
      return errorStr.includes('Aborted') ||
             errorStr.includes('AbortError') ||
             errorStr.includes('DOMException');
    });

    console.log('- Was aborted:', wasAborted)
    console.log('- Has successful uploads:', (successful?.length || 0) > 0)

    // Don't cleanup if all uploads failed/were aborted and we have no successful uploads
    if (wasAborted && (!successful || successful.length === 0)) {
      console.log('🛡️ PRESERVING state - uploads were aborted with no successful files')
      return;
    }

    // If we have successful uploads, proceed with normal cleanup
    if (successful && successful.length > 0) {
      console.log('✅ PROCEEDING with cleanup - we have successful uploads')
      originalHandleComplete.call(goldenRetrieverInstance, { successful, failed, uploadID });
    } else {
      console.log('⚠️ SKIPPING cleanup - no successful uploads to clean up')
    }
  };

  console.log('🔧 Golden Retriever patched for Firefox compatibility');
}
