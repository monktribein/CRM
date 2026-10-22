import { Controller, ForbiddenException, Get, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { can, type AuthUser } from '../common/auth-user.js';
import { csvFile } from '../common/csv.js';
import { CurrentUser, RequirePermissions } from '../common/decorators.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { ReportQueryDto } from './report-query.dto.js';
import { ReportsService } from './reports.service.js';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly reports: ReportsService) {}

  /** Role-aware summary: admin, manager or employee view. */
  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.reports.summary(user);
  }

  @Get('workload')
  @RequirePermissions('dashboard.manager', 'dashboard.admin')
  workload(@CurrentUser() user: AuthUser) {
    return this.reports.workload(user);
  }

  @Get('team-performance')
  @RequirePermissions('dashboard.manager', 'dashboard.admin')
  teamPerformance(@CurrentUser() user: AuthUser) {
    return this.reports.teamPerformance(user);
  }
}

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
@RequirePermissions('reports.view')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  private assertExport(user: AuthUser) {
    if (!can(user, 'reports.export')) throw new ForbiddenException("You don't have permission to export reports.");
  }

  private suffix(q: ReportQueryDto) {
    return `${(q.from ?? '').slice(0, 10) || 'start'}-to-${(q.to ?? '').slice(0, 10) || 'today'}`;
  }

  @Get('tasks')
  async tasks(@CurrentUser() user: AuthUser, @Query() q: ReportQueryDto) {
    if (q.format === 'csv') {
      this.assertExport(user);
      return csvFile(await this.reports.taskRows(user, q), `bizwoke-tasks-${this.suffix(q)}.csv`);
    }
    return this.reports.taskReport(user, q);
  }

  @Get('employees')
  async employees(@CurrentUser() user: AuthUser, @Query() q: ReportQueryDto) {
    const rows = await this.reports.employeeReport(user, q);
    if (q.format === 'csv') {
      this.assertExport(user);
      return csvFile(rows, `bizwoke-employees-${this.suffix(q)}.csv`);
    }
    return rows;
  }

  @Get('departments')
  async departments(@CurrentUser() user: AuthUser, @Query() q: ReportQueryDto) {
    const rows = await this.reports.departmentReport(user, q);
    if (q.format === 'csv') {
      this.assertExport(user);
      return csvFile(rows, `bizwoke-departments-${this.suffix(q)}.csv`);
    }
    return rows;
  }
}

@Module({
  imports: [TasksModule],
  controllers: [DashboardController, ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
