import { BasePlugin } from '@uppy/core'

export default class MockUploader extends BasePlugin {
  constructor(uppy, opts) {
    super(uppy, opts)
    this.type = 'uploader'
    this.id = opts.id || 'MockUploader'
    this.shouldSucceed = opts.shouldSucceed ?? true
  }

  uploadFile(id) {
    const file = this.uppy.getFile(id)
    this.uppy.emit('upload-started', file)

    let progress = 0
    const interval = setInterval(() => {
      if (!this.uppy.getFile(id)) {
        clearInterval(interval)
        return
      }
      progress += 20
      this.uppy.emit('upload-progress', file, {
        uploader: this,
        bytesUploaded: (progress / 100) * file.size,
        bytesTotal: file.size,
      })
      if (progress >= 100) {
        clearInterval(interval)
        if (this.shouldSucceed) {
          this.uppy.emit('upload-success', file, {
            uploadURL: `https://example.com/upload/${file.name}`,
          })
        } else {
          this.uppy.emit('upload-error', file, new Error('Upload failed'))
        }
      }
    }, 100)
  }

  upload(fileIDs) {
    return Promise.resolve(fileIDs.forEach(id => this.uploadFile(id)))
  }
}
