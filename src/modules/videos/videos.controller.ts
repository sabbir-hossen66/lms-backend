import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Headers,
  Res,
  UseInterceptors,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { VideosService } from './videos.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/types/auth-user.type';
import { Role } from '@prisma/client';
import { CourseAccessGuard } from '../../common/guards/course-access.guard';
import { UploadedFileInput } from '../storage/storage.interface';

@ApiTags('Videos')
@ApiBearerAuth()
@Controller({ path: 'videos', version: '1' })
export class VideosController {
  constructor(private videosService: VideosService) {}

  @Roles(Role.ADMIN)
  @Post('upload')
  @ApiOperation({ summary: 'Admin upload raw video file' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max video size
    }),
  )
  async uploadVideo(@UploadedFile() file: UploadedFileInput) {
    return this.videosService.uploadVideo(file);
  }

  @Roles(Role.ADMIN)
  @Post()
  @ApiOperation({ summary: 'Admin create video metadata in course' })
  async create(
    @Body() dto: CreateVideoDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.videosService.create(dto, adminId);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  @ApiOperation({ summary: 'Admin update video details' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateVideoDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.videosService.update(id, dto, adminId);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  @ApiOperation({ summary: 'Admin delete video and file' })
  async delete(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.videosService.delete(id, adminId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get video metadata (enrolled students & admin)' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.videosService.findOne(id, user);
  }

  @Get(':id/stream')
  @UseGuards(CourseAccessGuard)
  @ApiOperation({ summary: 'Range-stream authenticated video content with HTTP 206 Partial Content' })
  async streamVideo(
    @Param('id') id: string,
    @Headers('range') range: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    await this.videosService.streamVideo(id, range, user, res);
  }
}
