import { posix } from 'node:path'
import type { Readable } from 'node:stream'
import { XMLParser } from 'fast-xml-parser'
import { openProtectedStream } from '../../helpers/request.js'
import { isRecord } from '../../helpers/type-guards.js'

/**
 * Upper bound on a WebDAV response that Companion buffers in memory (PROPFIND
 * listings and stat calls), counted after decompression. Without it an
 * anonymous caller pointing simple-auth at a hostile server could inflate a
 * small gzip body into hundreds of megabytes and abort the process. File
 * downloads are streamed and not limited by this.
 */
export const MAX_WEBDAV_RESPONSE_BYTES = 5 * 1024 * 1024

/** A non-2xx answer (or propstat status) from the WebDAV server. */
export class WebdavHttpError extends Error {
  status: number

  constructor(status: number, statusText: string | undefined) {
    super(`Invalid response: ${status} ${statusText ?? ''}`)
    this.name = 'WebdavHttpError'
    this.status = status
  }
}

export type WebdavFileStat = {
  /** Decoded path relative to the client's base URL, e.g. `/dir/a b.txt` */
  filename: string
  basename: string
  lastmod: string | null
  size: number
  type: 'file' | 'directory'
  /** Only for files; empty string when the server sent no content type */
  mime?: string
}

type RequestOptions = { signal?: AbortSignal }

const xmlParser = new XMLParser({
  allowBooleanAttributes: true,
  attributeNamePrefix: '@',
  textNodeName: 'text',
  ignoreAttributes: false,
  removeNSPrefix: true,
  numberParseOptions: { hex: true, leadingZeros: false },
  // the parser's current defaults, spelled out: responses come from servers
  // the client chose
  processEntities: { maxExpandedLength: 100_000, maxEntityCount: 1000 },
})

// Like encodeURIComponent, but keeps `/` (and `\\` pairs) as they are.
function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) =>
      segment.split('\\\\').map(encodeURIComponent).join('\\\\'),
    )
    .join('/')
}

function normalisePath(path: string): string {
  const withSlash = path.startsWith('/') ? path : `/${path}`
  return /^.+\/$/.test(withSlash) ? withSlash.slice(0, -1) : withSlash
}

// Joins the server URL and an encoded path: one `/` between parts, repeated
// trailing slashes on the last part collapsed into one.
function joinURL(...parts: string[]): string {
  const kept = parts.filter(
    (part, i) => i === 0 || part !== '/' || parts[i - 1] !== '/',
  )
  const last = kept.length - 1
  const segments: string[] = []
  kept.forEach((part, i) => {
    if (part === '') return
    let segment =
      i === 0
        ? part.replace(/^([^/:]+):\/*/, '$1://')
        : part.replace(/^\/+/, '')
    segment =
      i < last ? segment.replace(/\/+$/, '') : segment.replace(/\/+$/, '/')
    segments.push(segment)
  })
  const joined = segments.join('/').replace(/\/(\?|&|#[^!])/g, '$1')
  const [beforeQuery, ...query] = joined.split('?')
  return `${beforeQuery}${query.length > 0 ? `?${query.join('&')}` : ''}`
}

const firstOf = (value: unknown): unknown =>
  Array.isArray(value) ? value[0] : value

const toArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [value]

const asRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {}

/** Returns the `<response>` elements of a parsed multistatus document. */
function getResponses(xml: string): Record<string, unknown>[] {
  const parsed = asRecord(xmlParser.parse(xml))
  const multistatus = firstOf(parsed['multistatus'])
  if (multistatus === '') return []
  if (!isRecord(multistatus)) {
    throw new Error('Invalid response: No root multistatus found')
  }
  return toArray(multistatus['response']).filter(isRecord)
}

/** `HTTP/1.1 404 Not Found` -> `{ status: 404, statusText: 'Not Found' }` */
function parseStatusLine(line: unknown) {
  const [, code = '', ...text] = String(line ?? '').split(' ')
  return { status: parseInt(code, 10), statusText: text.join(' ') }
}

const isSuccess = (status: number) => status >= 200 && status < 300

/**
 * The `<propstat>` of a `<response>` that holds the found properties. A
 * server may list the missing ones (404) first, so prefer the 2xx block.
 */
function getPropstat(
  response: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const propstats = toArray(response['propstat']).filter(isRecord)
  return (
    propstats.find((propstat) =>
      isSuccess(parseStatusLine(propstat['status']).status),
    ) ?? propstats[0]
  )
}

const getProps = (propstat: Record<string, unknown> | undefined) =>
  asRecord(firstOf(propstat?.['prop']))

function fileFromProps(
  props: Record<string, unknown>,
  filename: string,
): WebdavFileStat {
  const lastmod = props['getlastmodified']
  const contentType = props['getcontenttype']
  const resourceType = props['resourcetype']
  const type =
    isRecord(resourceType) && resourceType['collection'] !== undefined
      ? 'directory'
      : 'file'
  return {
    filename,
    basename: posix.basename(filename),
    lastmod: lastmod == null ? null : String(lastmod),
    size: parseInt(String(props['getcontentlength'] ?? '0'), 10),
    type,
    ...(type === 'file' && {
      mime:
        typeof contentType === 'string' && contentType !== ''
          ? (contentType.split(';')[0] as string)
          : '',
    }),
  }
}

async function readBody(stream: Readable): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    total += chunk.length
    if (total > MAX_WEBDAV_RESPONSE_BYTES) {
      stream.destroy()
      throw new Error(
        `WebDAV response over limit: ${MAX_WEBDAV_RESPONSE_BYTES} bytes`,
      )
    }
    chunks.push(chunk)
  }
  // TextDecoder drops a leading byte order mark
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/**
 * A minimal read-only WebDAV client. Every request, and every redirect hop,
 * goes through openProtectedStream, so it gets Companion's SSRF checks.
 */
export function createWebdavClient({
  url,
  basicAuth,
  allowLocalUrls,
}: {
  url: string
  basicAuth?: { username: string; password: string } | undefined
  allowLocalUrls: boolean
}) {
  const { username, password, pathname } = new URL(url)
  if (username !== '' || password !== '') {
    // never sent: got would turn them into an Authorization header
    throw new TypeError('WebDAV URL must not contain credentials')
  }
  const headers: Record<string, string> = basicAuth
    ? {
        authorization: `Basic ${Buffer.from(`${basicAuth.username}:${basicAuth.password}`).toString('base64')}`,
      }
    : {}
  const serverBase = posix.join(pathname, '/')

  async function request(
    requestUrl: string,
    options: Record<string, unknown>,
  ): Promise<Readable> {
    const { stream, response } = await openProtectedStream(
      requestUrl,
      allowLocalUrls,
      options,
    )
    // a 3xx here is a redirect without a Location, nothing to follow
    if (!isSuccess(response.statusCode)) {
      // the body is not needed: drop the connection instead of reading it
      stream.destroy()
      throw new WebdavHttpError(response.statusCode, response.statusMessage)
    }
    return stream
  }

  function propfind(
    requestUrl: string,
    depth: '0' | '1',
    { signal }: RequestOptions,
  ): Promise<string> {
    return request(requestUrl, {
      method: 'PROPFIND',
      headers: { ...headers, accept: 'text/plain,application/xml', depth },
      // an empty body ends the request; got would otherwise wait for one
      body: '',
      signal,
    }).then(readBody)
  }

  return {
    /** Lists a collection (PROPFIND, Depth: 1), without the collection itself. */
    async getDirectoryContents(
      path: string,
      options: RequestOptions = {},
    ): Promise<WebdavFileStat[]> {
      const xml = await propfind(
        joinURL(url, encodePath(path), '/'),
        '1',
        options,
      )
      if (!xml) {
        throw new Error('Failed parsing directory contents: Empty response')
      }
      const requestPath = (path.startsWith('/') ? path : `/${path}`).replace(
        /\/$/,
        '',
      )
      return getResponses(xml)
        .filter(
          (response) =>
            response['href'] != null && response['propstat'] !== undefined,
        )
        .map((response) => {
          // the href is already XML-entity decoded by the parser
          const href = String(response['href']).replace(/^https?:\/\/[^/]+/, '')
          const filename =
            serverBase === '/'
              ? decodeURIComponent(normalisePath(href))
              : normalisePath(
                  posix.relative(
                    decodeURIComponent(serverBase),
                    decodeURIComponent(href),
                  ),
                )
          return fileFromProps(getProps(getPropstat(response)), filename)
        })
        .filter(
          (item) =>
            item.basename !== '' &&
            (item.type === 'file' || item.filename !== requestPath),
        )
    },

    /** Properties of a single resource (PROPFIND, Depth: 0). */
    async stat(
      path: string,
      options: RequestOptions = {},
    ): Promise<WebdavFileStat> {
      const xml = await propfind(joinURL(url, encodePath(path)), '0', options)
      const [response] = getResponses(xml)
      const propstat = response && getPropstat(response)
      if (propstat == null) {
        throw new Error('Failed getting item stat: bad response')
      }
      const { status, statusText } = parseStatusLine(propstat['status'])
      if (!Number.isNaN(status) && !isSuccess(status)) {
        throw new WebdavHttpError(status, statusText)
      }
      return fileFromProps(getProps(propstat), normalisePath(path))
    },

    /**
     * GETs a file. Resolves once a 2xx response is in, with the (decompressed)
     * body as a stream; a refused GET rejects with WebdavHttpError.
     */
    createReadStream(
      path: string,
      { signal }: RequestOptions = {},
    ): Promise<Readable> {
      return request(joinURL(url, encodePath(path)), {
        method: 'GET',
        headers: { ...headers, accept: '*/*' },
        signal,
      })
    },
  }
}

export type WebdavClient = ReturnType<typeof createWebdavClient>
