import { describe, expect, it, vi } from 'vitest'

import 'whatwg-fetch'
import Core, { type Meta, type UppyFile } from '@uppy/core'
import AwsS3, { type AwsBody, type AwsS3Options } from '../src/index.js'

const KB = 1024
const MB = KB * KB

/** Deferred helper for test control flow */
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('AwsS3', () => {
  it('Registers AwsS3 upload plugin', () => {
    const core = new Core().use(AwsS3, {
      bucket: 'test-bucket',
      region: 'us-east-1',
      endpoint: 'https://companion.example.com',
    })

    // @ts-expect-error private property
    const pluginNames = core[Symbol.for('uppy test: getPlugins')](
      'uploader',
    ).map((plugin: AwsS3<Meta, AwsBody>) => plugin.constructor.name)
    expect(pluginNames).toContain('AwsS3')
  })

  describe('configuration validation', () => {
    it('throws if bucket is not provided', () => {
      expect(() => {
        const core = new Core()
        // @ts-expect-error - testing missing required option
        core.use(AwsS3, {})
      }).toThrow('`bucket` option is required')
    })

    it('throws if region is not provided', () => {
      expect(() => {
        const core = new Core()
        core.use(AwsS3, { bucket: 'test-bucket' })
      }).toThrow('`region` option is required')
    })

    it('throws if no signing method is provided', () => {
      expect(() => {
        const core = new Core()
        core.use(AwsS3, { bucket: 'test-bucket', region: 'us-east-1' })
      }).toThrow('`endpoint`, `signRequest`, or `getCredentials` is required')
    })

    it('accepts endpoint option', () => {
      const core = new Core()
      core.use(AwsS3, {
        bucket: 'test-bucket',
        region: 'us-east-1',
        endpoint: 'https://companion.example.com',
      })
      expect(core.getPlugin('AwsS3')).toBeDefined()
    })

    it('accepts signRequest option', () => {
      const core = new Core()
      core.use(AwsS3, {
        bucket: 'test-bucket',
        region: 'us-east-1',
        signRequest: vi.fn(),
      })
      expect(core.getPlugin('AwsS3')).toBeDefined()
    })

    it('accepts getCredentials option', () => {
      const core = new Core()
      core.use(AwsS3, {
        bucket: 'test-bucket',
        region: 'us-east-1',
        getCredentials: vi.fn(),
      })
      expect(core.getPlugin('AwsS3')).toBeDefined()
    })
  })

  describe('shouldUseMultipart', () => {
    const MULTIPART_THRESHOLD = 100 * MB

    // Helper that creates a mock file without allocating memory
    const createFile = (size: number): UppyFile<Meta, AwsBody> =>
      ({
        name: 'test.dat',
        size,
        data: { size } as Blob,
      }) as unknown as UppyFile<Meta, AwsBody>

    it('defaults to multipart for files > 100MB', () => {
      const core = new Core<Meta, AwsBody>().use(AwsS3, {
        bucket: 'test-bucket',
        region: 'us-east-1',
        endpoint: 'https://companion.example.com',
      })
      const opts = core.getPlugin('AwsS3')!.opts as AwsS3Options<Meta, AwsBody>
      const shouldUseMultipart = opts.shouldUseMultipart as (
        file: UppyFile<Meta, AwsBody>,
      ) => boolean

      expect(shouldUseMultipart(createFile(MULTIPART_THRESHOLD + 1))).toBe(true)
      expect(shouldUseMultipart(createFile(MULTIPART_THRESHOLD))).toBe(false)
      expect(shouldUseMultipart(createFile(MULTIPART_THRESHOLD - 1))).toBe(
        false,
      )
      expect(shouldUseMultipart(createFile(0))).toBe(false)
    })

    it('handles very large files', () => {
      const core = new Core<Meta, AwsBody>().use(AwsS3, {
        bucket: 'test-bucket',
        region: 'us-east-1',
        endpoint: 'https://companion.example.com',
      })
      const opts = core.getPlugin('AwsS3')!.opts as AwsS3Options<Meta, AwsBody>
      const shouldUseMultipart = opts.shouldUseMultipart as (
        file: UppyFile<Meta, AwsBody>,
      ) => boolean

      expect(shouldUseMultipart(createFile(70 * 1024 * MB))).toBe(true) // 70GB
      expect(shouldUseMultipart(createFile(400 * 1024 * MB))).toBe(true) // 400GB
    })
  })

  describe('upload events', () => {
    it('emits upload-start when upload begins', async () => {
      const signRequest = vi.fn().mockRejectedValue(new Error('Test stop'))

      const core = new Core().use(AwsS3, {
        bucket: 'test-bucket',
        region: 'us-east-1',
        signRequest,
        shouldUseMultipart: false,
      })

      core.addFile({
        source: 'test',
        name: 'test.txt',
        type: 'text/plain',
        data: new File([new Uint8Array(1024)], 'test.txt'),
      })

      const uploadStartHandler = vi.fn()
      core.on('upload-start', uploadStartHandler)

      try {
        await core.upload()
      } catch {
        // Expected
      }

      expect(uploadStartHandler).toHaveBeenCalledTimes(1)
    })

    it('emits upload-error on failure', async () => {
      const signRequest = vi.fn().mockRejectedValue(new Error('Sign failed'))

      const core = new Core().use(AwsS3, {
        bucket: 'test-bucket',
        region: 'us-east-1',
        signRequest,
        shouldUseMultipart: false,
      })

      core.addFile({
        source: 'test',
        name: 'test.txt',
        type: 'text/plain',
        data: new File([new Uint8Array(1024)], 'test.txt'),
      })

      const uploadErrorHandler = vi.fn()
      core.on('upload-error', uploadErrorHandler)

      try {
        await core.upload()
      } catch {
        // Expected
      }

      expect(uploadErrorHandler).toHaveBeenCalledTimes(1)
    })
  })

  describe('abort', () => {
    it('aborts when file is removed', async () => {
      const signRequest = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 100)),
        )

      const core = new Core().use(AwsS3, {
        bucket: 'test-bucket',
        region: 'us-east-1',
        signRequest,
        shouldUseMultipart: false,
      })

      core.addFile({
        source: 'test',
        name: 'test.txt',
        type: 'text/plain',
        data: new File([new Uint8Array(1024)], 'test.txt'),
      })

      const fileId = Object.keys(core.getState().files)[0]
      const uploadPromise = core.upload()
      setTimeout(() => core.removeFile(fileId), 10)

      const result = await uploadPromise
      // When a file is removed mid-upload, it should not appear in successful uploads
      expect(result).toBeDefined()
      expect(result?.successful).toHaveLength(0)
    })

    it('aborts when cancelAll is called', async () => {
      const signRequest = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 100)),
        )

      const core = new Core().use(AwsS3, {
        bucket: 'test-bucket',
        region: 'us-east-1',
        signRequest,
        shouldUseMultipart: false,
      })

      core.addFile({
        source: 'test',
        name: 'test.txt',
        type: 'text/plain',
        data: new File([new Uint8Array(1024)], 'test.txt'),
      })

      const uploadPromise = core.upload()
      setTimeout(() => core.cancelAll(), 10)

      const result = await uploadPromise
      // When cancelAll is called, no files should complete successfully
      expect(result).toBeDefined()
      expect(result?.successful).toHaveLength(0)
    })
  })

  describe('queue integration', () => {
    it('default limit is 6', () => {
      const core = new Core<Meta, AwsBody>().use(AwsS3, {
        bucket: 'test-bucket',
        region: 'us-east-1',
        endpoint: 'https://companion.example.com',
      })
      const opts = core.getPlugin('AwsS3')!.opts as AwsS3Options<Meta, AwsBody>
      expect(opts.limit).toBe(6)
    })

    it('accepts custom limit option', () => {
      const core = new Core<Meta, AwsBody>().use(AwsS3, {
        bucket: 'test-bucket',
        region: 'us-east-1',
        endpoint: 'https://companion.example.com',
        limit: 3,
      })
      const opts = core.getPlugin('AwsS3')!.opts as AwsS3Options<Meta, AwsBody>
      expect(opts.limit).toBe(3)
    })

    it('queue concurrency is respected for simple uploads', async () => {
      let concurrent = 0
      let maxConcurrent = 0

      // signRequest never resolves — it stays pending so we can observe concurrency.
      // The queue will start `limit` tasks, each blocked on signRequest.
      const signRequest = vi.fn().mockImplementation(() => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        // Never resolve — keeps the queue slot occupied
        return new Promise(() => {})
      })

      const core = new Core().use(AwsS3, {
        bucket: 'test-bucket',
        region: 'us-east-1',
        signRequest,
        shouldUseMultipart: false,
        limit: 2,
      })

      // Add 4 small files
      for (let i = 0; i < 4; i++) {
        core.addFile({
          source: 'test',
          name: `file${i}.txt`,
          type: 'text/plain',
          data: new File([new Uint8Array(1024)], `file${i}.txt`),
        })
      }

      core.upload()

      // Wait for sign requests to be called (2 should start due to limit: 2)
      await vi.waitFor(() => {
        expect(signRequest).toHaveBeenCalledTimes(2)
      })

      // With limit: 2, max concurrent should be 2
      expect(maxConcurrent).toBe(2)
      expect(concurrent).toBe(2)

      // The remaining 2 files should NOT have started yet
      expect(signRequest).toHaveBeenCalledTimes(2)

      // Clean up
      core.cancelAll()
    })

    it('abort cancels running and queued tasks', async () => {
      const gates: Array<{ resolve: () => void }> = []

      const signRequest = vi.fn().mockImplementation(() => {
        const gate = deferred<void>()
        gates.push(gate)
        return gate.promise.then(() => ({
          url: 'https://test-bucket.s3.us-east-1.amazonaws.com/test',
        }))
      })

      const core = new Core().use(AwsS3, {
        bucket: 'test-bucket',
        region: 'us-east-1',
        signRequest,
        shouldUseMultipart: false,
        limit: 1,
      })

      core.addFile({
        source: 'test',
        name: 'file1.txt',
        type: 'text/plain',
        data: new File([new Uint8Array(1024)], 'file1.txt'),
      })
      core.addFile({
        source: 'test',
        name: 'file2.txt',
        type: 'text/plain',
        data: new File([new Uint8Array(1024)], 'file2.txt'),
      })

      const uploadPromise = core.upload()

      // Wait for first sign request
      await vi.waitFor(() => {
        expect(gates.length).toBe(1)
      })

      // Cancel all uploads
      core.cancelAll()

      const result = await uploadPromise
      expect(result?.successful).toHaveLength(0)

      // Second file should never have started signing (limit: 1 and we cancelled)
      // The signRequest was called once for the first file
      expect(signRequest).toHaveBeenCalledTimes(1)
    })

    it('file removal mid-upload aborts only that file', async () => {
      // signRequest never resolves, keeping uploads in the signing phase
      const signRequest = vi
        .fn()
        .mockImplementation(() => new Promise(() => {}))

      const core = new Core().use(AwsS3, {
        bucket: 'test-bucket',
        region: 'us-east-1',
        signRequest,
        shouldUseMultipart: false,
        limit: 2,
      })

      core.addFile({
        source: 'test',
        name: 'file1.txt',
        type: 'text/plain',
        data: new File([new Uint8Array(1024)], 'file1.txt'),
      })
      core.addFile({
        source: 'test',
        name: 'file2.txt',
        type: 'text/plain',
        data: new File([new Uint8Array(1024)], 'file2.txt'),
      })

      const fileIds = Object.keys(core.getState().files)
      core.upload()

      // With limit: 2, both files can start immediately
      await vi.waitFor(() => {
        expect(signRequest).toHaveBeenCalledTimes(2)
      })

      // Remove file1 — this aborts only file1's upload, file2 continues
      core.removeFile(fileIds[0])

      // file2 should still be in the upload state (not cancelled)
      const files = core.getState().files
      expect(Object.keys(files)).toHaveLength(1)
      expect(files[fileIds[1]]).toBeDefined()

      // Clean up
      core.cancelAll()
    })
  })
})
