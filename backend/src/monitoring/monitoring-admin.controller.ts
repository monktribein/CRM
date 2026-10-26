import { Controller, Get, Headers, Ip, Param, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, RequirePermissions } from '../common/decorators.js';
import { ParseObjectIdPipe } from '../common/validation.js';
import { AccessAuditQueryDto, AdminScreenshotQueryDto, AdminSessionQueryDto, PreviewQueryDto } from './admin.dto.js';
import { MonitoringAdminService } from './monitoring-admin.service.js';

/** Super Admin "Employee Monitoring" dashboard. Policy settings reuse PATCH /monitoring/policy. */
@ApiTags('Monitoring (Super Admin)')
@ApiBearerAuth()
@RequirePermissions('monitoring.super')
@Controller('monitoring/admin')
export class MonitoringAdminController {
  constructor(private readonly admin: MonitoringAdminService) {}

  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser, @Query() q: AdminSessionQueryDto) {
    return this.admin.listSessions(user, q);
  }

  @Get('sessions/:id')
  session(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.admin.getSession(user, id);
  }

  @Get('screenshots')
  screenshots(@CurrentUser() user: AuthUser, @Query() q: AdminScreenshotQueryDto) {
    return this.admin.listScreenshots(user, q);
  }

  @Get('screenshots/:id/preview')
  async preview(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() q: PreviewQueryDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ) {
    const download = q.download === 'true';
    const file = await this.admin.preview(user, id, download, { ip, userAgent: ua });
    return new StreamableFile(file.data, {
      type: file.mimeType,
      disposition: `${download ? 'attachment' : 'inline'}; filename="${file.fileName}"`,
      length: file.data.length,
    });
  }

  @Get('uploads')
  uploads(@CurrentUser() user: AuthUser) {
    return this.admin.uploadStatus(user);
  }

  @Get('access-logs')
  accessLogs(@CurrentUser() user: AuthUser, @Query() q: AccessAuditQueryDto) {
    return this.admin.accessAudit(user, q);
  }
}
