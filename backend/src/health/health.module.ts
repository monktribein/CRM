import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators.js';
import { DatabaseService } from '../database/database.module.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  /** Liveness + database readiness. Returns 503 when MongoDB is unreachable. */
  @Public()
  @SkipThrottle()
  @Get()
  async check() {
    if (!(await this.database.ping())) {
      throw new ServiceUnavailableException({ message: 'Database unavailable.', details: { database: ['down'] } });
    }
    return { status: 'ok', database: 'up', uptimeSeconds: Math.round(process.uptime()) };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
