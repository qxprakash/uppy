import { describe, expect, test } from 'vitest'
import isURL from '../dist/server/helpers/is-url.js'

describe('isURL', () => {
  test.each([
    'https://example.com',
    'http://example.com/a/b?c=d#e',
    'https://user:pass@sub.example.co.uk:8443/x',
    'http://127.0.0.1',
    'http://[::1]:3000/x',
    'http://xn--bcher-kva.example',
  ])('accepts %s', (url) => {
    expect(isURL(url, { requireTld: true })).toBe(true)
  })

  test.each([
    // not http(s)
    'ftp://example.com/file',
    'javascript:alert(1)',
    'file:///etc/passwd',
    // no scheme, or no `//`
    'example.com',
    '//example.com',
    'http:example.com',
    'http:/example.com',
    'https:////example.com',
    // the host the URL parser requests is not the one it appears to be
    'http://example.com\\@evil.com',
    'http://evil.com\\example.com',
    // IPv4 written in another form
    'http://0x7f.0.0.1/',
    'http://0177.0.0.1/',
    'http://2130706433/',
    'http://127.1/',
    // invalid hosts
    'http://ex_ample.com',
    'http://-example.com',
    'http://@example.com',
    'http://example.com:0',
    'http://example.com:65536',
    // whitespace, angle brackets, length
    'http://exa mple.com',
    ' http://example.com',
    'http://example.com/<x>',
    `https://example.com/${'x'.repeat(2080)}`,
  ])('rejects %s', (url) => {
    expect(isURL(url)).toBe(false)
  })

  test('requireTld rejects single-label hosts but not IP addresses', () => {
    expect(isURL('http://localhost:3020', { requireTld: true })).toBe(false)
    expect(isURL('http://intranet/files', { requireTld: true })).toBe(false)
    expect(isURL('http://example.c', { requireTld: true })).toBe(false)
    expect(isURL('http://localhost:3020')).toBe(true)
    expect(isURL('http://10.0.0.1:8080', { requireTld: true })).toBe(true)
  })

  test('protocols', () => {
    expect(isURL('ftp://example.com/file', { protocols: ['ftp:'] })).toBe(true)
    expect(isURL('https://example.com', { protocols: ['ftp:'] })).toBe(false)
  })
})
