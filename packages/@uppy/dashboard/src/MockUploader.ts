import { BasePlugin } from '@uppy/core'
import type { Uppy, UppyFile, UploadResult } from '@uppy/core'

interface MockUploaderOptions {
  id?: string
  shouldSucceed?: boolean
}

// eslint-disable-next-line @typescript-eslint/ban-types
export default class MockUploader extends BasePlugin<MockUploaderOptions, {}, {}> {
  private intervalId?: ReturnType<typeof setInterval>

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

    this.uppy.emit('upload-started', file)

    let progress = 0
    const interval = setInterval(() => {
      if (!this.uppy.getFile(id)) {
        clearInterval(interval)
        return
      }
      progress += 20
      this.uppy.emit('upload-progress', file, {
        uploadStarted: Date.now(),
        bytesUploaded: (progress / 100) * file.size,
        bytesTotal: file.size,
      })
      if (progress >= 100) {
        clearInterval(interval)
        if (this.opts.shouldSucceed) {
          const result: UploadResult<any, any> = {
            status: 200,
            uploadURL: `https://example.com/upload/${file.name}`,
          }
          this.uppy.emit('upload-success', file, result)
        } else {
          this.uppy.emit('upload-error', file, new Error('Upload failed'))
        }
      }
    }, 100)
  }

  upload(fileIDs: string[]): Promise<void> {
    fileIDs.forEach((id) => this.uploadFile(id))
    return Promise.resolve()
  }

  install(): void {
    this.uppy.addUploader(this.upload)
  }

  uninstall(): void {
    clearInterval(this.intervalId)
    this.uppy.removeUploader(this.upload)
  }
}
