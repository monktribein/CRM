import { Controller, Get, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser } from '../common/decorators.js';
import { grantableRoles, JOB_FUNCTIONS, ROLE_PERMISSIONS, ROLES } from './permissions.js';

@ApiTags('Roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  /** The role catalogue, plus which roles the caller may grant. */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return {
      roles: ROLES.map((role) => ({ role, permissions: ROLE_PERMISSIONS[role] })),
      jobFunctions: JOB_FUNCTIONS,
      grantable: grantableRoles(user.role),
    };
  }
}

@Module({ controllers: [RolesController] })
export class RolesModule {}
