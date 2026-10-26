import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../common/auth-user.js';
import { ScreenshotAccessLog, type AccessAction, type Screenshot } from './monitoring.schemas.js';

export interface AccessContext {
  ip?: string | null;
  userAgent?: string | null;
}

/** Writes the screenshot access audit trail (views, downloads, deletions, purges). */
@Injectable()
export class AccessLogService {
  constructor(@InjectModel(ScreenshotAccessLog.name) private readonly logs: Model<ScreenshotAccessLog>) {}

  async record(
    actor: Pick<AuthUser, 'id' | 'name' | 'role'> | null,
    action: AccessAction,
    shot: Pick<Screenshot, 'organizationId' | 'userId' | 'sessionId' | 'capturedAt'> & { _id: Types.ObjectId },
    ctx: AccessContext = {},
  ) {
    await this.logs.create({
      organizationId: shot.organizationId,
      actorId: actor ? new Types.ObjectId(actor.id) : null,
      actorName: actor?.name ?? 'System (retention policy)',
      actorRole: actor?.role ?? null,
      action,
      screenshotId: shot._id,
      employeeUserId: shot.userId,
      sessionId: shot.sessionId,
      capturedAt: shot.capturedAt,
      ip: ctx.ip?.slice(0, 64) ?? null,
      userAgent: ctx.userAgent?.slice(0, 300) ?? null,
    });
  }
}
