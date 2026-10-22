import { StreamableFile } from '@nestjs/common';

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s =
    value instanceof Date
      ? value.toISOString()
      : Array.isArray(value)
        ? value.join('; ')
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value as string | number | boolean);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]) {
  const headers = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const lines = [headers.join(','), ...rows.map((r) => headers.map((h) => cell(r[h])).join(','))];
  return '﻿' + lines.join('\r\n');
}

export function csvFile(rows: Record<string, unknown>[], fileName: string, columns?: string[]) {
  return new StreamableFile(Buffer.from(toCsv(rows, columns), 'utf8'), {
    type: 'text/csv; charset=utf-8',
    disposition: `attachment; filename="${fileName}"`,
  });
}
