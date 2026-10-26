import { Body, Controller, Get, Injectable, Module, Patch, Put } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsTimeZone, Length, Max, Min } from 'class-validator';
import { Model } from 'mongoose';
import { ActivityLogsService } from '../activity-logs/activity-logs.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, RequirePermissions } from '../common/decorators.js';
import { oid } from '../core/scope.service.js';
import { User } from '../users/user.schema.js';
import { Organization } from './organization.schema.js';

class UpdateOrganizationDto {
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @Length(2, 100) name?: string;
  @ApiPropertyOptional({ minimum: 0, maximum: 30 }) @IsOptional() @IsInt() @Min(0) @Max(30) dueSoonThresholdDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() reviewRequired?: boolean;
  @ApiPropertyOptional({ example: 'Europe/London' }) @IsOptional() @IsTimeZone() timezone?: string;
}

class NotificationPreferencesDto {
  @ApiProperty() @IsBoolean() emailAssignments: boolean;
  @ApiProperty() @IsBoolean() emailDueReminders: boolean;
  @ApiProperty() @IsBoolean() emailReviews: boolean;
  @ApiProperty() @IsBoolean() inAppComments: boolean;
  @ApiProperty() @IsBoolean() dailyDigest: boolean;
}

@Injectable()
export class SettingsService {
  constructor(
    @InjectModel(Organization.name) private readonly orgs: Model<Organization>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly activity: ActivityLogsService,
  ) {}

  private present(org: Organization) {
    return {
      name: org.name,
      dueSoonThresholdDays: org.settings?.dueSoonThresholdDays ?? 2,
      reviewRequired: org.settings?.reviewRequired ?? true,
      timezone: org.timezone ?? 'UTC',
    };
  }

  async organization(user: AuthUser) {
    return this.present((await this.orgs.findById(user.organizationId).lean())!);
  }

  async updateOrganization(user: AuthUser, dto: UpdateOrganizationDto) {
    const set: Record<string, unknown> = {};
    if (dto.name !== undefined) set.name = dto.name;
    if (dto.dueSoonThresholdDays !== undefined) set['settings.dueSoonThresholdDays'] = dto.dueSoonThresholdDays;
    if (dto.reviewRequired !== undefined) set['settings.reviewRequired'] = dto.reviewRequired;
    if (dto.timezone !== undefined) set.timezone = dto.timezone;
    const org = await this.orgs.findByIdAndUpdate(user.organizationId, { $set: set }, { returnDocument: 'after' }).lean();
    await this.activity.record({ actor: user, action: 'settings.updated', entityType: 'settings', description: 'updated organisation settings', changes: { name: dto.name, dueSoonThresholdDays: dto.dueSoonThresholdDays, reviewRequired: dto.reviewRequired, timezone: dto.timezone } });
    return this.present(org!);
  }

  async preferences(user: AuthUser) {
    const u = await this.users.findById(user.id).select('notificationPreferences').lean();
    const p = u?.notificationPreferences;
    return {
      emailAssignments: p?.emailAssignments ?? true,
      emailDueReminders: p?.emailDueReminders ?? true,
      emailReviews: p?.emailReviews ?? true,
      inAppComments: p?.inAppComments ?? true,
      dailyDigest: p?.dailyDigest ?? false,
    };
  }

  async updatePreferences(user: AuthUser, dto: NotificationPreferencesDto) {
    await this.users.updateOne({ _id: oid(user.id) }, {
      notificationPreferences: {
        emailAssignments: dto.emailAssignments,
        emailDueReminders: dto.emailDueReminders,
        emailReviews: dto.emailReviews,
        inAppComments: dto.inAppComments,
        dailyDigest: dto.dailyDigest,
      },
    });
    return this.preferences(user);
  }
}

@ApiTags('Settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('organization')
  organization(@CurrentUser() user: AuthUser) {
    return this.settings.organization(user);
  }

  @Patch('organization')
  @RequirePermissions('settings.org')
  updateOrganization(@CurrentUser() user: AuthUser, @Body() dto: UpdateOrganizationDto) {
    return this.settings.updateOrganization(user, dto);
  }

  @Get('notifications')
  preferences(@CurrentUser() user: AuthUser) {
    return this.settings.preferences(user);
  }

  @Put('notifications')
  updatePreferences(@CurrentUser() user: AuthUser, @Body() dto: NotificationPreferencesDto) {
    return this.settings.updatePreferences(user, dto);
  }
}

@Module({ controllers: [SettingsController], providers: [SettingsService] })
export class SettingsModule {}
