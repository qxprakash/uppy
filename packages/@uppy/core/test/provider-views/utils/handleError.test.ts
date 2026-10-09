import { describe, expect, it } from 'vitest'
import Core from '../../../lib/index.js'
import handleError from '../../../lib/provider-views/utils/handleError.js'
import { UserFacingApiError } from '../../../lib/utils/index.js'

const shownMessages = (err: unknown, opts?: { alwaysNotify?: boolean }) => {
  const uppy = new Core()
  handleError(uppy, opts)(err)
  return uppy.getState().info.map(({ message }) => message)
}

describe('handleError()', () => {
  it('shows a UserFacingApiError', () => {
    expect(shownMessages(new UserFacingApiError('Quota exceeded'))).toEqual([
      'Connection with Companion failed',
    ])
  })

  it('only logs other errors, unless alwaysNotify is set', () => {
    const err = new Error('Request failed with status 500')
    expect(shownMessages(err)).toEqual([])
    expect(shownMessages(err, { alwaysNotify: true })).toEqual([
      'Connection with Companion failed',
    ])
  })

  it('never shows a cancelled request', () => {
    const err = new DOMException('Aborted', 'AbortError')
    expect(shownMessages(err, { alwaysNotify: true })).toEqual([])
  })
})
