import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Department } from '../departments/department.schema.js';
import { Project } from '../projects/project.schema.js';
import { fullName, User } from '../users/user.schema.js';

export interface UserRef {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

type Id = Types.ObjectId | string | null | undefined;
const uniq = (ids: Id[]) => [...new Set(ids.filter(Boolean).map(String))];

/** Batched lookups that turn stored ObjectIds into display references. */
@Injectable()
export class RefsService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Department.name) private readonly departments: Model<Department>,
    @InjectModel(Project.name) private readonly projects: Model<Project>,
  ) {}

  async userRefs(ids: Id[]): Promise<Map<string, UserRef>> {
    const list = await this.users
      .find({ _id: { $in: uniq(ids) } })
      .select('firstName lastName email')
      .lean();
    return new Map(
      list.map((u) => [String(u._id), { id: String(u._id), name: fullName(u), email: u.email, avatarUrl: null }]),
    );
  }

  async departmentNames(ids: Id[]): Promise<Map<string, string>> {
    const list = await this.departments.find({ _id: { $in: uniq(ids) } }).select('name').lean();
    return new Map(list.map((d) => [String(d._id), d.name]));
  }

  async projectNames(ids: Id[]): Promise<Map<string, string>> {
    const list = await this.projects.find({ _id: { $in: uniq(ids) } }).select('name').lean();
    return new Map(list.map((p) => [String(p._id), p.name]));
  }
}

export const unknownUser = (id: Id): UserRef => ({
  id: String(id ?? ''),
  name: 'Unknown user',
  email: '',
  avatarUrl: null,
});

export function refOf(map: Map<string, UserRef>, id: Id): UserRef {
  return map.get(String(id)) ?? unknownUser(id);
}
