import { Body, Controller, Delete, Get, Headers, HttpCode, Ip, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, RequirePermissions } from '../common/decorators.js';
import { ParseObjectIdPipe } from '../common/validation.js';
import {
  ConsentDto,
  EmployeeMonitoringQueryDto,
  EndSessionDto,
  EnrollmentDto,
  HeartbeatDto,
  ScreenshotQueryDto,
  StartSessionDto,
  UpdatePolicyDto,
  UploadScreenshotDto,
} from './dto.js';
import { MAX_SCREENSHOT_BYTES, MonitoringService, type UploadedImage } from './monitoring.service.js';

@ApiTags('Monitoring')
@ApiBearerAuth()
@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  /* ----- The signed-in employee's own monitoring (identity from the access token) ----- */

  @Get('me')
  myStatus(@CurrentUser() user: AuthUser) {
    return this.monitoring.myStatus(user);
  }

  @Post('me/consent')
  @HttpCode(200)
  consent(@CurrentUser() user: AuthUser, @Body() dto: ConsentDto, @Headers('user-agent') ua?: string) {
    return this.monitoring.recordConsent(user, dto, ua);
  }

  @Post('me/permission-denied')
  @HttpCode(204)
  async permissionDenied(@CurrentUser() user: AuthUser) {
    await this.monitoring.reportPermissionDenied(user);
  }

  @Post('sessions')
  startSession(@CurrentUser() user: AuthUser, @Body() dto: StartSessionDto, @Headers('user-agent') ua?: string) {
    return this.monitoring.startSession(user, dto, ua);
  }

  @Post('sessions/:id/heartbeat')
  @HttpCode(200)
  heartbeat(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: HeartbeatDto) {
    return this.monitoring.heartbeat(user, id, dto);
  }

  @Post('sessions/:id/end')
  @HttpCode(200)
  endSession(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: EndSessionDto) {
    return this.monitoring.endSession(user, id, dto);
  }

  @Post('screenshots')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SCREENSHOT_BYTES, files: 1, fields: 5 } }))
  upload(@CurrentUser() user: AuthUser, @Body() dto: UploadScreenshotDto, @UploadedFile() file?: UploadedImage) {
    return this.monitoring.uploadScreenshot(user, dto, file);
  }

  /* ----- Administration ----- */

  @Get('policy')
  @RequirePermissions('monitoring.view')
  policy(@CurrentUser() user: AuthUser) {
    return this.monitoring.policy(user);
  }

  @Patch('policy')
  @RequirePermissions('monitoring.manage')
  updatePolicy(@CurrentUser() user: AuthUser, @Body() dto: UpdatePolicyDto) {
    return this.monitoring.updatePolicy(user, dto);
  }

  @Get('employees')
  @RequirePermissions('monitoring.view')
  employees(@CurrentUser() user: AuthUser, @Query() q: EmployeeMonitoringQueryDto) {
    return this.monitoring.listEmployees(user, q);
  }

  @Get('employees/:id')
  @RequirePermissions('monitoring.view')
  employee(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.monitoring.employeeStatus(user, id);
  }

  @Patch('employees/:id')
  @RequirePermissions('monitoring.manage')
  enroll(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: EnrollmentDto) {
    return this.monitoring.setEnrollment(user, id, dto.enabled);
  }

  @Get('employees/:id/sessions')
  @RequirePermissions('monitoring.view')
  sessions(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.monitoring.listSessions(user, id);
  }

  @Get('screenshots')
  @RequirePermissions('monitoring.view')
  screenshots(@CurrentUser() user: AuthUser, @Query() q: ScreenshotQueryDto) {
    return this.monitoring.listScreenshots(user, q);
  }

  @Get('screenshots/:id/content')
  @RequirePermissions('monitoring.view')
  async content(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    const file = await this.monitoring.screenshotContent(user, id, { ip, userAgent: ua });
    return new StreamableFile(file.data, {
      type: file.mimeType,
      disposition: `inline; filename="${file.fileName}"`,
      length: file.data.length,
    });
  }

  @Delete('screenshots/:id')
  @HttpCode(204)
  @RequirePermissions('monitoring.manage')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    await this.monitoring.deleteScreenshot(user, id, { ip, userAgent: ua });
  }
}
