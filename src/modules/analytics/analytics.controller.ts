import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller({ path: 'analytics', version: '1' })
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  @Get('student-dashboard')
  @ApiOperation({ summary: 'Get student dashboard stats, continue watching & charts' })
  async getStudentDashboard(@CurrentUser('id') userId: string) {
    return this.analyticsService.getStudentDashboardMetrics(userId);
  }
}
