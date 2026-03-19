import { afterEach, describe, expect, it, vi } from 'vitest'

import 'whatwg-fetch'
import Core, { type Meta, type UppyFile } from '@uppy/core'
import AwsS3, { type AwsBody, type AwsS3Options } from '../src/index.js'

const KB = 1024
const MB = KB * KB

// ============================================================================
// XHR Mock for simulating S3 upload responses
// ============================================================================

function createXHRMock(options?: {
  responseHeaders?: Record<string, string>
  status?: number
  responseText?: string
  delay?: number
  simulateNetworkError?: boolean
}) {
  const {
    responseHeaders = {},
    status = 200,
    responseText = '',
    delay = 0,
    simulateNetworkError = false,
  } = options ?? {}

  const OriginalXHR = globalThis.XMLHttpRequest
  const xhrInstances: InstanceType<typeof MockXHR>[] = []

  class MockXHR {
    status = 0
    responseType = ''
    responseText = ''
    readyState = 0
    withCredentials = false

    upload = {
      onprogress: null as ((ev: ProgressEvent) => void) | null,
    }

    onload: ((ev: Event) => void) | null = null
    onerror: ((ev: Event) => void) | null = null

    _method = ''
    _url = ''
    _headers: Record<string, string> = {}
    _body: unknown = null
    _aborted = false
    _responseHeaders: Record<string, string> = {
      etag: '"test-etag-123"',
      ...responseHeaders,
    }

    open(method: string, url: string) {
      this._method = method
      this._url = url
    }

    setRequestHeader(key: string, value: string) {
      this._headers[key] = value
    }

    getResponseHeader(name: string): string | null {
      return this._responseHeaders[name.toLowerCase()] ?? null
    }

    getAllResponseHeaders(): string {
      return Object.entries(this._responseHeaders)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n')
    }

    abort() {
      this._aborted = true
    }

    send(body?: unknown) {
      this._body = body
      xhrInstances.push(this)

      const respond = () => {
        if (this._aborted) return

        if (simulateNetworkError) {
          this.status = 0
          this.readyState = 4
          if (this.onerror) {
            this.onerror(new Event('error'))
          }
          return
        }

        const bodySize =
          body instanceof Blob
            ? body.size
            : typeof body === 'string'
              ? body.length
              : body instanceof ArrayBuffer
                ? body.byteLength
                : 0

        if (this.upload.onprogress) {
          this.upload.onprogress(
            new ProgressEvent('progress', {
              loaded: bodySize,
              total: bodySize,
              lengthComputable: true,
            }),
          )
        }

        this.status = status
        this.responseText = responseText
        this.readyState = 4

        if (this.onload) {
          this.onload(new Event('load'))
        }
      }

      if (delay > 0) {
        setTimeout(respond, delay)
      } else {
        queueMicrotask(respond)
      }
    }
  }

  globalThis.XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest

  return {
    instances: xhrInstances,
    MockXHR,
    restore() {
      globalThis.XMLHttpRequest = OriginalXHR
    },
  }
}

function createMultipartFetchMock(options?: {
  uploadId?: string
  onComplete?: (body: string) => void
  key?: string
}) {
  const {
    uploadId = 'test-upload-id',
    onComplete,
    key = 'test.dat',
  } = options ?? {}

  const origFetch = globalThis.fetch
  globalThis.fetch = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const method = init?.method ?? 'GET'
    const body = init?.body

    if (method === 'POST' && (!body || body === '')) {
      return new Response(
        `<InitiateMultipartUploadResult>
          <Bucket>test-bucket</Bucket>
          <Key>${key}</Key>
          <UploadId>${uploadId}</UploadId>
        </InitiateMultipartUploadResult>`,
        { status: 200, headers: { 'Content-Type': 'application/xml' } },
      )
    }

    if (
      method === 'POST' &&
      typeof body === 'string' &&
      body.includes('CompleteMultipartUpload')
    ) {
      onComplete?.(body)
      return new Response(
        `<CompleteMultipartUploadResult>
          <Location>https://test-bucket.s3.us-east-1.amazonaws.com/${key}</Location>
          <Bucket>test-bucket</Bucket>
          <Key>${key}</Key>
          <ETag>"final-etag"</ETag>
        </CompleteMultipartUploadResult>`,
        { status: 200, headers: { 'Content-Type': 'application/xml' } },
      )
    }

    if (method === 'GET') {
      return new Response(
        `<ListPartsResult>
          <Bucket>test-bucket</Bucket>
          <Key>${key}</Key>
          <UploadId>${uploadId}</UploadId>
        </ListPartsResult>`,
        { status: 200, headers: { 'Content-Type': 'application/xml' } },
      )
    }

    if (method === 'DELETE') {
      return new Response('', { status: 204 })
    }

    return new Response('', { status: 200 })
  }) as typeof fetch

  return {
    restore() {
      globalThis.fetch = origFetch
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers for multipart upload tests
// ---------------------------------------------------------------------------

/** Minimal XML responses that S3 returns for multipart operations */
const s3Responses = {
  createMultipart: (uploadId: string, key: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>
     <InitiateMultipartUploadResult>
       <UploadId>${uploadId}</UploadId>
       <Key>${key}</Key>
     </InitiateMultipartUploadResult>`,

  uploadPart: (etag: string) => '',

  listParts: (parts: { partNumber: number; etag: string }[]) =>
    `<?xml version="1.0" encoding="UTF-8"?>
     <ListPartsResult>
       ${parts.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`).join('')}
     </ListPartsResult>`,

  completeMultipart: (location: string, key: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>
     <CompleteMultipartUploadResult>
       <Location>${location}</Location>
       <Key>${key}</Key>
       <Bucket>test-bucket</Bucket>
     </CompleteMultipartUploadResult>`,

  abortMultipart: () => '',
}

/**
 * Creates mock signRequest + fetch for multipart upload tests.
 * signRequest encodes the operation in the URL so fetchMock can route correctly.
 */
function createMultipartMocks(opts: { uploadId?: string; key?: string } = {}) {
  const uploadId = opts.uploadId ?? 'test-upload-id'
  const key = opts.key ?? 'test-key'

  // signRequest encodes operation details in the URL for fetchMock routing
  const signRequest = vi.fn().mockImplementation(async (req: any) => {
    const params = new URLSearchParams()
    if (req.uploadId) params.set('uploadId', req.uploadId)
    if (req.partNumber) params.set('partNumber', String(req.partNumber))
    params.set('method', req.method)
    return {
      url: `https://test-bucket.s3.us-east-1.amazonaws.com/${req.key || key}?${params}`,
    }
  })

  const operations: string[] = []

  const fetchMock = vi
    .fn()
    .mockImplementation(async (url: string | Request, init?: any) => {
      const urlStr = typeof url === 'string' ? url : url.url
      const method = init?.method || 'GET'
      const params = new URL(urlStr).searchParams
      const hasUploadId = params.has('uploadId')

      if (method === 'POST' && !hasUploadId) {
        operations.push('createMultipart')
        return new Response(s3Responses.createMultipart(uploadId, key), {
          status: 200,
          headers: { 'Content-Type': 'application/xml' },
        })
      }
      if (method === 'PUT') {
        operations.push('uploadPart')
        return new Response('', {
          status: 200,
          headers: { ETag: '"etag-1"' },
        })
      }
      if (method === 'POST' && hasUploadId) {
        operations.push('completeMultipart')
        return new Response(
          s3Responses.completeMultipart(
            `https://test-bucket.s3.amazonaws.com/${key}`,
            key,
          ),
          { status: 200, headers: { 'Content-Type': 'application/xml' } },
        )
      }
      if (method === 'GET' && hasUploadId) {
        operations.push('listParts')
        return new Response(s3Responses.listParts([]), {
          status: 200,
          headers: { 'Content-Type': 'application/xml' },
        })
      }
      if (method === 'DELETE') {
        operations.push('abortMultipart')
        return new Response('', { status: 204 })
      }
      return new Response('Not Found', { status: 404 })
    })

  return { signRequest, fetchMock, operations, uploadId, key }
}

describe('AwsS3', () => {
  it('Registers AwsS3 upload plugin', () => {
    const core = new Core().use(AwsS3, {
      region: 'us-east-1',
      s3Endpoint: 'https://companion.example.com',
      companionEndpoint: 'https://companion.example.com',
    })

    const pluginNames = core[Symbol.for('uppy test: getPlugins')](
      'uploader',
    ).map((plugin: AwsS3<Meta, AwsBody>) => plugin.constructor.name)
    expect(pluginNames).toContain('AwsS3')
  })

  describe('configuration validation', () => {
    it('throws if no signing method is provided', () => {
      expect(() => {
        const core = new Core()
        core.use(AwsS3, {
          s3Endpoint: 'https://companion.example.com',
          region: 'us-east-1',
        })
      }).toThrow(
        'One of options `companionEndpoint`, `signRequest`, or `getCredentials` is required',
      )
    })

    it('accepts endpoint option', () => {
      const core = new Core()
      core.use(AwsS3, {
        s3Endpoint: 'https://companion.example.com',
        region: 'us-east-1',
        companionEndpoint: 'https://companion.example.com',
      })
      expect(core.getPlugin('AwsS3')).toBeDefined()
    })

    it('accepts signRequest option', () => {
      const core = new Core()
      core.use(AwsS3, {
        s3Endpoint: 'https://companion.example.com',
        region: 'us-east-1',
        signRequest: vi.fn(),
      })
      expect(core.getPlugin('AwsS3')).toBeDefined()
    })

    it('accepts getCredentials option', () => {
      const core = new Core()
      core.use(AwsS3, {
        s3Endpoint: 'https://companion.example.com',
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
        s3Endpoint: 'https://companion.example.com',
        region: 'us-east-1',
        companionEndpoint: 'https://companion.example.com',
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
        s3Endpoint: 'https://companion.example.com',
        region: 'us-east-1',
        companionEndpoint: 'https://companion.example.com',
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
        s3Endpoint: 'https://companion.example.com',
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
        s3Endpoint: 'https://companion.example.com',
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
        s3Endpoint: 'https://companion.example.com',
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
        s3Endpoint: 'https://companion.example.com',
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

  describe('Golden Retriever resume state (s3Multipart)', () => {
    const originalFetch = globalThis.fetch

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    it('persists s3Multipart on file state after creating multipart upload', async () => {
      const { signRequest, fetchMock, uploadId } = createMultipartMocks()
      // After createMultipart succeeds, hang on uploadPart so we can inspect state
      fetchMock.mockImplementation(
        async (url: string | Request, init?: any) => {
          const urlStr = typeof url === 'string' ? url : url.url
          const method = init?.method || 'GET'
          const hasUploadId = new URL(urlStr).searchParams.has('uploadId')

          if (method === 'POST' && !hasUploadId) {
            return new Response(
              s3Responses.createMultipart(uploadId, 'test-key'),
              { status: 200, headers: { 'Content-Type': 'application/xml' } },
            )
          }
          // Hang on everything else — we only need createMultipart to complete
          return new Promise(() => {})
        },
      )
      globalThis.fetch = fetchMock

      const core = new Core().use(AwsS3, {
        s3Endpoint: 'https://companion.example.com',
        region: 'us-east-1',
        signRequest,
        shouldUseMultipart: true,
      })

      const fileId = core.addFile({
        source: 'test',
        name: 'big.dat',
        type: 'application/octet-stream',
        data: new File([new Uint8Array(6 * MB)], 'big.dat'),
      })

      const uploadPromise = core.upload()

      // Wait for createMultipart to complete and state to be persisted
      await new Promise((resolve) => setTimeout(resolve, 100))

      const file = core.getFile(fileId)
      expect(file.s3Multipart).toBeDefined()
      expect(file.s3Multipart?.uploadId).toBe(uploadId)

      // Clean up
      core.cancelAll()
      await uploadPromise
    })

    it('clears s3Multipart when upload is aborted via cancelAll', async () => {
      const { signRequest, fetchMock } = createMultipartMocks()
      fetchMock.mockImplementation(
        async (url: string | Request, init?: any) => {
          const urlStr = typeof url === 'string' ? url : url.url
          const method = init?.method || 'GET'
          const hasUploadId = new URL(urlStr).searchParams.has('uploadId')

          if (method === 'POST' && !hasUploadId) {
            return new Response(
              s3Responses.createMultipart('cancel-test-id', 'cancel-key'),
              { status: 200, headers: { 'Content-Type': 'application/xml' } },
            )
          }
          if (method === 'DELETE') {
            return new Response('', { status: 204 })
          }
          // Hang on everything else
          return new Promise(() => {})
        },
      )
      globalThis.fetch = fetchMock

      const core = new Core().use(AwsS3, {
        s3Endpoint: 'https://companion.example.com',
        region: 'us-east-1',
        signRequest,
        shouldUseMultipart: true,
      })

      const fileId = core.addFile({
        source: 'test',
        name: 'big.dat',
        type: 'application/octet-stream',
        data: new File([new Uint8Array(6 * MB)], 'big.dat'),
      })

      const uploadPromise = core.upload()

      // Wait for createMultipart, then cancel
      await new Promise((resolve) => setTimeout(resolve, 50))
      core.cancelAll()

      await uploadPromise

      const file = core.getFile(fileId)
      // s3Multipart should be cleared so retries don't use a dead uploadId
      expect(file?.s3Multipart).toBeUndefined()
    })

    it('uses persisted s3Multipart key for resume (listParts, not createMultipart)', async () => {
      const persistedKey = 'persisted-object-key'
      const persistedUploadId = 'persisted-upload-id'
      const { signRequest, fetchMock, operations } = createMultipartMocks({
        uploadId: persistedUploadId,
        key: persistedKey,
      })
      globalThis.fetch = fetchMock

      const core = new Core().use(AwsS3, {
        s3Endpoint: 'https://companion.example.com',
        region: 'us-east-1',
        signRequest,
        shouldUseMultipart: false, // Would normally be simple upload
      })

      const fileId = core.addFile({
        source: 'test',
        name: 'big.dat',
        type: 'application/octet-stream',
        data: new File([new Uint8Array(6 * MB)], 'big.dat'),
      })

      // Simulate Golden Retriever restoring s3Multipart state
      core.setFileState(fileId, {
        s3Multipart: { uploadId: persistedUploadId, key: persistedKey },
      })

      const uploadPromise = core.upload()

      // Wait for the resume flow to call listParts (via fetch), then cancel
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Should have resumed (listParts) instead of creating a new multipart upload
      expect(operations).toContain('listParts')
      expect(operations).not.toContain('createMultipart')

      // The signRequest calls should use the persisted key, not a generated one
      const signedKeys = signRequest.mock.calls.map((call: any) => call[0].key)
      expect(signedKeys.every((k: string) => k === persistedKey)).toBe(true)

      // Clean up
      core.cancelAll()
      await uploadPromise
    })
  })

  // ==========================================================================
  // Regression tests for GitHub issues
  // ==========================================================================

  describe('regression: #5672 — upload-error event includes error object', () => {
    it('passes the error object to upload-error event handlers', async () => {
      const signRequest = vi
        .fn()
        .mockRejectedValue(new Error('Signing failed: 403 Forbidden'))

      const core = new Core().use(AwsS3, {
        s3Endpoint: 'https://test-bucket.s3.us-east-1.amazonaws.com',
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

      const errorHandler = vi.fn()
      core.on('upload-error', errorHandler)

      try {
        await core.upload()
      } catch {
        // Expected
      }

      expect(errorHandler).toHaveBeenCalledTimes(1)
      const [file, error] = errorHandler.mock.calls[0] as [
        UppyFile<Meta, AwsBody>,
        Error,
      ]
      expect(file).toBeDefined()
      expect(file.name).toBe('test.txt')
      expect(error).toBeDefined()
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('Signing failed')
    })
  })

  describe('regression: #5667 — multipart parts must only contain partNumber and etag', () => {
    it('s3-multipart:part-uploaded event only contains PartNumber and ETag', async () => {
      const xhrMock = createXHRMock({
        responseHeaders: {
          etag: '"abc123"',
          'content-length': '5242880',
          'x-amz-request-id': 'ABCD1234',
          server: 'MinIO',
          'accept-ranges': 'bytes',
          vary: 'Origin',
        },
      })

      const fetchMock = createMultipartFetchMock({ uploadId: 'upload-id-123' })

      try {
        const signRequest = vi.fn().mockResolvedValue({
          url: 'https://test-bucket.s3.us-east-1.amazonaws.com/test.dat?X-Amz-Signature=abc',
        })

        const core = new Core().use(AwsS3, {
          s3Endpoint: 'https://test-bucket.s3.us-east-1.amazonaws.com',
          region: 'us-east-1',
          signRequest,
          shouldUseMultipart: true,
        })

        core.addFile({
          source: 'test',
          name: 'test.dat',
          type: 'application/octet-stream',
          data: new File([new Uint8Array(10 * MB)], 'test.dat'),
        })

        const partEvents: { PartNumber: number; ETag: string }[] = []
        core.on('s3-multipart:part-uploaded', (_file, part) => {
          partEvents.push(part)
        })

        await core.upload()

        expect(partEvents.length).toBeGreaterThan(0)
        for (const part of partEvents) {
          const keys = Object.keys(part)
          expect(keys).toContain('PartNumber')
          expect(keys).toContain('ETag')
          expect(keys).not.toContain('content-length')
          expect(keys).not.toContain('x-amz-request-id')
          expect(keys).not.toContain('server')
          expect(keys.length).toBe(2)
        }
      } finally {
        xhrMock.restore()
        fetchMock.restore()
      }
    })
  })

  describe('regression: #5328 — completeMultipartUpload XML must be well-formed', () => {
    it('sends properly structured XML with one Part element per part', async () => {
      const xhrMock = createXHRMock({
        responseHeaders: { etag: '"part-etag-1"' },
      })

      let completionRequestBody = ''
      const fetchMock = createMultipartFetchMock({
        uploadId: 'test-upload-id',
        onComplete: (body) => {
          completionRequestBody = body
        },
      })

      try {
        const signRequest = vi.fn().mockResolvedValue({
          url: 'https://test-bucket.s3.us-east-1.amazonaws.com/test.dat?X-Amz-Signature=abc',
        })

        const core = new Core().use(AwsS3, {
          s3Endpoint: 'https://test-bucket.s3.us-east-1.amazonaws.com',
          region: 'us-east-1',
          signRequest,
          shouldUseMultipart: true,
        })

        core.addFile({
          source: 'test',
          name: 'test.dat',
          type: 'application/octet-stream',
          data: new File([new Uint8Array(10 * MB)], 'test.dat'),
        })

        await core.upload()

        expect(completionRequestBody).toBeTruthy()
        expect(completionRequestBody).toContain('<CompleteMultipartUpload>')
        expect(completionRequestBody).toContain('</CompleteMultipartUpload>')

        const partMatches = completionRequestBody.match(/<Part>/g)
        expect(partMatches).toBeTruthy()
        expect(partMatches!.length).toBe(2)

        const partNumberMatches = completionRequestBody.match(
          /<PartNumber>\d+<\/PartNumber>/g,
        )
        expect(partNumberMatches).toBeTruthy()
        expect(partNumberMatches!.length).toBe(2)

        expect(completionRequestBody).toContain('<PartNumber>1</PartNumber>')
        expect(completionRequestBody).toContain('<PartNumber>2</PartNumber>')
      } finally {
        xhrMock.restore()
        fetchMock.restore()
      }
    })
  })

  describe('regression: #5594 — simple upload succeeds even without ETag in response', () => {
    let xhrMock: ReturnType<typeof createXHRMock>

    afterEach(() => {
      xhrMock?.restore()
    })

    it('completes simple upload successfully when response has no ETag header', async () => {
      xhrMock = createXHRMock({
        responseHeaders: {},
      })

      const signRequest = vi.fn().mockResolvedValue({
        url: 'https://test-bucket.s3.us-east-1.amazonaws.com/test.txt?X-Amz-Signature=abc',
      })

      const core = new Core().use(AwsS3, {
        s3Endpoint: 'https://test-bucket.s3.us-east-1.amazonaws.com',
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

      const successHandler = vi.fn()
      core.on('upload-success', successHandler)

      const result = await core.upload()

      expect(successHandler).toHaveBeenCalledTimes(1)
      expect(result?.successful).toHaveLength(1)

      const [, response] = successHandler.mock.calls[0] as [unknown, any]
      expect(response.uploadURL).toBeTruthy()
      expect(response.body.key).toBeTruthy()
    })
  })

  describe('regression: #4313 — each upload attempt gets its own uploadId', () => {
    it('separate files each get their own uploadId (no cross-file caching)', async () => {
      const uploadIds: string[] = []
      let uploadIdCounter = 0

      const xhrMock = createXHRMock({
        responseHeaders: { etag: '"test-etag"' },
      })

      const origFetch = globalThis.fetch
      globalThis.fetch = (async (
        _input: string | URL | Request,
        init?: RequestInit,
      ) => {
        const method = init?.method ?? 'GET'
        const body = init?.body

        if (method === 'POST' && (!body || body === '')) {
          uploadIdCounter++
          const id = `upload-id-${uploadIdCounter}`
          uploadIds.push(id)
          return new Response(
            `<InitiateMultipartUploadResult>
              <UploadId>${id}</UploadId>
            </InitiateMultipartUploadResult>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          )
        }
        if (
          method === 'POST' &&
          typeof body === 'string' &&
          body.includes('CompleteMultipartUpload')
        ) {
          return new Response(
            `<CompleteMultipartUploadResult>
              <Location>https://test-bucket.s3.amazonaws.com/test.dat</Location>
              <Bucket>test-bucket</Bucket>
              <Key>test.dat</Key>
              <ETag>"final"</ETag>
            </CompleteMultipartUploadResult>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          )
        }
        return new Response('', { status: 200 })
      }) as typeof fetch

      try {
        const signRequest = vi.fn().mockResolvedValue({
          url: 'https://test-bucket.s3.us-east-1.amazonaws.com/test.dat?X-Amz-Signature=abc',
        })

        const core = new Core().use(AwsS3, {
          s3Endpoint: 'https://test-bucket.s3.us-east-1.amazonaws.com',
          region: 'us-east-1',
          signRequest,
          shouldUseMultipart: true,
        })

        core.addFile({
          source: 'test',
          name: 'file1.dat',
          type: 'application/octet-stream',
          data: new File([new Uint8Array(10 * MB)], 'file1.dat'),
        })
        core.addFile({
          source: 'test',
          name: 'file2.dat',
          type: 'application/octet-stream',
          data: new File([new Uint8Array(10 * MB)], 'file2.dat'),
        })

        await core.upload()

        expect(uploadIds).toHaveLength(2)
        expect(uploadIds[0]).toBe('upload-id-1')
        expect(uploadIds[1]).toBe('upload-id-2')
        expect(uploadIds[0]).not.toBe(uploadIds[1])
      } finally {
        xhrMock.restore()
        globalThis.fetch = origFetch
      }
    })
  })

  describe('regression: #5429 — pause/resume works with prefixed keys', () => {
    it('supports keys with nested path prefixes without breaking', async () => {
      const xhrMock = createXHRMock({
        responseHeaders: { etag: '"prefix-etag"' },
        delay: 30,
      })

      const fetchMock = createMultipartFetchMock({
        uploadId: 'prefix-upload-id',
        key: 'uploads/user-123/test.dat',
      })

      try {
        const signedKeys: string[] = []
        const signRequest = vi.fn().mockImplementation((request: any) => {
          signedKeys.push(request.key)
          return Promise.resolve({
            url: `https://test-bucket.s3.us-east-1.amazonaws.com/${request.key}?X-Amz-Signature=abc`,
          })
        })

        const core = new Core().use(AwsS3, {
          s3Endpoint: 'https://test-bucket.s3.us-east-1.amazonaws.com',
          region: 'us-east-1',
          signRequest,
          shouldUseMultipart: true,
          generateObjectKey: () => 'uploads/user-123/test.dat',
        })

        core.addFile({
          source: 'test',
          name: 'test.dat',
          type: 'application/octet-stream',
          data: new File([new Uint8Array(10 * MB)], 'test.dat'),
        })

        const successHandler = vi.fn()
        core.on('upload-success', successHandler)

        const result = await core.upload()

        expect(successHandler).toHaveBeenCalledTimes(1)
        expect(result?.successful).toHaveLength(1)

        for (const key of signedKeys) {
          expect(key).toBe('uploads/user-123/test.dat')
        }
      } finally {
        xhrMock.restore()
        fetchMock.restore()
      }
    })
  })

  describe('regression: #5230 — error during upload does not abort multipart on S3', () => {
    it('does not send DELETE (AbortMultipartUpload) when uploadPart fails', async () => {
      const xhrMock = createXHRMock({ simulateNetworkError: true })

      let deleteRequestMade = false
      let createMultipartCalled = false
      const origFetch = globalThis.fetch
      globalThis.fetch = (async (
        _input: string | URL | Request,
        init?: RequestInit,
      ) => {
        const method = init?.method ?? 'GET'
        const body = init?.body

        if (method === 'POST' && (!body || body === '')) {
          createMultipartCalled = true
          return new Response(
            `<InitiateMultipartUploadResult>
              <UploadId>preserve-me-upload-id</UploadId>
            </InitiateMultipartUploadResult>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          )
        }

        if (method === 'DELETE') {
          deleteRequestMade = true
          return new Response('', { status: 204 })
        }

        return new Response('', { status: 200 })
      }) as typeof fetch

      try {
        const signRequest = vi.fn().mockResolvedValue({
          url: 'https://test-bucket.s3.us-east-1.amazonaws.com/test.dat?X-Amz-Signature=abc',
        })

        const core = new Core().use(AwsS3, {
          s3Endpoint: 'https://test-bucket.s3.us-east-1.amazonaws.com',
          region: 'us-east-1',
          signRequest,
          shouldUseMultipart: true,
        })

        core.addFile({
          source: 'test',
          name: 'test.dat',
          type: 'application/octet-stream',
          data: new File([new Uint8Array(10 * MB)], 'test.dat'),
        })

        const errorHandler = vi.fn()
        core.on('upload-error', errorHandler)

        try {
          await core.upload()
        } catch {
          // Expected
        }

        expect(createMultipartCalled).toBe(true)
        expect(errorHandler).toHaveBeenCalledTimes(1)
        expect(deleteRequestMade).toBe(false)
      } finally {
        xhrMock.restore()
        globalThis.fetch = origFetch
      }
    })
  })

  describe('regression: #3447 — upload-success is emitted exactly once per file', () => {
    it('emits upload-success exactly once per file when uploading multiple files', async () => {
      const xhrMock = createXHRMock()

      try {
        const signRequest = vi.fn().mockResolvedValue({
          url: 'https://test-bucket.s3.us-east-1.amazonaws.com/test.dat?X-Amz-Signature=abc',
        })

        const core = new Core().use(AwsS3, {
          s3Endpoint: 'https://test-bucket.s3.us-east-1.amazonaws.com',
          region: 'us-east-1',
          signRequest,
          shouldUseMultipart: false,
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
          data: new File([new Uint8Array(2048)], 'file2.txt'),
        })

        const successCountByFile: Record<string, number> = {}
        core.on('upload-success', (file) => {
          if (!file) return
          successCountByFile[file.name] =
            (successCountByFile[file.name] || 0) + 1
        })

        await core.upload()

        expect(successCountByFile['file1.txt']).toBe(1)
        expect(successCountByFile['file2.txt']).toBe(1)

        const totalEvents = Object.values(successCountByFile).reduce(
          (a, b) => a + b,
          0,
        )
        expect(totalEvents).toBe(2)
      } finally {
        xhrMock.restore()
      }
    })
  })
})
