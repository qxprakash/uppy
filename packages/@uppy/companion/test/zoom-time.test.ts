import { describe, expect, test } from 'vitest'
import {
  formatTime,
  getMonthInUtc,
  getTimeZone,
  getYearAndMonth,
  parseTime,
} from '../dist/server/provider/zoom/time.js'

describe('getTimeZone', () => {
  test.each(['Asia/Kolkata', 'America/Sao_Paulo', 'UTC'])('keeps %s', (tz) => {
    expect(getTimeZone(tz)).toBe(tz)
  })

  test.each([
    'bogus',
    'Foo/Bar',
    '+05:30',
    '-03:00',
    '',
    undefined,
  ])('falls back to UTC for %j', (tz) => {
    expect(getTimeZone(tz)).toBe('UTC')
  })
})

describe('getMonthInUtc', () => {
  // [zone, year, month (0-11), from, to], as moment-timezone computed them
  test.each([
    ['UTC', 2024, 1, '2024-02-01', '2024-02-29'],
    ['America/Santiago', 2020, 7, '2020-08-01', '2020-09-01'],
    // DST started at midnight on 4 November
    ['America/Sao_Paulo', 2018, 10, '2018-11-01', '2018-12-01'],
    ['America/Sao_Paulo', 2024, 1, '2024-02-01', '2024-03-01'],
    // clocks went from 00:00 straight to 01:00 on 1 June, and from 00:00
    // back to 23:00 on 31 August
    ['Africa/Casablanca', 2008, 5, '2008-06-01', '2008-06-30'],
    ['Africa/Casablanca', 2008, 7, '2008-07-31', '2008-08-31'],
    ['Asia/Kolkata', 2024, 0, '2023-12-31', '2024-01-31'],
    ['Pacific/Chatham', 2024, 3, '2024-03-31', '2024-04-30'],
    ['Pacific/Chatham', 2024, 9, '2024-09-30', '2024-10-31'],
    ['Australia/Lord_Howe', 2024, 3, '2024-03-31', '2024-04-30'],
    ['Europe/London', 2024, 6, '2024-06-30', '2024-07-31'],
    ['America/New_York', 2024, 2, '2024-03-01', '2024-04-01'],
  ])('%s %i-%i', (tz, year, month, from, to) => {
    expect(getMonthInUtc(year, month, tz)).toEqual({ from, to })
  })
})

describe('formatTime', () => {
  test('formats on the clock of the zone', () => {
    const time = Date.parse('2020-05-29T13:19:40Z')
    expect(formatTime(time, 'Asia/Kolkata', { withTime: true })).toBe(
      '2020-05-29, 18:49',
    )
    expect(formatTime(time, 'America/Sao_Paulo', { withTime: true })).toBe(
      '2020-05-29, 10:19',
    )
    expect(formatTime(time, 'UTC')).toBe('2020-05-29')
  })

  test('crosses the date line', () => {
    // +13:45 in January
    expect(formatTime(Date.UTC(2024, 0, 31, 20), 'Pacific/Chatham')).toBe(
      '2024-02-01',
    )
  })

  test('says so for an invalid date', () => {
    expect(formatTime(Number.NaN, 'UTC', { withTime: true })).toBe(
      'Invalid date',
    )
  })
})

describe('getYearAndMonth', () => {
  test('uses the clock of the zone', () => {
    const time = Date.UTC(2023, 11, 31, 19)
    expect(getYearAndMonth(time, 'Asia/Kolkata')).toEqual({
      year: 2024,
      month: 0,
    })
    expect(getYearAndMonth(time, 'America/New_York')).toEqual({
      year: 2023,
      month: 11,
    })
  })
})

describe('parseTime', () => {
  test('a time with an offset is that time in any zone', () => {
    const expected = Date.UTC(2020, 4, 29, 13, 19, 40)
    expect(parseTime('2020-05-29T13:19:40Z', 'Asia/Kolkata')).toBe(expected)
    expect(parseTime('2020-05-29T15:19:40+02:00', 'UTC')).toBe(expected)
  })

  test('a time without an offset is wall clock time in the zone', () => {
    expect(parseTime('2020-05-29T13:19:40', 'Asia/Kolkata')).toBe(
      Date.UTC(2020, 4, 29, 7, 49, 40),
    )
    expect(parseTime('2020-05-29 13:19', 'America/Los_Angeles')).toBe(
      Date.UTC(2020, 4, 29, 20, 19),
    )
    expect(parseTime('2020-05-29', 'Pacific/Chatham')).toBe(
      Date.UTC(2020, 4, 28, 11, 15),
    )
    expect(parseTime('2019-12-31T23:30:00', 'UTC')).toBe(
      Date.UTC(2019, 11, 31, 23, 30),
    )
  })

  test('a skipped wall time moves forward, a repeated one is the first', () => {
    // clocks went from 02:00 to 03:00 (EST to EDT)
    expect(parseTime('2020-03-08T02:30:00', 'America/New_York')).toBe(
      Date.UTC(2020, 2, 8, 7, 30),
    )
    // 01:30 happened twice, first in EDT
    expect(parseTime('2020-11-01T01:30:00', 'America/New_York')).toBe(
      Date.UTC(2020, 10, 1, 5, 30),
    )
  })

  test('garbage is not a time', () => {
    expect(parseTime('not a date', 'UTC')).toBeNaN()
  })
})
