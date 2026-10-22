import type { Schema } from 'mongoose';

const UPDATE_OPS = ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'] as const;

/**
 * Connection-wide plugin: every update query runs schema validators
 * (enums, min/max, regex, custom validators) — not just document saves —
 * and only touches fields defined in the schema.
 */
export function enforceUpdateValidation(schema: Schema) {
  for (const op of UPDATE_OPS) {
    schema.pre(op, function () {
      this.setOptions({ runValidators: true, context: 'query', strict: true });
    });
  }
}
