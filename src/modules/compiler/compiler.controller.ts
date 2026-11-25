import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { CompilerService } from './compiler.service';
import { ExecuteCodeDto } from './dto/execute-code.dto';

@Controller('compiler')
@Public()
export class CompilerController {
  constructor(private readonly compilerService: CompilerService) {}

  @Post('execute')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async execute(@Body() dto: ExecuteCodeDto) {
    return this.compilerService.executeCode(dto);
  }
}
