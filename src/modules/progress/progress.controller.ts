import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ProgressService } from './progress.service';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/types/auth-user.type';

@ApiTags('Progress')
@ApiBearerAuth()
@Controller({ path: 'progress', version: '1' })
export class ProgressController {
  constructor(private progressService: ProgressService) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // max 30 heartbeats per minute per user/ip
  @Post('heartbeat')
  @ApiOperation({ summary: 'Send progress heartbeat (every ~10s or pause/exit)' })
  async heartbeat(
    @Body() dto: HeartbeatDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.progressService.recordHeartbeat(dto, user);
  }
}
