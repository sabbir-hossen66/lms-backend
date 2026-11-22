import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessRequestsService } from './access-requests.service';
import { CreateAccessRequestDto } from './dto/create-access-request.dto';
import { ReviewAccessRequestDto, ManualAccessDto } from './dto/review-access-request.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/types/auth-user.type';
import { Role, RequestStatus } from '@prisma/client';

@ApiTags('Access Requests')
@ApiBearerAuth()
@Controller({ path: 'access-requests', version: '1' })
export class AccessRequestsController {
  constructor(private accessRequestsService: AccessRequestsService) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // rate limit request submissions
  @Post()
  @ApiOperation({ summary: 'Student submit manual bKash transaction ID for course access' })
  async createRequest(
    @Body() dto: CreateAccessRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.accessRequestsService.createRequest(dto, user);
  }

  @Get('my')
  @ApiOperation({ summary: 'Student get their own access requests (IDOR safe)' })
  async getMyRequests(@CurrentUser('id') userId: string) {
    return this.accessRequestsService.getMyRequests(userId);
  }

  @Roles(Role.ADMIN)
  @Get()
  @ApiOperation({ summary: 'Admin list all payment requests with filters' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: RequestStatus })
  @ApiQuery({ name: 'courseId', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  async getAllRequests(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: RequestStatus,
    @Query('courseId') courseId?: string,
    @Query('search') search?: string,
  ) {
    return this.accessRequestsService.getAllRequests(page, limit, status, courseId, search);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/review')
  @ApiOperation({ summary: 'Admin approve or reject payment request in a transaction' })
  async reviewRequest(
    @Param('id') id: string,
    @Body() dto: ReviewAccessRequestDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.accessRequestsService.reviewRequest(id, dto, adminId);
  }

  @Roles(Role.ADMIN)
  @Post('manual-access')
  @ApiOperation({ summary: 'Admin directly grant or revoke student enrollment' })
  async manualAccess(
    @Body() dto: ManualAccessDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.accessRequestsService.manualAccess(dto, adminId);
  }
}
