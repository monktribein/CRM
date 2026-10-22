import { Global, Injectable, Logger, Module, type BeforeApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, MongooseModule } from '@nestjs/mongoose';
import mongoose, { type Connection } from 'mongoose';
import type { EnvironmentVariables } from '../config/env.js';
import { describeHosts, redactCredentials, resolveDbName } from './connection.js';
import { enforceUpdateValidation } from './plugins.js';

// Unknown fields in query filters are ignored rather than silently matching nothing.
mongoose.set('strictQuery', true);

/** Set during graceful shutdown so the expected disconnect is not reported as a problem. */
let shuttingDown = false;

/** Database health/introspection without exposing connection details. */
@Injectable()
export class DatabaseService implements BeforeApplicationShutdown {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async ping(): Promise<boolean> {
    try {
      if (this.connection.readyState !== 1) return false;
      await this.connection.db!.admin().ping();
      return true;
    } catch {
      return false;
    }
  }

  beforeApplicationShutdown() {
    shuttingDown = true;
  }

  get name() {
    return this.connection.name;
  }
}

/**
 * Owns the single MongoDB connection. Configuration comes only from backend
 * environment variables (validated at startup in config/env.ts); the URI and
 * credentials are never logged.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => {
        const uri = config.get('MONGODB_URI', { infer: true });
        const logger = new Logger('Database');
        const dbName = resolveDbName(uri, config.get('MONGODB_DB_NAME', { infer: true }));
        return {
          uri,
          dbName,
          appName: 'bizwoke-nova-api',
          // Fail fast and clearly instead of hanging when the cluster is unreachable.
          serverSelectionTimeoutMS: 10_000,
          connectTimeoutMS: 10_000,
          socketTimeoutMS: 45_000,
          maxPoolSize: config.get('MONGODB_MAX_POOL_SIZE', { infer: true }),
          retryWrites: true,
          autoIndex: config.get('MONGODB_AUTO_INDEX', { infer: true }) !== 'false',
          retryAttempts: config.get('NODE_ENV', { infer: true }) === 'test' ? 1 : 3,
          retryDelay: 2_000,
          connectionFactory: (connection: Connection) => {
            connection.plugin(enforceUpdateValidation);
            const where = `${describeHosts(uri)}/${dbName}`;
            if (connection.readyState === 1) logger.log(`Connected to MongoDB (${where})`);
            connection.on('connected', () => logger.log(`Connected to MongoDB (${where})`));
            connection.on('disconnected', () => {
              if (shuttingDown) logger.log(`Closed MongoDB connection (${where})`);
              else logger.warn(`Disconnected from MongoDB (${where}); the driver will retry`);
            });
            connection.on('reconnected', () => logger.log(`Reconnected to MongoDB (${where})`));
            connection.on('error', (err: Error) => logger.error(`MongoDB error: ${redactCredentials(err.message)}`));
            return connection;
          },
          connectionErrorFactory: (error: Error) => {
            error.message = `Could not connect to MongoDB at ${describeHosts(uri)}: ${redactCredentials(error.message)}. ` +
              'Check MONGODB_URI, the database user/password and the Atlas network access list.';
            return error;
          },
        };
      },
    }),
  ],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}

