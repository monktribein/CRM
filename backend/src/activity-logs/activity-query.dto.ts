import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../common/pagination.js';
import { ACTIVITY_ENTITIES, type ActivityEntity } from './activity-log.schema.js';

export class ActivityQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: ACTIVITY_ENTITIES })
  @IsOptional()
  @IsIn(ACTIVITY_ENTITIES)
  entityType?: ActivityEntity;
}
