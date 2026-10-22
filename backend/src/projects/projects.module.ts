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
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsDateString,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Model, Types } from 'mongoose';
import { ActivityLogsService } from '../activity-logs/activity-logs.service.js';
import { can, type AuthUser } from '../common/auth-user.js';
import { CurrentUser, RequirePermissions } from '../common/decorators.js';
import { ParseObjectIdPipe } from '../common/validation.js';
import { OrgReferencesService } from '../core/org-references.service.js';
import { refOf, RefsService } from '../core/refs.service.js';
import { oid } from '../core/scope.service.js';
import { Department } from '../departments/department.schema.js';
import { MANAGERIAL_ROLES } from '../roles/permissions.js';
import { Task } from '../tasks/task.schema.js';
import { User } from '../users/user.schema.js';
import { Project, PROJECT_STATUSES, type ProjectStatus } from './project.schema.js';

/** "archived" is only set through the archive endpoint. */
const EDITABLE_STATUSES = PROJECT_STATUSES.filter((s) => s !== 'archived');

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class CreateProjectDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 100) name: string;
  @ApiProperty({ example: 'NOVA' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z][A-Z0-9]{1,9}$/, { message: 'Key must be 2–10 letters/numbers, starting with a letter.' })
  key: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string;
  @ApiProperty() @IsMongoId() departmentId: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsMongoId() managerId?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @ArrayMaxSize(200) @IsMongoId({ each: true }) memberIds?: string[];
  @ApiProperty({ enum: EDITABLE_STATUSES }) @IsIn(EDITABLE_STATUSES) status: ProjectStatus;
  @ApiProperty() @IsDateString() startDate: string;
  @ApiProperty() @IsDateString() dueDate: string;
}

class UpdateProjectDto extends PartialType(CreateProjectDto) {}

class ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() includeArchived?: boolean;
}

type LeanProject = Project & { _id: Types.ObjectId };

@Injectable()
export class ProjectsService {
  constructor(
    @InjectModel(Project.name) private readonly projects: Model<Project>,
    @InjectModel(Department.name) private readonly departments: Model<Department>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
    private readonly refs: RefsService,
    private readonly references: OrgReferencesService,
    private readonly activity: ActivityLogsService,
  ) {}

  private async present(list: LeanProject[]) {
    const ids = list.map((p) => p._id);
    const [stats, depts, managers] = await Promise.all([
      this.tasks.aggregate<{ _id: Types.ObjectId; total: number; done: number }>([
        { $match: { projectId: { $in: ids }, status: { $ne: 'cancelled' } } },
        { $group: { _id: '$projectId', total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } },
      ]),
      this.refs.departmentNames(list.map((p) => p.departmentId)),
      this.refs.userRefs(list.map((p) => p.managerId)),
    ]);
    const statMap = new Map(stats.map((s) => [String(s._id), s]));
    return list.map((p) => ({
      id: String(p._id),
      key: p.projectCode,
      name: p.name,
      description: p.description,
      departmentId: String(p.departmentId),
      departmentName: depts.get(String(p.departmentId)) ?? '',
      manager: p.managerId ? refOf(managers, p.managerId) : null,
      memberIds: p.memberIds.map(String),
      status: p.status,
      startDate: p.startDate,
      dueDate: p.dueDate,
      taskCount: statMap.get(String(p._id))?.total ?? 0,
      completedTaskCount: statMap.get(String(p._id))?.done ?? 0,
      archived: p.status === 'archived',
    }));
  }

  private async validate(orgId: string, dto: Partial<CreateProjectDto>) {
    // Every referenced record must be active and in the caller's organisation.
    if (dto.departmentId) await this.references.department(orgId, dto.departmentId);
    if (dto.managerId) await this.references.user(orgId, dto.managerId, { field: 'managerId', roles: MANAGERIAL_ROLES, message: 'Select an active manager.' });
    if (dto.memberIds?.length) await this.references.users(orgId, dto.memberIds, { field: 'memberIds', message: 'Team members must be active users in your organisation.' });
    if (dto.startDate && dto.dueDate && dto.dueDate < dto.startDate) {
      throw new UnprocessableEntityException({ message: 'Deadline must be after the start date.', details: { dueDate: ['Deadline must be after the start date.'] } });
    }
  }

  async list(user: AuthUser, includeArchived = false) {
    const filter: Record<string, unknown> = { organizationId: oid(user.organizationId) };
    if (!includeArchived) filter.status = { $ne: 'archived' };
    // Employees only see projects they belong to or have tasks in.
    if (!can(user, 'projects.manage') && !can(user, 'tasks.view_team') && !can(user, 'employees.view')) {
      const mine = await this.tasks.distinct('projectId', { organizationId: oid(user.organizationId), $or: [{ assignedTo: oid(user.id) }, { sharedWith: oid(user.id) }] });
      filter.$or = [{ memberIds: oid(user.id) }, { _id: { $in: mine } }];
    }
    return this.present(await this.projects.find(filter).sort({ name: 1 }).lean());
  }

  async create(user: AuthUser, dto: CreateProjectDto) {
    await this.validate(user.organizationId, dto);
    if (await this.projects.exists({ organizationId: oid(user.organizationId), projectCode: dto.key })) {
      throw new ConflictException({ message: 'Project key is already in use.', details: { key: ['Project key is already in use.'] } });
    }
    const p = await this.projects.create({
      organizationId: oid(user.organizationId),
      projectCode: dto.key,
      name: dto.name,
      description: dto.description || null,
      departmentId: oid(dto.departmentId),
      managerId: dto.managerId ? oid(dto.managerId) : oid(user.id),
      memberIds: (dto.memberIds ?? []).map(oid),
      status: dto.status,
      startDate: new Date(dto.startDate),
      dueDate: new Date(dto.dueDate),
      createdBy: oid(user.id),
    });
    await this.activity.record({ actor: user, action: 'project.created', entityType: 'project', entityId: p._id, entityLabel: p.name, description: `created project ${p.name}` });
    return (await this.present([p.toObject()]))[0];
  }

  private async find(user: AuthUser, id: string) {
    const p = await this.projects.findOne({ _id: oid(id), organizationId: oid(user.organizationId) });
    if (!p) throw new NotFoundException('Project not found.');
    return p;
  }

  async update(user: AuthUser, id: string, dto: UpdateProjectDto) {
    const p = await this.find(user, id);
    await this.validate(user.organizationId, { ...dto, startDate: dto.startDate ?? p.startDate.toISOString(), dueDate: dto.dueDate ?? p.dueDate.toISOString() });
    if (dto.key && dto.key !== p.projectCode && (await this.projects.exists({ organizationId: oid(user.organizationId), projectCode: dto.key }))) {
      throw new ConflictException({ message: 'Project key is already in use.', details: { key: ['Project key is already in use.'] } });
    }
    if (dto.name !== undefined) p.name = dto.name;
    if (dto.key !== undefined) p.projectCode = dto.key;
    if (dto.description !== undefined) p.description = dto.description || null;
    if (dto.departmentId !== undefined) p.departmentId = oid(dto.departmentId);
    if (dto.managerId !== undefined) p.managerId = dto.managerId ? oid(dto.managerId) : null;
    if (dto.memberIds !== undefined) p.memberIds = dto.memberIds.map(oid);
    if (dto.status !== undefined) p.status = dto.status;
    if (dto.startDate !== undefined) p.startDate = new Date(dto.startDate);
    if (dto.dueDate !== undefined) p.dueDate = new Date(dto.dueDate);
    await p.save();
    await this.activity.record({ actor: user, action: 'project.updated', entityType: 'project', entityId: p._id, entityLabel: p.name, description: `updated project ${p.name}`, changes: { fields: Object.keys(dto) } });
    return (await this.present([p.toObject()]))[0];
  }

  async archive(user: AuthUser, id: string) {
    const p = await this.find(user, id);
    p.status = 'archived';
    await p.save();
    await this.activity.record({ actor: user, action: 'project.archived', entityType: 'project', entityId: p._id, entityLabel: p.name, description: `archived project ${p.name}` });
    return (await this.present([p.toObject()]))[0];
  }
}

@ApiTags('Projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermissions('projects.view')
  list(@CurrentUser() user: AuthUser, @Query() q: ListQueryDto) {
    return this.projects.list(user, q.includeArchived);
  }

  @Post()
  @RequirePermissions('projects.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('projects.manage')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(user, id, dto);
  }

  @Patch(':id/archive')
  @RequirePermissions('projects.manage')
  archive(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.projects.archive(user, id);
  }
}

@Module({ controllers: [ProjectsController], providers: [ProjectsService] })
export class ProjectsModule {}
