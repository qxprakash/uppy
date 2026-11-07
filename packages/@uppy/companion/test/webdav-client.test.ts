import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import ipaddr from 'ipaddr.js'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'
import { FORBIDDEN_IP_ADDRESS } from '../dist/server/helpers/request.js'
import {
  createWebdavClient,
  MAX_WEBDAV_RESPONSE_BYTES,
  WebdavHttpError,
} from '../dist/server/provider/webdav/client.js'

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void
type Seen = {
  method: string | undefined
  url: string | undefined
  depth: string | string[] | undefined
  accept: string | undefined
  authorization: string | undefined
}

let server: http.Server
let origin: string
let seen: Seen[] = []

const record = (req: http.IncomingMessage) => {
  seen.push({
    method: req.method,
    url: req.url,
    depth: req.headers.depth,
    accept: req.headers.accept,
    authorization: req.headers.authorization,
  })
}

const multistatus = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${body}</d:multistatus>`

const fileResponse = (href: string, length = '5') =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop>` +
  `<d:resourcetype/><d:getcontentlength>${length}</d:getcontentlength>` +
  '<d:getcontenttype>text/plain; charset=utf-8</d:getcontenttype>' +
  '<d:getlastmodified>Tue, 20 Oct 2026 10:00:00 GMT</d:getlastmodified>' +
  '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>'

const respondXml = (xml: string, status = 207): Handler => {
  return (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/xml' })
    res.end(xml)
  }
}

let handler: Handler = respondXml(multistatus(''))

beforeAll(async () => {
  server = http.createServer((req, res) => {
    record(req)
    req.resume()
    handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.close()
})

beforeEach(() => {
  seen = []
  handler = respondXml(multistatus(''))
})

afterEach(() => {
  vi.restoreAllMocks()
})

const client = (path = '/', options = {}) =>
  createWebdavClient({
    url: `${origin}${path}`,
    allowLocalUrls: true,
    ...options,
  })

describe('webdav client requests', () => {
  test('lists with PROPFIND Depth 1 on the encoded path', async () => {
    await client('/dav/').getDirectoryContents('/ü dir/100%/a#b?c')
    expect(seen).toEqual([
      {
        method: 'PROPFIND',
        url: '/dav/%C3%BC%20dir/100%25/a%23b%3Fc/',
        depth: '1',
        accept: 'text/plain,application/xml',
        authorization: undefined,
      },
    ])
  })

  test('joins the base URL and path with single slashes', async () => {
    await client('/dav').getDirectoryContents('/')
    await client('/dav/').getDirectoryContents('//a//b/')
    expect(seen.map((r) => r.url)).toEqual(['/dav/', '/dav/a//b/'])
  })

  test('stats with PROPFIND Depth 0 and downloads with GET', async () => {
    handler = (req, res) => {
      if (req.method === 'GET') {
        res.end('hello')
        return
      }
      respondXml(multistatus(fileResponse('/dav/a%20b.txt')))(req, res)
    }
    const c = client('/dav/')
    const stat = await c.stat('/a b.txt')
    const stream = await c.createReadStream('/a b.txt')
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk)
    expect(Buffer.concat(chunks).toString()).toBe('hello')
    expect(stat).toMatchObject({ filename: '/a b.txt', size: 5, type: 'file' })
    expect(seen.map(({ method, url, depth }) => [method, url, depth])).toEqual([
      ['PROPFIND', '/dav/a%20b.txt', '0'],
      ['GET', '/dav/a%20b.txt', undefined],
    ])
  })

  test('sends basic auth when given', async () => {
    await client('/', {
      basicAuth: { username: 'token', password: 'null' },
    }).getDirectoryContents('/')
    expect(seen[0]?.authorization).toBe(
      `Basic ${Buffer.from('token:null').toString('base64')}`,
    )
  })

  test.each([
    'http://u:p@127.0.0.1/',
    'http://u@127.0.0.1/',
    'http://:p@127.0.0.1/',
  ])('refuses a URL with embedded credentials (%s)', (url) => {
    for (const basicAuth of [undefined, { username: 't', password: 'null' }]) {
      expect(() =>
        createWebdavClient({ url, basicAuth, allowLocalUrls: true }),
      ).toThrow(TypeError)
    }
  })

  test('rejects a 3xx without a Location instead of using its body', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { 'content-type': 'text/html' })
      res.end('<p>moved</p>')
    }
    for (const call of [
      () => client().getDirectoryContents('/'),
      () => client().createReadStream('/a'),
    ]) {
      const err = await call().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(WebdavHttpError)
      expect((err as WebdavHttpError).status).toBe(302)
    }
  })

  test('rejects a non-2xx answer with its status', async () => {
    handler = (_req, res) => {
      res.writeHead(401, { 'www-authenticate': 'Basic' })
      res.end()
    }
    const err = await client()
      .getDirectoryContents('/')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WebdavHttpError)
    expect((err as WebdavHttpError).status).toBe(401)
  })
})

describe('webdav multistatus parsing', () => {
  test('maps responses to files and folders, without the listed folder', async () => {
    handler = respondXml(
      '<?xml version="1.0" encoding="utf-8"?>' +
        '<D:multistatus xmlns:D="DAV:" xmlns:lp1="DAV:">' +
        '<D:response><D:href>/dav/sub/</D:href><D:propstat><D:prop>' +
        '<D:resourcetype><D:collection/></D:resourcetype>' +
        '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>' +
        '<D:response><D:href>/dav/sub/%E4%B8%AD%20%25.txt</D:href><D:propstat><D:prop>' +
        '<D:resourcetype/><lp1:getcontentlength>12</lp1:getcontentlength>' +
        '<D:getcontenttype>text/plain; charset=utf-8</D:getcontenttype>' +
        '<lp1:getlastmodified>Tue, 20 Oct 2026 10:00:00 GMT</lp1:getlastmodified>' +
        '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>' +
        '<D:response><D:href>http://elsewhere.example/dav/sub/a&amp;b%3B.txt</D:href><D:propstat><D:prop>' +
        '<D:resourcetype/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>' +
        '<D:response><D:href>/dav/sub/folder/</D:href><D:propstat><D:prop>' +
        '<D:resourcetype><D:collection/></D:resourcetype>' +
        '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>' +
        '</D:multistatus>',
    )
    const items = await client('/dav/').getDirectoryContents('/sub')
    expect(items).toEqual([
      {
        filename: '/sub/中 %.txt',
        basename: '中 %.txt',
        lastmod: 'Tue, 20 Oct 2026 10:00:00 GMT',
        size: 12,
        type: 'file',
        mime: 'text/plain',
      },
      {
        filename: '/sub/a&b;.txt',
        basename: 'a&b;.txt',
        lastmod: null,
        size: 0,
        type: 'file',
        mime: '',
      },
      {
        filename: '/sub/folder',
        basename: 'folder',
        lastmod: null,
        size: 0,
        type: 'directory',
      },
    ])
  })

  test('reads a default-namespace document', async () => {
    handler = respondXml(
      '<multistatus xmlns="DAV:"><response><href>/x.txt</href><propstat><prop>' +
        '<resourcetype/><getcontentlength>3</getcontentlength>' +
        '</prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>',
    )
    const items = await client().getDirectoryContents('/')
    expect(items).toMatchObject([{ filename: '/x.txt', size: 3, type: 'file' }])
  })

  test('accepts a gzipped body with a byte order mark', async () => {
    handler = (_req, res) => {
      res.writeHead(207, {
        'content-type': 'application/xml',
        'content-encoding': 'gzip',
      })
      res.end(
        gzipSync(
          Buffer.concat([
            Buffer.from([0xef, 0xbb, 0xbf]),
            Buffer.from(multistatus(fileResponse('/a.txt'))),
          ]),
        ),
      )
    }
    const items = await client().getDirectoryContents('/')
    expect(items).toMatchObject([{ filename: '/a.txt', size: 5 }])
  })

  test('an empty multistatus is an empty listing', async () => {
    await expect(client().getDirectoryContents('/')).resolves.toEqual([])
  })

  test('a document without multistatus is an error', async () => {
    handler = respondXml('<html><body>not dav</body></html>', 200)
    await expect(client().getDirectoryContents('/')).rejects.toThrow(
      /No root multistatus/,
    )
  })

  test('a failed propstat in a stat answer is a WebdavHttpError', async () => {
    handler = respondXml(
      multistatus(
        '<d:response><d:href>/a</d:href><d:propstat><d:prop/>' +
          '<d:status>HTTP/1.1 403 Forbidden</d:status></d:propstat></d:response>',
      ),
    )
    const err = await client()
      .stat('/a')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WebdavHttpError)
    expect((err as WebdavHttpError).status).toBe(403)
  })

  test('reads the 2xx propstat when the 404 one comes first', async () => {
    const notFound =
      '<d:propstat><d:prop><d:getcontentlength/><d:getcontenttype/></d:prop>' +
      '<d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>'
    const found = (props: string) =>
      `<d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>`
    const file =
      `<d:response><d:href>/a.txt</d:href>${notFound}` +
      `${found('<d:resourcetype/><d:getcontentlength>7</d:getcontentlength>')}</d:response>`
    handler = respondXml(
      multistatus(
        `<d:response><d:href>/folder/</d:href>${notFound}` +
          `${found('<d:resourcetype><d:collection/></d:resourcetype>')}</d:response>${file}`,
      ),
    )
    await expect(client().getDirectoryContents('/')).resolves.toMatchObject([
      { filename: '/folder', type: 'directory' },
      { filename: '/a.txt', type: 'file', size: 7 },
    ])
    handler = respondXml(multistatus(file))
    await expect(client().stat('/a.txt')).resolves.toMatchObject({ size: 7 })
  })

  test('leaves nested entity references unexpanded', async () => {
    const entities = Array.from(
      { length: 10 },
      (_, i) => `<!ENTITY e${i + 1} "${`&e${i};`.repeat(10)}">`,
    ).join('')
    handler = respondXml(
      `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY e0 "lol">${entities}]>` +
        multistatus(fileResponse('/&e10;')),
    )
    await expect(client().getDirectoryContents('/')).resolves.toMatchObject([
      { filename: '/&e10;' },
    ])
  })

  test('refuses a document whose entities expand past the limit', async () => {
    handler = respondXml(
      `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "${'x'.repeat(9000)}">]>` +
        multistatus(fileResponse(`/${'&a;'.repeat(20)}`)),
    )
    await expect(client().getDirectoryContents('/')).rejects.toThrow(
      /limit exceeded/,
    )
  })
})

describe('webdav response size cap', () => {
  test('rejects a listing that inflates past the cap', async () => {
    const padding = ' '.repeat(MAX_WEBDAV_RESPONSE_BYTES + 1)
    let closed = false
    handler = (req, res) => {
      req.socket.once('close', () => {
        closed = true
      })
      res.writeHead(207, {
        'content-type': 'application/xml',
        'content-encoding': 'gzip',
      })
      res.end(gzipSync(multistatus(padding)))
    }
    await expect(client().getDirectoryContents('/')).rejects.toThrow(
      /over limit/,
    )
    await vi.waitFor(() => expect(closed).toBe(true))
  })

  test('does not cap downloads', async () => {
    const size = MAX_WEBDAV_RESPONSE_BYTES + 1024
    handler = (_req, res) => {
      res.writeHead(200, { 'content-length': String(size) })
      res.end(Buffer.alloc(size))
    }
    let bytes = 0
    for await (const chunk of await client().createReadStream('/big')) {
      bytes += chunk.length
    }
    expect(bytes).toBe(size)
  })
})

describe('webdav redirects', () => {
  test('follows a same-origin redirect with the same method and headers', async () => {
    handler = (req, res) => {
      if (req.url === '/old/') {
        res.writeHead(301, { location: '/new/' })
        res.end()
        return
      }
      respondXml(multistatus(fileResponse('/new/a.txt')))(req, res)
    }
    const items = await client('/', {
      basicAuth: { username: 'u', password: 'p' },
    }).getDirectoryContents('/old')
    expect(items).toMatchObject([{ filename: '/new/a.txt' }])
    expect(seen.map(({ method, url, depth }) => [method, url, depth])).toEqual([
      ['PROPFIND', '/old/', '1'],
      ['PROPFIND', '/new/', '1'],
    ])
    expect(seen[1]?.authorization).toBe(seen[0]?.authorization)
  })

  test('drops credentials on a redirect to another origin', async () => {
    const other = http.createServer((req, res) => {
      record(req)
      respondXml(multistatus(''))(req, res)
    })
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve))
    try {
      const otherOrigin = `http://127.0.0.1:${(other.address() as AddressInfo).port}`
      handler = (_req, res) => {
        res.writeHead(302, { location: `${otherOrigin}/` })
        res.end()
      }
      await client('/', {
        basicAuth: { username: 'u', password: 'p' },
      }).getDirectoryContents('/')
      expect(seen.map((r) => r.authorization)).toEqual([
        `Basic ${Buffer.from('u:p').toString('base64')}`,
        undefined,
      ])
    } finally {
      other.close()
    }
  })

  test('checks every redirect hop against the SSRF rules', async () => {
    // Pretend the test server is a public host, so that only the redirect
    // target, a link-local metadata address, is refused.
    const range = ipaddr.IPv4.prototype.range
    vi.spyOn(ipaddr.IPv4.prototype, 'range').mockImplementation(function (
      this: ipaddr.IPv4,
    ) {
      return this.toString() === '127.0.0.1' ? 'unicast' : range.call(this)
    })
    handler = (_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/' })
      res.end()
    }
    const c = createWebdavClient({ url: `${origin}/`, allowLocalUrls: false })
    await expect(c.getDirectoryContents('/')).rejects.toThrow(
      FORBIDDEN_IP_ADDRESS,
    )
    await expect(c.createReadStream('/a')).rejects.toThrow(FORBIDDEN_IP_ADDRESS)
    expect(seen).toHaveLength(2)
  })
})
