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
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { VideosService } from './videos.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/types/auth-user.type';
import { Role } from '@prisma/client';
import { CourseAccessGuard } from '../../common/guards/course-access.guard';
import { UploadedFileInput, IStorageService, STORAGE_SERVICE } from '../storage/storage.interface';
import { FileSecurityUtil } from '../storage/file-security.util';

@ApiTags('Videos')
@ApiBearerAuth()
@Controller({ path: 'videos', version: '1' })
export class VideosController {
  constructor(
    private videosService: VideosService,
    @Inject(STORAGE_SERVICE) private storageService: IStorageService,
  ) {}

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
  @Post('upload-thumbnail')
  @ApiOperation({ summary: 'Admin upload video thumbnail image' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    }),
  )
  async uploadThumbnail(@UploadedFile() file: UploadedFileInput) {
    FileSecurityUtil.validateImageUpload(file);
    const meta = await this.storageService.saveFile(file, 'thumbnails');
    return {
      thumbnailUrl: `/uploads/${meta.storageKey}`,
      storageKey: meta.storageKey,
    };
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

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get video metadata (enrolled students, free preview, & admin)' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.videosService.findOne(id, user);
  }

  @Public()
  @Get(':id/stream')
  @UseGuards(CourseAccessGuard)
  @ApiOperation({ summary: 'Range-stream authenticated video content with HTTP 206 Partial Content' })
  async streamVideo(
    @Param('id') id: string,
    @Headers('range') range: string | undefined,
    @CurrentUser() user: AuthUser | undefined,
    @Res() res: Response,
  ) {
    await this.videosService.streamVideo(id, range, user, res);
  }
}
