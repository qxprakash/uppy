import { describe, expect, it, vi, beforeEach } from 'vitest'
import Core from '@uppy/core'
import GoldenRetriever from './index.js'

describe('GoldenRetriever handleComplete', () => {
  let uppy: Core
  let goldenRetriever: GoldenRetriever<any, any>

  beforeEach(() => {
    uppy = new Core()
    goldenRetriever = new GoldenRetriever(uppy)
    uppy.use(goldenRetriever)
  })

  it('should preserve state when uploads are aborted with no successful files', () => {
    const mockSetState = vi.spyOn(uppy, 'setState')
    const mockLog = vi.spyOn(uppy, 'log')

    // Simulate aborted upload result (like Firefox page refresh)
    const abortedResult = {
      successful: [],
      failed: [
        {
          id: 'test-file-1',
          name: 'test.pdf',
          error: 'DOMException: Aborted',
        },
      ],
      uploadID: 'test-upload-1',
    }

    goldenRetriever.handleComplete(abortedResult as any)

    // Should log preservation message
    expect(mockLog).toHaveBeenCalledWith(
      '[GoldenRetriever] Upload was aborted, preserving state for recovery'
    )

    // Should NOT clear recovered state
    expect(mockSetState).not.toHaveBeenCalledWith({ recoveredState: null })
  })

  it('should cleanup state when uploads are successful', () => {
    const mockSetState = vi.spyOn(uppy, 'setState')
    const mockDeleteBlobs = vi.spyOn(goldenRetriever, 'deleteBlobs').mockResolvedValue()

    // Simulate successful upload result
    const successfulResult = {
      successful: [
        {
          id: 'test-file-1',
          name: 'test.pdf',
        },
      ],
      failed: [],
      uploadID: 'test-upload-1',
    }

    goldenRetriever.handleComplete(successfulResult as any)

    // Should cleanup blobs for successful files
    expect(mockDeleteBlobs).toHaveBeenCalledWith(['test-file-1'])

    // Should clear recovered state after successful uploads
    expect(mockSetState).toHaveBeenCalledWith({ recoveredState: null })
  })

  it('should not cleanup state when uploads fail due to other errors', () => {
    const mockSetState = vi.spyOn(uppy, 'setState')
    const mockLog = vi.spyOn(uppy, 'log')

    // Simulate failed upload result (non-abort error)
    const failedResult = {
      successful: [],
      failed: [
        {
          id: 'test-file-1',
          name: 'test.pdf',
          error: 'Network error: 500 Internal Server Error',
        },
      ],
      uploadID: 'test-upload-1',
    }

    goldenRetriever.handleComplete(failedResult as any)

    // Should NOT log preservation message for non-abort errors
    expect(mockLog).not.toHaveBeenCalledWith(
      '[GoldenRetriever] Upload was aborted, preserving state for recovery'
    )

    // Should NOT clear recovered state
    expect(mockSetState).not.toHaveBeenCalledWith({ recoveredState: null })
  })

  it('should handle mixed results with some successful and some aborted files', () => {
    const mockSetState = vi.spyOn(uppy, 'setState')
    const mockDeleteBlobs = vi.spyOn(goldenRetriever, 'deleteBlobs').mockResolvedValue()

    // Simulate mixed result (some successful, some aborted)
    const mixedResult = {
      successful: [
        {
          id: 'test-file-1',
          name: 'successful.pdf',
        },
      ],
      failed: [
        {
          id: 'test-file-2',
          name: 'aborted.pdf',
          error: 'AbortError: The operation was aborted',
        },
      ],
      uploadID: 'test-upload-1',
    }

    goldenRetriever.handleComplete(mixedResult as any)

    // Should cleanup blobs for successful files
    expect(mockDeleteBlobs).toHaveBeenCalledWith(['test-file-1'])

    // Should clear recovered state since we have successful uploads
    expect(mockSetState).toHaveBeenCalledWith({ recoveredState: null })
  })
})
