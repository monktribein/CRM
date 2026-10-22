import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
  ValidationPipe,
  type PipeTransform,
  type ValidationError,
} from '@nestjs/common';
import { isValidObjectId } from 'mongoose';

function flatten(errors: ValidationError[], parent = ''): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of errors) {
    const path = parent ? `${parent}.${e.property}` : e.property;
    if (e.constraints) out[path] = Object.values(e.constraints);
    if (e.children?.length) Object.assign(out, flatten(e.children, path));
  }
  return out;
}

/**
 * Global validation: unknown properties are rejected (prevents mass
 * assignment and operator injection such as `{ "$gt": "" }`), payloads are
 * transformed into DTO instances, and failures return field-level details.
 */
export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) =>
      new UnprocessableEntityException({ message: 'Validation failed.', details: flatten(errors) }),
  });
}

@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (!isValidObjectId(value) || !/^[a-f\d]{24}$/i.test(value)) {
      throw new BadRequestException('Invalid identifier.');
    }
    return value;
  }
}
