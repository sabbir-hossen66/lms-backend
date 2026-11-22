import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseInterceptors,
  UploadedFile,
  ParseIntPipe,
  DefaultValuePipe,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/types/auth-user.type';
import { Role, CourseStatus } from '@prisma/client';
import { FileSecurityUtil } from '../storage/file-security.util';
import { IStorageService, STORAGE_SERVICE, UploadedFileInput } from '../storage/storage.interface';

@ApiTags('Courses')
@Controller({ path: 'courses', version: '1' })
export class CoursesController {
  constructor(
    private coursesService: CoursesService,
    @Inject(STORAGE_SERVICE) private storageService: IStorageService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List courses (public sees published, admin sees all)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: CourseStatus })
  async findAll(
    @CurrentUser() user: AuthUser | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('status') status?: CourseStatus,
  ) {
    return this.coursesService.findAll(user, page, limit, search, status);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get course details with video modules outline' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.coursesService.findOne(id, user);
  }

  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Admin create a new course' })
  async create(
    @Body() dto: CreateCourseDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.coursesService.create(dto, adminId);
  }

  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Admin update course details' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCourseDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.coursesService.update(id, dto, adminId);
  }

  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: 'Admin delete course' })
  async delete(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.coursesService.delete(id, adminId);
  }

  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Post('upload-thumbnail')
  @ApiOperation({ summary: 'Admin upload course thumbnail image' })
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
}
