import {
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsMongoId, IsOptional, IsString, Length, MaxLength, ValidateIf } from 'class-validator';
import { Model, Types } from 'mongoose';
import { ActivityLogsService } from '../activity-logs/activity-logs.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, RequirePermissions } from '../common/decorators.js';
import { ParseObjectIdPipe } from '../common/validation.js';
import { OrgReferencesService } from '../core/org-references.service.js';
import { RefsService } from '../core/refs.service.js';
import { slugify } from '../common/slug.js';
import { oid } from '../core/scope.service.js';
import { MANAGERIAL_ROLES } from '../roles/permissions.js';
import { Task } from '../tasks/task.schema.js';
import { User } from '../users/user.schema.js';
import { Department } from './department.schema.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class CreateDepartmentDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 80) name: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) description?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsMongoId() managerId?: string | null;
}

class UpdateDepartmentDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) description?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsMongoId() managerId?: string | null;
}

class ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() includeArchived?: boolean;
}

type LeanDepartment = Department & { _id: Types.ObjectId };

@Injectable()
export class DepartmentsService {
  constructor(
    @InjectModel(Department.name) private readonly departments: Model<Department>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
    private readonly refs: RefsService,
    private readonly references: OrgReferencesService,
    private readonly activity: ActivityLogsService,
  ) {}

  private async present(list: LeanDepartment[]) {
    const ids = list.map((d) => d._id);
    const [people, work, managers] = await Promise.all([
      this.users.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { departmentId: { $in: ids }, deletedAt: null, status: { $ne: 'deactivated' } } },
        { $group: { _id: '$departmentId', n: { $sum: 1 } } },
      ]),
      this.tasks.aggregate<{ _id: Types.ObjectId; open: number; done: number; total: number }>([
        { $match: { departmentId: { $in: ids }, status: { $ne: 'cancelled' } } },
        {
          $group: {
            _id: '$departmentId',
            total: { $sum: 1 },
            done: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
            open: { $sum: { $cond: [{ $in: ['$status', ['completed', 'cancelled']] }, 0, 1] } },
          },
        },
      ]),
      this.refs.userRefs(list.map((d) => d.managerId)),
    ]);
    const peopleMap = new Map(people.map((p) => [String(p._id), p.n]));
    const workMap = new Map(work.map((w) => [String(w._id), w]));
    return list.map((d) => {
      const w = workMap.get(String(d._id));
      return {
        id: String(d._id),
        name: d.name,
        description: d.description,
        managerId: d.managerId ? String(d.managerId) : null,
        managerName: d.managerId ? (managers.get(String(d.managerId))?.name ?? null) : null,
        employeeCount: peopleMap.get(String(d._id)) ?? 0,
        activeTaskCount: w?.open ?? 0,
        completionRate: w?.total ? Math.round((w.done / w.total) * 100) : 0,
        archived: d.status === 'archived',
        createdAt: d.createdAt,
      };
    });
  }

  private async assertManager(orgId: string, managerId: string | null | undefined) {
    if (!managerId) return;
    await this.references.user(orgId, managerId, { field: 'managerId', roles: MANAGERIAL_ROLES, message: 'Select an active manager.' });
  }

  /** Names are unique (by slug) among active departments of the organisation. */
  private async assertUniqueName(orgId: string, name: string, exceptId?: Types.ObjectId) {
    const slug = slugify(name);
    if (!slug) throw new UnprocessableEntityException({ message: 'Use letters or numbers in the name.', details: { name: ['Use letters or numbers in the name.'] } });
    const clash = await this.departments.exists({ organizationId: oid(orgId), slug, status: 'active', ...(exceptId ? { _id: { $ne: exceptId } } : {}) });
    if (clash) throw new ConflictException({ message: 'A department with this name already exists.', details: { name: ['A department with this name already exists.'] } });
    return slug;
  }

  async list(user: AuthUser, includeArchived = false) {
    const list = await this.departments
      .find({ organizationId: oid(user.organizationId), ...(includeArchived ? {} : { status: 'active' as const }) })
      .sort({ name: 1 })
      .lean();
    return this.present(list);
  }

  async create(user: AuthUser, dto: CreateDepartmentDto) {
    const slug = await this.assertUniqueName(user.organizationId, dto.name);
    await this.assertManager(user.organizationId, dto.managerId);
    const d = await this.departments.create({
      organizationId: oid(user.organizationId),
      name: dto.name,
      slug,
      description: dto.description || null,
      managerId: dto.managerId ? oid(dto.managerId) : null,
    });
    await this.activity.record({ actor: user, action: 'department.created', entityType: 'department', entityId: d._id, entityLabel: d.name, description: `created department ${d.name}` });
    return (await this.present([d.toObject()]))[0];
  }

  private async find(user: AuthUser, id: string) {
    const d = await this.departments.findOne({ _id: oid(id), organizationId: oid(user.organizationId) });
    if (!d) throw new NotFoundException('Department not found.');
    return d;
  }

  async update(user: AuthUser, id: string, dto: UpdateDepartmentDto) {
    const d = await this.find(user, id);
    if (dto.name !== undefined) {
      d.slug = await this.assertUniqueName(user.organizationId, dto.name, d._id);
      d.name = dto.name;
    }
    if (dto.description !== undefined) d.description = dto.description || null;
    if (dto.managerId !== undefined) {
      await this.assertManager(user.organizationId, dto.managerId);
      d.managerId = dto.managerId ? oid(dto.managerId) : null;
    }
    await d.save();
    await this.activity.record({ actor: user, action: 'department.updated', entityType: 'department', entityId: d._id, entityLabel: d.name, description: `updated department ${d.name}`, changes: { fields: Object.keys(dto) } });
    return (await this.present([d.toObject()]))[0];
  }

  async archive(user: AuthUser, id: string) {
    const d = await this.find(user, id);
    const open = await this.tasks.countDocuments({ departmentId: d._id, status: { $nin: ['completed', 'cancelled'] } });
    if (open > 0) throw new ConflictException("Close or move this department's open tasks before archiving it.");
    d.status = 'archived';
    await d.save();
    await this.activity.record({ actor: user, action: 'department.archived', entityType: 'department', entityId: d._id, entityLabel: d.name, description: `archived department ${d.name}` });
    return (await this.present([d.toObject()]))[0];
  }
}

@ApiTags('Departments')
@ApiBearerAuth()
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermissions('departments.view')
  list(@CurrentUser() user: AuthUser, @Query() q: ListQueryDto) {
    return this.departments.list(user, q.includeArchived);
  }

  @Post()
  @RequirePermissions('departments.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDepartmentDto) {
    return this.departments.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('departments.manage')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateDepartmentDto) {
    return this.departments.update(user, id, dto);
  }

  @Patch(':id/archive')
  @RequirePermissions('departments.manage')
  archive(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.departments.archive(user, id);
  }
}

@Module({ controllers: [DepartmentsController], providers: [DepartmentsService] })
export class DepartmentsModule {}
