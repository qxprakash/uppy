import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'

const label = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/
const tld = /^([a-z]{2,}|xn--[a-z0-9-]{2,})$/

/**
 * Whether `url` is an absolute URL with one of `protocols` (e.g. `'https:'`)
 * and a valid host: an IP address, or a domain name whose labels are letters,
 * digits and inner hyphens. With `requireTld`, a domain name also needs a
 * top-level domain, so `localhost` and single-label intranet names fail.
 *
 * The URL is parsed with the WHATWG URL parser, which Node's HTTP clients use.
 * It is rejected when the host written in it (after `scheme://`, before the
 * first `/`, after any `user@`) is not the host that parser would request, so
 * spellings such as `http://0x7f.1/` or `http://a.com\@b.com` fail. Like
 * validator's `isURL`, strings with whitespace or `<>` and strings longer than
 * 2084 characters are rejected.
 */
export default function isURL(
  url: string,
  {
    protocols = ['http:', 'https:'],
    requireTld = false,
  }: { protocols?: string[]; requireTld?: boolean } = {},
): boolean {
  if (url.length > 2084 || /[\s<>]/.test(url)) return false
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(url)?.[1]
  if (
    !authority ||
    // an empty `@` or `:@` user info, or more than one `@`
    /^:?@/.test(authority) ||
    authority.indexOf('@') !== authority.lastIndexOf('@') ||
    // compatibility characters such as full-width letters
    authority.normalize('NFKC') !== authority
  ) {
    return false
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (!protocols.includes(parsed.protocol) || parsed.port === '0') return false

  const host = parsed.hostname
  const writtenHost = authority
    .slice(authority.lastIndexOf('@') + 1)
    .replace(/:\d*$/, '')
  // A backslash or percent-encoding in the host makes the parser read another one.
  if (/[\\%]/.test(writtenHost)) return false
  if (host.startsWith('[')) {
    return writtenHost.startsWith('[') && isIP(host.slice(1, -1)) === 6
  }
  if (isIP(host) === 4) return writtenHost === host
  if (domainToASCII(writtenHost.toLowerCase()) !== host) return false

  const labels = host.split('.')
  const last = labels.at(-1) ?? ''
  if (!labels.every((part) => label.test(part)) || /^\d+$/.test(last)) {
    return false
  }
  return !requireTld || (labels.length >= 2 && tld.test(last))
}
