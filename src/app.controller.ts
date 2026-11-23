import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  @Public()
  @Get()
  root() {
    return { status: 'ok', message: 'LMS Backend API is live and healthy!' };
  }

  @Public()
  @Get('health')
  health() {
    return { status: 'ok', uptime: process.uptime() };
  }
}
