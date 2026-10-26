import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../common/pagination.js';
import { ACCESS_ACTIONS, type AccessAction, type DisplayStatus } from './monitoring.schemas.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = 'Use a calendar date (YYYY-MM-DD).';

export const SESSION_SORTS = ['startedAt', 'loginAt', 'lastHeartbeatAt', 'endedAt', 'captureCount', 'lastUploadAt'] as const;
export const DISPLAY_STATUSES = ['active', 'ended', 'expired', 'interrupted'] as const satisfies readonly DisplayStatus[];
export const AVAILABILITIES = ['available', 'pending', 'failed', 'missing', 'deleted'] as const;

/** Date filters are calendar days in the organisation's timezone. */
class DayRangeDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @Matches(DAY, { message: DAY_MESSAGE }) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @Matches(DAY, { message: DAY_MESSAGE }) to?: string;
}

export class AdminSessionQueryDto extends DayRangeDto {
  @ApiPropertyOptional({ description: 'Employee name, email or employee ID' }) @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() userId?: string;
  @ApiPropertyOptional({ enum: DISPLAY_STATUSES }) @IsOptional() @IsIn(DISPLAY_STATUSES) status?: DisplayStatus;
  @ApiPropertyOptional({ enum: SESSION_SORTS }) @IsOptional() @IsIn(SESSION_SORTS) sort?: (typeof SESSION_SORTS)[number];
  @ApiPropertyOptional({ enum: ['asc', 'desc'] }) @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
}

export class AdminScreenshotQueryDto extends DayRangeDto {
  @ApiPropertyOptional() @IsOptional() @IsMongoId() sessionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() userId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() departmentId?: string;
  @ApiPropertyOptional({ enum: AVAILABILITIES }) @IsOptional() @IsIn(AVAILABILITIES) availability?: (typeof AVAILABILITIES)[number];
  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: 'By capture time; sessions default to oldest first' }) @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
}

export class AccessAuditQueryDto extends DayRangeDto {
  @ApiPropertyOptional({ enum: ACCESS_ACTIONS }) @IsOptional() @IsIn(ACCESS_ACTIONS) action?: AccessAction;
  @ApiPropertyOptional({ description: 'Viewer or employee name' }) @IsOptional() @IsString() @MaxLength(100) search?: string;
}

export class PreviewQueryDto {
  @ApiPropertyOptional({ enum: ['true'] }) @IsOptional() @IsIn(['true']) download?: 'true';
}
