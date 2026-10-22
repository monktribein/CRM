import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { Model } from 'mongoose';
import { can, type AuthUser } from '../common/auth-user.js';
import { CurrentUser } from '../common/decorators.js';
import { escapeRegex } from '../common/pagination.js';
import { RefsService } from '../core/refs.service.js';
import { oid, ScopeService } from '../core/scope.service.js';
import { Project } from '../projects/project.schema.js';
import { Task } from '../tasks/task.schema.js';
import { fullName, User } from '../users/user.schema.js';

class SearchQueryDto {
  @ApiProperty() @IsString() @MaxLength(100) q: string;
}

/** Global search, restricted to what the caller is authorised to see. */
@Injectable()
export class SearchService {
  constructor(
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Project.name) private readonly projects: Model<Project>,
    private readonly scope: ScopeService,
    private readonly refs: RefsService,
  ) {}

  async search(user: AuthUser, q: string) {
    const term = q.trim();
    if (term.length < 2) return { tasks: [], employees: [], projects: [] };
    const re = new RegExp(escapeRegex(term), 'i');
    const org = oid(user.organizationId);

    const visibility: Record<string, unknown>[] = [{ assignedTo: oid(user.id) }, { sharedWith: oid(user.id) }];
    if (can(user, 'tasks.view_all') || can(user, 'tasks.view_team')) visibility.push(await this.scope.teamTaskFilter(user));

    const [tasks, employees, projects] = await Promise.all([
      this.tasks
        .find({ organizationId: org, archivedAt: null, $and: [{ $or: visibility }, { $or: [{ title: re }, { taskCode: re }] }] })
        .select('taskCode title status')
        .limit(6)
        .lean(),
      can(user, 'employees.view')
        ? this.users
            .find({ organizationId: org, deletedAt: null, $or: [{ firstName: re }, { lastName: re }, { email: re }] })
            .select('firstName lastName email departmentId')
            .limit(5)
            .lean()
        : Promise.resolve([]),
      this.projects
        .find({ organizationId: org, status: { $ne: 'archived' }, $or: [{ name: re }, { projectCode: re }] })
        .select('projectCode name')
        .limit(4)
        .lean(),
    ]);
    const depts = await this.refs.departmentNames(employees.map((e) => e.departmentId));

    return {
      tasks: tasks.map((t) => ({ id: String(t._id), key: t.taskCode, title: t.title, status: t.status })),
      employees: employees.map((e) => ({
        id: String(e._id),
        name: fullName(e),
        email: e.email,
        departmentName: e.departmentId ? (depts.get(String(e.departmentId)) ?? null) : null,
      })),
      projects: projects.map((p) => ({ id: String(p._id), key: p.projectCode, name: p.name })),
    };
  }
}

@ApiTags('Search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@CurrentUser() user: AuthUser, @Query() { q }: SearchQueryDto) {
    return this.searchService.search(user, q);
  }
}

@Module({ controllers: [SearchController], providers: [SearchService] })
export class SearchModule {}
