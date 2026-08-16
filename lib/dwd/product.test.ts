import { describe, expect, it } from 'vitest';
import { joinFeeds, parseMessDatum, parseProduct } from './product';

// Real header and row shapes, copied from the live DWD feeds.
const TU = [
  'STATIONS_ID;MESS_DATUM;  QN;PP_10;TT_10;TM5_10;RF_10;TD_10;eor',
  '       1420;202608160000;    2; 1002.8;  24.1;  23.7;  48.4;  12.5;eor',
  '       1420;202608160010;    2; 1002.9;  24.3;  21.8;  50.6;  13.2;eor',
  '       1420;202608160020;    2; 1003.0;  24.5;  21.8;  50.6;  13.2;eor',
].join('\n');

describe('parseMessDatum', () => {
  it('reads YYYYMMDDHHMM as UTC', () => {
    expect(parseMessDatum('202608160930')).toBe(Date.UTC(2026, 7, 16, 9, 30));
  });

  it('tolerates the padding DWD writes around fields', () => {
    expect(parseMessDatum('  202608160930 ')).toBe(Date.UTC(2026, 7, 16, 9, 30));
  });

  it('rejects anything that is not twelve digits', () => {
    expect(parseMessDatum('2026081609')).toBeNaN();
    expect(parseMessDatum('')).toBeNaN();
  });
});

describe('parseProduct', () => {
  it('keeps only the requested columns', () => {
    const rows = parseProduct(TU, ['PP_10', 'TT_10']);
    expect(rows.size).toBe(3);
    expect(rows.get(Date.UTC(2026, 7, 16, 0, 0))).toEqual({ PP_10: 1002.8, TT_10: 24.1 });
  });

  it('drops a row when any requested column carries the -999 sentinel', () => {
    const withGap = [
      'STATIONS_ID;MESS_DATUM;  QN;PP_10;TT_10;eor',
      '       1420;202608160000;    2; 1002.8;  24.1;eor',
      '       1420;202608160010;    2; -999;  24.3;eor',
      '       1420;202608160020;    2; 1003.0;  -999;eor',
    ].join('\n');

    const rows = parseProduct(withGap, ['PP_10', 'TT_10']);
    expect(rows.size).toBe(1);
    expect([...rows.keys()]).toEqual([Date.UTC(2026, 7, 16, 0, 0)]);
  });

  it('returns nothing when a requested column is absent, rather than a partial row', () => {
    expect(parseProduct(TU, ['PP_10', 'NOT_A_COLUMN']).size).toBe(0);
  });

  it('reads only the tail when asked', () => {
    const rows = parseProduct(TU, ['TT_10'], 1);
    expect([...rows.keys()]).toEqual([Date.UTC(2026, 7, 16, 0, 20)]);
  });

  it('survives a file with no data rows', () => {
    expect(parseProduct('STATIONS_ID;MESS_DATUM;PP_10;eor', ['PP_10']).size).toBe(0);
    expect(parseProduct('', ['PP_10']).size).toBe(0);
  });
});

describe('joinFeeds', () => {
  const t0 = Date.UTC(2026, 7, 16, 0, 0);
  const t1 = Date.UTC(2026, 7, 16, 0, 10);

  it('keeps only timestamps present in every feed', () => {
    const tu = new Map([
      [t0, { PP_10: 1002.8, TT_10: 24.1 }],
      [t1, { PP_10: 1002.9, TT_10: 24.3 }],
    ]);
    const ff = new Map([[t0, { FF_10: 2.9 }]]);
    const rr = new Map([
      [t0, { RWS_10: 0 }],
      [t1, { RWS_10: 0.2 }],
    ]);

    const rows = joinFeeds([tu, ff, rr]);
    expect(rows).toEqual([
      { t: t0, pressure: 1002.8, temperature: 24.1, windSpeed: 2.9, precipitation: 0 },
    ]);
  });

  it('returns rows oldest first regardless of map insertion order', () => {
    const tu = new Map([
      [t1, { PP_10: 1002.9, TT_10: 24.3 }],
      [t0, { PP_10: 1002.8, TT_10: 24.1 }],
    ]);
    const ff = new Map([
      [t0, { FF_10: 2.9 }],
      [t1, { FF_10: 3.1 }],
    ]);
    const rr = new Map([
      [t0, { RWS_10: 0 }],
      [t1, { RWS_10: 0 }],
    ]);

    expect(joinFeeds([tu, ff, rr]).map((r) => r.t)).toEqual([t0, t1]);
  });
});
