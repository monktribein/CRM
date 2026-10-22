import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto, toArray } from '../common/pagination.js';
import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from './task.schema.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const normaliseTags = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? [...new Set(value.map((t) => String(t).trim().toLowerCase()).filter(Boolean))] : value;

export class ChecklistItemDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) label: string;
}

export class CreateTaskDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 200) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000) description?: string;
  @ApiProperty() @IsMongoId() projectId: string;
  @ApiProperty() @IsMongoId() departmentId: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Assign at least one employee.' })
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsMongoId({ each: true })
  assigneeIds: string[];
  @ApiProperty({ enum: TASK_PRIORITIES }) @IsIn(TASK_PRIORITIES) priority: TaskPriority;
  @ApiProperty({ example: '2026-10-22' }) @IsDateString() startDate: string;
  @ApiProperty({ example: '2026-10-29' }) @IsDateString() dueDate: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.25) @Max(10_000) estimatedHours: number;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(normaliseTags)
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];
  @ApiPropertyOptional({ type: [ChecklistItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  checklist?: ChecklistItemDto[];
}

export class UpdateTaskDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(3, 200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() projectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() departmentId?: string;
  @ApiPropertyOptional({ enum: TASK_PRIORITIES }) @IsOptional() @IsIn(TASK_PRIORITIES) priority?: TaskPriority;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.25) @Max(10_000) estimatedHours?: number;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(normaliseTags)
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];
}

const SORT_FIELDS = ['dueDate', 'priority', 'updatedAt', 'status', 'title', 'key'] as const;
export type TaskSortField = (typeof SORT_FIELDS)[number];

export class TaskQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'all'], default: 'mine' }) @IsOptional() @IsIn(['mine', 'all']) scope: 'mine' | 'all' = 'mine';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ description: 'Comma-separated' }) @IsOptional() @Transform(toArray) @IsIn(TASK_STATUSES, { each: true }) status?: TaskStatus[];
  @ApiPropertyOptional({ description: 'Comma-separated' }) @IsOptional() @Transform(toArray) @IsIn(TASK_PRIORITIES, { each: true }) priority?: TaskPriority[];
  @ApiPropertyOptional() @IsOptional() @IsMongoId() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() projectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() assigneeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueTo?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() overdue?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) tag?: string;
  @ApiPropertyOptional({ enum: SORT_FIELDS }) @IsOptional() @IsIn(SORT_FIELDS) sort: TaskSortField = 'dueDate';
  @ApiPropertyOptional({ enum: ['asc', 'desc'] }) @IsOptional() @IsIn(['asc', 'desc']) order: 'asc' | 'desc' = 'asc';
}

export class UpdateStatusDto {
  @ApiProperty({ enum: TASK_STATUSES }) @IsIn(TASK_STATUSES) status: TaskStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class UpdateProgressDto {
  @ApiProperty({ minimum: 0, maximum: 100 }) @IsInt() @Min(0) @Max(100) progressPercentage: number;
}

export class AssignDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Assign at least one employee.' })
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsMongoId({ each: true })
  assigneeIds: string[];
}

export class CommentDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 5000) body: string;
}

export class TimeEntryDto {
  @ApiProperty({ minimum: 1, maximum: 1440 }) @IsInt() @Min(1) @Max(1440) minutes: number;
  @ApiProperty({ example: '2026-10-22' }) @IsDateString() date: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) note?: string;
}

export class AttachmentDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) fileName: string;
  @ApiProperty()
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Attachment URL must be a valid https:// link.' })
  @MaxLength(2000)
  url: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sizeBytes?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) contentType?: string;
}

export class ToggleChecklistDto {
  @ApiProperty() @IsBoolean() done: boolean;
}

export class ReviewNoteDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) note?: string;
}

export class RequestChangesDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1, { message: 'Explain what needs to change.' }) @MaxLength(2000) note: string;
}
