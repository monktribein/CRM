import { Types } from 'mongoose';
import { sanitizeMetadata } from '../activity-logs/activity-logs.service.js';
import { toCsv } from './csv.js';
import { escapeRegex } from './pagination.js';

describe('audit metadata sanitisation', () => {
  it('drops secret-looking keys at any depth', () => {
    const out = sanitizeMetadata({
      role: 'manager',
      password: 'x',
      nested: { refreshToken: 'y', ok: 1, deeper: { apiSecret: 'z', keep: true } },
      Authorization: 'Bearer abc',
    });
    expect(out).toEqual({ role: 'manager', nested: { ok: 1, deeper: { keep: true } } });
  });

  it('keeps ObjectIds and dates intact', () => {
    const id = new Types.ObjectId();
    const at = new Date();
    expect(sanitizeMetadata({ id, at })).toEqual({ id, at });
  });
});

describe('CSV export', () => {
  it('neutralises spreadsheet formula injection', () => {
    const csv = toCsv([{ title: '=HYPERLINK("http://evil")', note: '+1', ok: 'plain' }]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain("'+1");
    expect(csv).toContain('plain');
  });

  it('quotes commas, quotes and newlines', () => {
    expect(toCsv([{ a: 'x,y', b: 'say "hi"', c: 'l1\nl2' }])).toContain('"x,y","say ""hi""","l1\nl2"');
  });
});

describe('regex escaping', () => {
  it('treats user search input literally', () => {
    const re = new RegExp(escapeRegex('a.*(b)'));
    expect(re.test('a.*(b)')).toBe(true);
    expect(re.test('axxb')).toBe(false);
  });
});
