import type { Types } from 'mongoose';

/** Pragmatic email check; full RFC validation happens at the DTO layer. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const uniqueIds = {
  validator: (ids: (Types.ObjectId | string)[]) => new Set(ids.map(String)).size === ids.length,
  message: 'Duplicate IDs are not allowed in {PATH}.',
};

export const nonEmptyUniqueIds = {
  validator: (ids: (Types.ObjectId | string)[]) => ids.length > 0 && new Set(ids.map(String)).size === ids.length,
  message: '{PATH} needs at least one entry and no duplicates.',
};

export const integerPercent = {
  validator: (v: number) => Number.isInteger(v) && v >= 0 && v <= 100,
  message: '{PATH} must be a whole number between 0 and 100.',
};

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Rejects a date range where `end` is before `start` for both document saves
 * and update queries that set both fields.
 */
export function assertDateRange(start: unknown, end: unknown, label: string) {
  if (start instanceof Date && end instanceof Date && end.getTime() < start.getTime()) {
    throw new Error(`${label}: due date must be on or after the start date.`);
  }
  if ((start instanceof Date && isNaN(start.getTime())) || (end instanceof Date && isNaN(end.getTime()))) {
    throw new Error(`${label}: invalid date.`);
  }
}
