import { Body, Controller, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CommentsModule } from '../comments/comments.module.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, RequirePermissions } from '../common/decorators.js';
import { ParseObjectIdPipe } from '../common/validation.js';
import {
  AssignDto,
  AttachmentDto,
  ChecklistItemDto,
  CommentDto,
  CreateTaskDto,
  RequestChangesDto,
  ReviewNoteDto,
  TaskQueryDto,
  TimeEntryDto,
  ToggleChecklistDto,
  UpdateProgressDto,
  UpdateStatusDto,
  UpdateTaskDto,
} from './dto.js';
import { TaskPresenter } from './task.presenter.js';
import { TasksService } from './tasks.service.js';

@ApiTags('Tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: TaskQueryDto) {
    return this.tasks.list(user, q);
  }

  @Get('assignable-users')
  @RequirePermissions('tasks.assign')
  assignable(@CurrentUser() user: AuthUser) {
    return this.tasks.assignableUsers(user);
  }

  @Post()
  @RequirePermissions('tasks.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTaskDto) {
    return this.tasks.create(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.tasks.get(user, id);
  }

  @Get(':id/activity')
  activity(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.tasks.activityFor(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(user, id, dto);
  }

  @Patch(':id/status')
  status(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateStatusDto) {
    return this.tasks.updateStatus(user, id, dto.status, dto.reason);
  }

  @Patch(':id/progress')
  progress(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateProgressDto) {
    return this.tasks.updateProgress(user, id, dto.progressPercentage);
  }

  @Post(':id/assignments')
  @RequirePermissions('tasks.assign')
  assign(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: AssignDto) {
    return this.tasks.assign(user, id, dto);
  }

  @Post(':id/comments')
  comment(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: CommentDto) {
    return this.tasks.addComment(user, id, dto.body);
  }

  @Post(':id/time-entries')
  logTime(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: TimeEntryDto) {
    return this.tasks.logTime(user, id, dto);
  }

  @Post(':id/attachments')
  attach(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: AttachmentDto) {
    return this.tasks.addAttachment(user, id, dto);
  }

  @Post(':id/checklist')
  addChecklist(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: ChecklistItemDto) {
    return this.tasks.addChecklistItem(user, id, dto.label);
  }

  @Patch(':id/checklist/:itemId')
  toggleChecklist(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('itemId', ParseObjectIdPipe) itemId: string,
    @Body() dto: ToggleChecklistDto,
  ) {
    return this.tasks.toggleChecklistItem(user, id, itemId, dto.done);
  }

  @Post(':id/submit-review')
  submitReview(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: ReviewNoteDto) {
    return this.tasks.submitForReview(user, id, dto.note);
  }

  @Post(':id/approve')
  @RequirePermissions('tasks.review')
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: ReviewNoteDto) {
    return this.tasks.review(user, id, 'approve', dto.note);
  }

  @Post(':id/request-changes')
  @RequirePermissions('tasks.review')
  requestChanges(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: RequestChangesDto) {
    return this.tasks.review(user, id, 'request_changes', dto.note);
  }
}

@Module({
  imports: [CommentsModule],
  controllers: [TasksController],
  providers: [TasksService, TaskPresenter],
  exports: [TasksService, TaskPresenter],
})
export class TasksModule {}
