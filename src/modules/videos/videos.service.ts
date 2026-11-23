import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Inject,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { AuthUser } from '../../common/types/auth-user.type';
import { Role, EnrollmentStatus } from '@prisma/client';
import { IStorageService, STORAGE_SERVICE, UploadedFileInput } from '../storage/storage.interface';
import { FileSecurityUtil } from '../storage/file-security.util';

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private storageService: IStorageService,
  ) {}

  async uploadVideo(file: UploadedFileInput) {
    FileSecurityUtil.validateVideoUpload(file);

    // Auto-detect duration from buffer if MP4
    let duration = 0;
    if (file.buffer) {
      duration = FileSecurityUtil.parseMp4Duration(file.buffer);
    }

    const saved = await this.storageService.saveFile(file, 'videos');

    return {
      storageKey: saved.storageKey,
      fileSize: saved.size,
      mimeType: saved.mimeType,
      duration,
    };
  }

  async create(dto: CreateVideoDto, adminId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    const video = await this.prisma.video.create({
      data: {
        courseId: dto.courseId,
        title: dto.title.trim(),
        description: dto.description?.trim(),
        thumbnailUrl: dto.thumbnailUrl,
        isFreePreview: dto.isFreePreview || false,
        moduleName: dto.moduleName?.trim() || 'Module 1: Getting Started',
        order: dto.order,
        duration: dto.duration || 0,
        storageKey: dto.storageKey,
        mimeType: dto.mimeType || 'video/mp4',
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'VIDEO_CREATE',
        targetType: 'Video',
        targetId: video.id,
        details: { courseId: video.courseId, title: video.title },
      },
    });

    return video;
  }

  async update(id: string, dto: UpdateVideoDto, adminId: string) {
    const video = await this.prisma.video.findUnique({ where: { id } });
    if (!video) {
      throw new NotFoundException('Video not found');
    }

    const updated = await this.prisma.video.update({
      where: { id },
      data: {
        ...(dto.title && { title: dto.title.trim() }),
        ...(dto.description !== undefined && { description: dto.description?.trim() }),
        ...(dto.thumbnailUrl !== undefined && { thumbnailUrl: dto.thumbnailUrl }),
        ...(dto.isFreePreview !== undefined && { isFreePreview: dto.isFreePreview }),
        ...(dto.moduleName !== undefined && { moduleName: dto.moduleName?.trim() }),
        ...(dto.order !== undefined && { order: dto.order }),
        ...(dto.duration !== undefined && { duration: dto.duration }),
        ...(dto.storageKey && { storageKey: dto.storageKey }),
        ...(dto.mimeType && { mimeType: dto.mimeType }),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'VIDEO_UPDATE',
        targetType: 'Video',
        targetId: id,
        details: dto as any,
      },
    });

    return updated;
  }

  async delete(id: string, adminId: string) {
    const video = await this.prisma.video.findUnique({ where: { id } });
    if (!video) {
      throw new NotFoundException('Video not found');
    }

    if (video.storageKey) {
      await this.storageService.deleteFile(video.storageKey);
    }

    await this.prisma.video.delete({ where: { id } });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'VIDEO_DELETE',
        targetType: 'Video',
        targetId: id,
        details: { title: video.title, courseId: video.courseId },
      },
    });

    return { message: 'Video successfully removed' };
  }

  async findOne(id: string, user?: AuthUser) {
    const video = await this.prisma.video.findUnique({
      where: { id },
      include: {
        course: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    if (!video) {
      throw new NotFoundException('Video not found');
    }

    // Check course access
    await this.assertAccess(video.courseId, video.id, user);

    return video;
  }

  async streamVideo(
    videoId: string,
    rangeHeader: string | undefined,
    user: AuthUser | undefined,
    res: Response,
  ) {
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
    });

    if (!video) {
      throw new NotFoundException('Video not found');
    }

    // Check active access on EVERY stream request
    await this.assertAccess(video.courseId, video.id, user);

    let start: number | undefined;
    let end: number | undefined;

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (match) {
        if (match[1]) start = parseInt(match[1], 10);
        if (match[2]) end = parseInt(match[2], 10);
      }
    }

    const streamResult = await this.storageService.getRangeStream(video.storageKey, {
      start,
      end,
    });

    // Set HTTP 206 Partial Content headers
    res.status(206);
    res.set({
      'Content-Range': `bytes ${streamResult.start}-${streamResult.end}/${streamResult.totalSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': streamResult.chunkSize.toString(),
      'Content-Type': video.mimeType || streamResult.mimeType || 'video/mp4',
      'Cache-Control': 'private, no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    });

    streamResult.stream.pipe(res);
  }

  private async assertAccess(courseId: string, videoId: string, user?: AuthUser) {
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      select: { isFreePreview: true, order: true },
    });

    // If marked as free preview or first lesson, allow anyone (including guests) to watch!
    if (video && (video.isFreePreview || video.order === 0 || video.order === 1)) {
      return;
    }

    if (!user) {
      throw new ForbiddenException('Authentication required to stream this video');
    }

    if (user.role === Role.ADMIN) {
      return;
    }

    const enrollment = await this.prisma.enrollment.findUnique({
      where: {
        userId_courseId: {
          userId: user.id,
          courseId,
        },
      },
      include: {
        videoAccesses: {
          where: { videoId },
        },
      },
    });

    if (!enrollment || enrollment.status !== EnrollmentStatus.ACTIVE) {
      throw new ForbiddenException(
        'Access denied: You do not have an active enrollment for this course.',
      );
    }

    if (enrollment.videoAccesses.length > 0 && !enrollment.videoAccesses[0].isAllowed) {
      throw new ForbiddenException('Access to this video has been restricted by an administrator.');
    }
  }
}
