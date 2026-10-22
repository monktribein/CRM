import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Department } from '../departments/department.schema.js';
import { Project } from '../projects/project.schema.js';
import type { Role } from '../roles/permissions.js';
import { User } from '../users/user.schema.js';

type Id = string | Types.ObjectId;

function invalid(field: string, message: string): never {
  throw new UnprocessableEntityException({ message, details: { [field]: [message] } });
}

function toObjectId(field: string, id: Id): Types.ObjectId {
  if (id instanceof Types.ObjectId) return id;
  if (!isValidObjectId(id) || !/^[a-f\d]{24}$/i.test(id)) invalid(field, 'Invalid identifier.');
  return new Types.ObjectId(id);
}

/**
 * Validates that records referenced by a write belong to the caller's
 * organisation (and are usable). Every service resolves references through
 * here, so a client can never link data across organisations.
 */
@Injectable()
export class OrgReferencesService {
  constructor(
    @InjectModel(Department.name) private readonly departmentModel: Model<Department>,
    @InjectModel(Project.name) private readonly projectModel: Model<Project>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async department(orgId: Id, id: Id, field = 'departmentId') {
    const dept = await this.departmentModel
      .findOne({ _id: toObjectId(field, id), organizationId: toObjectId('organizationId', orgId), status: 'active' })
      .lean();
    if (!dept) invalid(field, 'Select an active department in your organisation.');
    return dept;
  }

  async project(orgId: Id, id: Id, field = 'projectId') {
    const project = await this.projectModel
      .findOne({ _id: toObjectId(field, id), organizationId: toObjectId('organizationId', orgId), status: { $ne: 'archived' } })
      .lean();
    if (!project) invalid(field, 'Select an active project in your organisation.');
    return project;
  }

  /** Active, non-deleted users of the organisation; optionally limited to roles. */
  async users(orgId: Id, ids: Id[], opts: { field?: string; roles?: Role[]; message?: string } = {}) {
    const field = opts.field ?? 'userIds';
    const unique = [...new Set(ids.map(String))];
    if (unique.length !== ids.length) invalid(field, 'Duplicate users are not allowed.');
    const found = await this.userModel
      .find({
        _id: { $in: unique.map((i) => toObjectId(field, i)) },
        organizationId: toObjectId('organizationId', orgId),
        status: 'active',
        deletedAt: null,
        ...(opts.roles ? { securityRole: { $in: opts.roles } } : {}),
      })
      .lean();
    if (found.length !== unique.length) invalid(field, opts.message ?? 'Only active users in your organisation can be selected.');
    return found;
  }

  async user(orgId: Id, id: Id, opts: { field?: string; roles?: Role[]; message?: string } = {}) {
    const [u] = await this.users(orgId, [id], opts);
    return u!;
  }
}
