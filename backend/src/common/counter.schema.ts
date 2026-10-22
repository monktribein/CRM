import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

/** Atomic per-organisation sequences (task keys, employee IDs). */
@Schema({ collection: 'counters', versionKey: false })
export class Counter {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: Number, required: true, default: 0 })
  seq: number;
}
export const CounterSchema = SchemaFactory.createForClass(Counter);

/** Atomically increments and returns the next value (first value = start + 1). */
export async function nextSequence(model: Model<Counter>, key: string, start = 1000) {
  const doc = await model
    .findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' })
    .lean();
  return start + doc!.seq;
}
