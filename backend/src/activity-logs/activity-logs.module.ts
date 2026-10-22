import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, RequirePermissions } from '../common/decorators.js';
import { ActivityLog, ActivityLogSchema } from './activity-log.schema.js';
import { ActivityLogsService } from './activity-logs.service.js';
import { ActivityQueryDto } from './activity-query.dto.js';

@ApiTags('Activity logs')
@ApiBearerAuth()
@Controller('activity-logs')
export class ActivityLogsController {
  constructor(private readonly activity: ActivityLogsService) {}

  @Get()
  @RequirePermissions('activity.view')
  list(@CurrentUser() user: AuthUser, @Query() query: ActivityQueryDto) {
    return this.activity.list(user, query);
  }
}

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: ActivityLog.name, schema: ActivityLogSchema }])],
  controllers: [ActivityLogsController],
  providers: [ActivityLogsService],
  exports: [ActivityLogsService],
})
export class ActivityLogsModule {}
