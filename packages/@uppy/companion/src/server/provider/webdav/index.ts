import { validateURL } from '../../helpers/request.js'
import { isRecord } from '../../helpers/type-guards.js'
import logger from '../../logger.js'
import { ProviderApiError, ProviderAuthError } from '../error.js'
import { userError } from '../errorCodes.js'
import Provider, {
  type ProviderDownloadOptions,
  type ProviderDownloadResponse,
  type ProviderListOptions,
  type ProviderListResponse,
  type ProviderLogoutResponse,
  type ProviderSimpleAuthOptions,
} from '../Provider.js'
import {
  createWebdavClient,
  type WebdavClient,
  WebdavHttpError,
} from './client.js'

const defaultDirectory = '/'

type WebdavUserSession = { webdavUrl?: string }

type WebdavListItem = {
  isFolder: boolean
  icon: string
  id: string
  name: string
  modifiedDate?: string
  requestPath: string
  mimeType?: string
  size?: number
  thumbnail?: null
}

/**
 * Adapter for WebDAV servers that support simple auth (non-OAuth).
 */
export default class WebdavProvider extends Provider<WebdavUserSession> {
  requestTimeoutMs = 30_000
  static override get hasSimpleAuth() {
    return true
  }

  isAuthenticated({
    providerUserSession,
  }: {
    providerUserSession: WebdavUserSession
  }): boolean {
    return providerUserSession.webdavUrl != null
  }

  getClient({
    providerUserSession,
  }: {
    providerUserSession: WebdavUserSession
  }): WebdavClient {
    const webdavUrl = providerUserSession?.webdavUrl
    const { allowLocalUrls } = this
    if (
      webdavUrl == null ||
      webdavUrl.length === 0 ||
      !validateURL(webdavUrl, allowLocalUrls)
    ) {
      throw new Error('invalid public link url')
    }

    // Is this an ownCloud or Nextcloud public link URL? e.g. https://example.com/s/kFy9Lek5sm928xP
    // they have specific urls that we can identify
    // todo not sure if this is the right way to support nextcloud and other webdavs
    if (/\/s\/([^/]+)/.test(webdavUrl)) {
      const [baseURL, publicLinkToken] = webdavUrl.split('/s/')
      if (!baseURL) {
        throw new Error('invalid public link url')
      }

      return this.getClientHelper({
        url: `${baseURL.replace('/index.php', '')}/public.php/webdav/`,
        basicAuth: { username: publicLinkToken!, password: 'null' },
      })
    }

    // normal public WebDAV urls
    return this.getClientHelper({ url: webdavUrl })
  }

  override logout(): ProviderLogoutResponse {
    return { revoked: true }
  }

  override async simpleAuth({
    requestBody,
  }: ProviderSimpleAuthOptions): Promise<WebdavUserSession> {
    try {
      if (!isRecord(requestBody) || !isRecord(requestBody['form'])) {
        throw new Error('Invalid request body')
      }
      const webdavUrl = requestBody['form']['webdavUrl']
      if (typeof webdavUrl !== 'string' || webdavUrl.length === 0) {
        throw new Error('Missing webdavUrl')
      }

      const providerUserSession: WebdavUserSession = { webdavUrl }

      const client = await this.getClient({ providerUserSession })
      // call the list operation as a way to validate the url
      await client.getDirectoryContents(defaultDirectory, {
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      })

      return providerUserSession
    } catch (err) {
      const errForLog = err instanceof Error ? err : new Error(String(err))
      logger.error(errForLog, 'provider.webdav.error')
      const code = isRecord(err) ? err['code'] : undefined
      if (
        typeof code === 'string' &&
        ['ECONNREFUSED', 'ENOTFOUND'].includes(code)
      ) {
        throw userError('WEBDAV_CANNOT_CONNECT', 'Cannot connect to server')
      }
      throw err
    }
  }

  getClientHelper({
    url,
    basicAuth,
  }: {
    url: string
    basicAuth?: { username: string; password: string } | undefined
  }): WebdavClient {
    const { allowLocalUrls } = this
    if (!validateURL(url, allowLocalUrls)) {
      throw new Error('invalid webdav url')
    }
    return createWebdavClient({ url, basicAuth, allowLocalUrls })
  }

  override list({
    providerUserSession,
    query,
  }: ProviderListOptions<WebdavUserSession>): Promise<ProviderListResponse> {
    return this.withErrorHandling('provider.webdav.list.error', async () => {
      if (!this.isAuthenticated({ providerUserSession })) {
        throw new ProviderAuthError()
      }

      const data: { items: WebdavListItem[] } = { items: [] }
      const client = await this.getClient({ providerUserSession })

      const dir = await client.getDirectoryContents(
        (typeof query?.['directory'] === 'string'
          ? query?.['directory']
          : undefined) || '/',
        { signal: AbortSignal.timeout(this.requestTimeoutMs) },
      )

      dir.forEach((item) => {
        const isFolder = item.type === 'directory'
        // The server's own path for the item. Prefixing the client-supplied
        // route id instead let one request allocate (id length × item count)
        // bytes of strings, enough to exhaust the heap.
        const requestPath = encodeURIComponent(item.filename)

        let modifiedDate: string | undefined
        try {
          // no date from the server gives the epoch, new Date(0)
          modifiedDate = new Date(item.lastmod ?? 0).toISOString()
        } catch (_e) {
          // ignore invalid date from server
        }

        // Determine icon based on type and MIME type
        let icon = 'file'
        if (isFolder) {
          icon = 'folder'
        } else if (item.mime?.startsWith('video/')) {
          icon = 'video'
        }

        const listItem: WebdavListItem = {
          isFolder,
          icon,
          id: requestPath,
          name: item.basename,
          requestPath,
          ...(modifiedDate && { modifiedDate }),
          ...(!isFolder && {
            ...(item.mime != null && { mimeType: item.mime }),
            ...(item.size != null && { size: item.size }),
            thumbnail: null,
          }),
        }
        data.items.push(listItem)
      })

      return data
    })
  }

  override download({
    id,
    providerUserSession,
  }: ProviderDownloadOptions<WebdavUserSession>): Promise<ProviderDownloadResponse> {
    return this.withErrorHandling(
      'provider.webdav.download.error',
      async () => {
        const client = await this.getClient({ providerUserSession })
        const stat = await client.stat(id, {
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        })
        // Await the GET so a non-2xx (including a 3xx without a Location)
        // rejects here and gets mapped; the client drops the connection of a
        // refused GET. Bound only the wait for response
        // headers: a server that accepts the connection and never answers must
        // not pin the request. The body that follows is deliberately left
        // unbounded (a real download may be slow), so clear the timer once
        // headers are in.
        const ac = new AbortController()
        const timer = setTimeout(() => ac.abort(), this.requestTimeoutMs)
        try {
          const stream = await client.createReadStream(id, {
            signal: ac.signal,
          })
          return { stream, size: stat.size }
        } finally {
          clearTimeout(timer)
        }
      },
    )
  }

  override thumbnail(): Promise<never> {
    // not implementing this because a public thumbnail from webdav will be used instead
    logger.error(
      'call to thumbnail is not implemented',
      'provider.webdav.thumbnail.error',
    )
    throw new Error('call to thumbnail is not implemented')
  }

  protected override mapProviderError(err: unknown): unknown {
    const status = isRecord(err) ? err['status'] : undefined
    if (status === 401) return new ProviderAuthError()
    if (err instanceof WebdavHttpError) {
      return new ProviderApiError('WebDAV API error', err.status)
    }
    return err
  }
}
