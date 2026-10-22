import { Body, Controller, Delete, Get, HttpCode, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, RequirePermissions } from '../common/decorators.js';
import { ParseObjectIdPipe } from '../common/validation.js';
import { CreateUserDto, UpdateProfileDto, UpdateStatusDto, UpdateUserDto, UserQueryDto } from './dto.js';
import { UsersService } from './users.service.js';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Self-service profile update. Declared before ':id' routes. */
  @Patch('me')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user, dto);
  }

  @Get()
  @RequirePermissions('employees.view')
  list(@CurrentUser() user: AuthUser, @Query() q: UserQueryDto) {
    return this.users.list(user, q);
  }

  @Post()
  @RequirePermissions('employees.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(user, dto);
  }

  @Get(':id')
  @RequirePermissions('employees.view')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.users.get(user, id);
  }

  @Patch(':id')
  @RequirePermissions('employees.manage')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(user, id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('employees.manage')
  setStatus(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateStatusDto) {
    return this.users.setStatus(user, id, dto.status);
  }

  @Post(':id/invitation')
  @RequirePermissions('employees.manage')
  resendInvitation(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.users.resendInvitation(user, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('employees.manage')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    await this.users.remove(user, id);
  }
}

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
