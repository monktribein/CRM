import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { can, type AuthUser } from '../common/auth-user.js';
import { Department } from '../departments/department.schema.js';

export const oid = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

/**
 * Resolves the data a user is authorised to see. All scoping decisions are
 * made here, from server-side state, so controllers never trust client IDs.
 */
@Injectable()
export class ScopeService {
  constructor(@InjectModel(Department.name) private readonly departments: Model<Department>) {}

  /** True when the user may see every record in the organisation. */
  isOrgWide(user: AuthUser) {
    return can(user, 'tasks.view_all');
  }

  /**
   * Departments a manager is authorised for: their own department plus any
   * department they manage.
   */
  async authorizedDepartmentIds(user: AuthUser): Promise<Types.ObjectId[]> {
    const managed = await this.departments
      .find({ organizationId: oid(user.organizationId), managerId: oid(user.id), status: 'active' })
      .select('_id')
      .lean();
    const ids = managed.map((d) => d._id);
    if (user.departmentId && !ids.some((i) => i.equals(user.departmentId!))) ids.push(oid(user.departmentId));
    return ids;
  }

  /** Mongo filter for tasks within a manager's teams (or the whole org). */
  async teamTaskFilter(user: AuthUser): Promise<Record<string, unknown>> {
    // Archived tasks are excluded from every team view, report and search.
    const org = { organizationId: oid(user.organizationId), archivedAt: null };
    if (this.isOrgWide(user)) return org;
    const depts = await this.authorizedDepartmentIds(user);
    return { ...org, $or: [{ departmentId: { $in: depts } }, { createdBy: oid(user.id) }] };
  }
}
