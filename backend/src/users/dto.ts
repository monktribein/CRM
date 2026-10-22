import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto, toArray } from '../common/pagination.js';
import { JOB_FUNCTIONS, ROLES, type JobFunction, type Role } from '../roles/permissions.js';
import { ACCOUNT_STATUSES, type AccountStatus } from './user.schema.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateUserDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 60) firstName: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 60) lastName: string;
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() @MaxLength(254) email: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) title?: string;
  @ApiProperty({ enum: ROLES }) @IsIn(ROLES) role: Role;
  @ApiProperty({ enum: JOB_FUNCTIONS }) @IsIn(JOB_FUNCTIONS) jobFunction: JobFunction;
  @ApiProperty() @IsMongoId() departmentId: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsMongoId() managerId?: string | null;
  @ApiProperty({ example: '2026-10-01' }) @IsDateString() joinDate: string;
  @ApiProperty() @IsBoolean() sendInvitation: boolean;
}

export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 60) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 60) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) title?: string;
  @ApiPropertyOptional({ enum: ROLES }) @IsOptional() @IsIn(ROLES) role?: Role;
  @ApiPropertyOptional({ enum: JOB_FUNCTIONS }) @IsOptional() @IsIn(JOB_FUNCTIONS) jobFunction?: JobFunction;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() departmentId?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsMongoId() managerId?: string | null;
}

export class UpdateProfileDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 60) firstName: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 60) lastName: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) title?: string;
}

export class UpdateStatusDto {
  @ApiProperty({ enum: ['active', 'deactivated'] }) @IsIn(['active', 'deactivated']) status: 'active' | 'deactivated';
}

export class UserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() departmentId?: string;
  @ApiPropertyOptional({ description: 'Comma-separated roles' })
  @IsOptional()
  @Transform(toArray)
  @IsIn(ROLES, { each: true })
  role?: Role[];
  @ApiPropertyOptional({ enum: ACCOUNT_STATUSES }) @IsOptional() @IsIn(ACCOUNT_STATUSES) status?: AccountStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => String) @IsMongoId() managerId?: string;
}
