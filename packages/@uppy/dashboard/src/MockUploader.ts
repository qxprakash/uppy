import { BasePlugin } from '@uppy/core'
import type { Uppy, UppyFile, UploadResult } from '@uppy/core'

interface MockUploaderOptions {
  id?: string
  shouldSucceed?: boolean
}

// eslint-disable-next-line @typescript-eslint/ban-types
export default class MockUploader extends BasePlugin<MockUploaderOptions, {}, {}> {
  private intervalId?: ReturnType<typeof setInterval>
  private activeUploads: Map<string, { interval: ReturnType<typeof setInterval>; progress: number }> = new Map()

  constructor(uppy: Uppy, opts?: MockUploaderOptions) {
    super(uppy, opts)
    this.type = 'uploader'
    this.id = this.opts.id || 'MockUploader'
    this.upload = this.upload.bind(this)
  }

  uploadFile(id: string): void {
    const file = this.uppy.getFile(id)
    if (file?.size == null) {
      return
    }

    // Set initial progress state
    this.uppy.setFileState(id, {
      progress: {
        uploadStarted: Date.now(),
        uploadComplete: false,
        percentage: 0,
        bytesUploaded: 0,
        bytesTotal: file.size,
      }
    })

    // Emit upload-start for all files being uploaded
    this.uppy.emit('upload-start', [file])

    let progress = 0
    const interval = setInterval(() => {
      const currentFile = this.uppy.getFile(id)
      if (!currentFile) {
        clearInterval(interval)
        this.activeUploads.delete(id)
        return
      }

      // Check if file is paused
      if (currentFile.isPaused) {
        return
      }

      progress += 20
      this.activeUploads.set(id, { interval, progress })

      // Update file progress state
      this.uppy.setFileState(id, {
        progress: {
          uploadStarted: currentFile.progress.uploadStarted || Date.now(),
          uploadComplete: false,
          percentage: progress,
          bytesUploaded: (progress / 100) * (currentFile.size || 0),
          bytesTotal: currentFile.size || 0,
        }
      })

      this.uppy.emit('upload-progress', currentFile, {
        uploadStarted: currentFile.progress.uploadStarted || Date.now(),
        bytesUploaded: (progress / 100) * (currentFile.size || 0),
        bytesTotal: currentFile.size || 0,
      })

      if (progress >= 100) {
        clearInterval(interval)
        this.activeUploads.delete(id)

        // Set final progress state
        this.uppy.setFileState(id, {
          progress: {
            uploadStarted: currentFile.progress.uploadStarted || Date.now(),
            uploadComplete: true,
            percentage: 100,
            bytesUploaded: currentFile.size || 0,
            bytesTotal: currentFile.size || 0,
          }
        })

        if (this.opts.shouldSucceed) {
          this.uppy.emit('upload-success', currentFile, {
            status: 200,
            uploadURL: `https://example.com/upload/${currentFile.name}`,
          })
        } else {
          this.uppy.emit('upload-error', currentFile, new Error('Upload failed'))
        }
      }
    }, 100)

    this.activeUploads.set(id, { interval, progress: 0 })
  }

  upload(fileIDs: string[]): Promise<void> {
    fileIDs.forEach((id) => this.uploadFile(id))
    return Promise.resolve()
  }

  install(): void {
    this.uppy.addUploader(this.upload)
    // Enable resumable uploads capability
    this.uppy.setState({
      capabilities: {
        ...this.uppy.getState().capabilities,
        resumableUploads: true,
      },
    })
  }

  uninstall(): void {
    // Clear all active uploads
    this.activeUploads.forEach(({ interval }) => {
      clearInterval(interval)
    })
    this.activeUploads.clear()

    clearInterval(this.intervalId)
    this.uppy.removeUploader(this.upload)
  }
}
