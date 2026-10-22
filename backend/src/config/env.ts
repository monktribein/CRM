import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBooleanString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/**
 * Environment contract. Validated once at startup — the process refuses to
 * boot with a missing or weak configuration rather than failing later.
 */
export class EnvironmentVariables {
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: 'development' | 'production' | 'test' = 'development';

  @Transform(({ value }) => Number(value ?? 4000))
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 4000;

  /** mongodb:// or mongodb+srv:// connection string. Backend-only; never logged. */
  @IsString({ message: 'MONGODB_URI is not set. Paste your MongoDB connection string into backend/.env' })
  @Matches(/^mongodb(\+srv)?:\/\/\S+$/, {
    message: 'MONGODB_URI must start with mongodb:// or mongodb+srv:// (paste the full Atlas connection string into backend/.env)',
  })
  MONGODB_URI: string;

  /** Overrides the database name in the URI. Defaults to the URI path, else "bizwoke_nova". */
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{1,63}$/, { message: 'MONGODB_DB_NAME may contain letters, numbers, _ and - only' })
  MONGODB_DB_NAME?: string;

  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(200)
  MONGODB_MAX_POOL_SIZE = 20;

  /** Build indexes on startup ("true" by default). Set "false" and run `npm run db:indexes` instead. */
  @IsOptional()
  @IsBooleanString()
  MONGODB_AUTO_INDEX?: string;

  /** HMAC secret for short-lived access JWTs. */
  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
  JWT_ACCESS_SECRET: string;

  /** Pepper used to hash opaque refresh/one-time tokens before storage. */
  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters' })
  JWT_REFRESH_SECRET: string;

  /** Comma-separated list of allowed frontend origins (first is canonical). */
  @IsString()
  FRONTEND_URL: string;

  @IsOptional()
  @IsString()
  COOKIE_DOMAIN?: string;

  @IsString()
  APP_NAME = 'Bizwoke Nova';

  /** Access-token lifetime in seconds. */
  @Transform(({ value }) => Number(value ?? 900))
  @IsInt()
  @Min(60)
  @Max(3600)
  ACCESS_TOKEN_TTL_SECONDS = 900;

  @Transform(({ value }) => Number(value ?? 7))
  @IsInt()
  @Min(1)
  @Max(60)
  REFRESH_TOKEN_TTL_DAYS = 7;

  /** Max login/reset attempts per minute per IP. */
  @Transform(({ value }) => Number(value ?? 10))
  @IsInt()
  @Min(1)
  @Max(10_000)
  AUTH_RATE_LIMIT = 10;

  @IsOptional()
  @IsBooleanString()
  SWAGGER_ENABLED?: string;

  @IsOptional()
  @IsString()
  SWAGGER_USER?: string;

  @IsOptional()
  @IsString()
  @MinLength(12)
  SWAGGER_PASSWORD?: string;

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  SMTP_PORT?: number;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  @IsOptional()
  @IsEmail()
  MAIL_FROM?: string;

  @IsOptional()
  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  // The most common first-run problem gets its own unmistakable message.
  if (typeof config.MONGODB_URI !== 'string' || !config.MONGODB_URI.trim()) {
    throw new Error(
      'Invalid environment configuration:\n  - MONGODB_URI is not set. Paste your MongoDB Atlas connection string into backend/.env (MONGODB_URI=mongodb+srv://...)',
    );
  }
  const env = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
    exposeDefaultValues: true,
  });
  const errors = validateSync(env, { skipMissingProperties: false, stopAtFirstError: true });
  if (errors.length) {
    const details = errors
      .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  if (env.NODE_ENV === 'production') {
    if (env.SWAGGER_ENABLED === 'true' && (!env.SWAGGER_USER || !env.SWAGGER_PASSWORD)) {
      throw new Error('SWAGGER_USER and SWAGGER_PASSWORD are required to enable Swagger in production');
    }
    if (env.FRONTEND_URL.split(',').some((o) => !o.trim().startsWith('https://'))) {
      throw new Error('FRONTEND_URL origins must use https:// in production');
    }
  }
  return env;
}

export function allowedOrigins(env: Pick<EnvironmentVariables, 'FRONTEND_URL'>) {
  return env.FRONTEND_URL.split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}
