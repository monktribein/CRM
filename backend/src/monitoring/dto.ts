import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../common/pagination.js';
import { CONSENT_DECISIONS, type ConsentDecision, type SessionEndReason } from './monitoring.schemas.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ConsentDto {
  @ApiProperty({ enum: CONSENT_DECISIONS }) @IsIn(CONSENT_DECISIONS) decision: ConsentDecision;
  /** The version the employee was shown; must match the current policy. */
  @ApiProperty() @IsString() @Length(1, 20) policyVersion: string;
}

export class StartSessionDto {
  @ApiPropertyOptional({ example: 'monitor' }) @IsOptional() @IsString() @MaxLength(20) displaySurface?: string;
}

/** Ends reported by the browser. Server-only reasons (timeouts, superseded) are not accepted. */
export const CLIENT_END_REASONS = ['logout', 'user_stopped', 'stream_ended', 'page_closed', 'session_expired'] as const satisfies readonly SessionEndReason[];

export class EndSessionDto {
  @ApiProperty({ enum: CLIENT_END_REASONS }) @IsIn(CLIENT_END_REASONS) reason: (typeof CLIENT_END_REASONS)[number];
}

/** The browser reports its unsent queue so administrators can see sync backlog. */
export class HeartbeatDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) pendingUploads?: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() oldestPendingAt?: string;
}

/** Multipart fields accompanying the screenshot file. */
export class UploadScreenshotDto {
  @ApiProperty() @IsMongoId() sessionId: string;
  @ApiProperty({ description: 'Client-generated UUID, unique per capture' }) @IsUUID() captureId: string;
  @ApiProperty() @IsISO8601({ strict: true }) capturedAt: string;
}

export class UpdatePolicyDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Matches(/^[\w.-]{1,20}$/, { message: 'Use letters, numbers, ".", "-" or "_" (max 20).' }) policyVersion?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) policyText?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 3650 }) @IsOptional() @IsInt() @Min(1) @Max(3650) retentionDays?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 720 }) @IsOptional() @IsInt() @Min(1) @Max(720) localRetentionHours?: number;
}

export class EnrollmentDto {
  @ApiProperty() @IsBoolean() enabled: boolean;
}

export class EmployeeMonitoringQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
}

export class ScreenshotQueryDto extends PaginationQueryDto {
  @ApiProperty() @IsMongoId() userId: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() sessionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}
