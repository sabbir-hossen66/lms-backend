import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { AuthUser } from '../types/auth-user.type';
import { Role, EnrollmentStatus } from '@prisma/client';

@Injectable()
export class CourseAccessGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;

    // Determine target courseId and videoId
    const params = request.params;
    let courseId = params.courseId;
    const videoId = params.videoId || (request.url.includes('/videos/') ? params.id : undefined);

    // If videoId is provided, check if it's a Free Preview video (or first lesson)
    if (videoId) {
      const video = await this.prisma.video.findUnique({
        where: { id: videoId },
        select: { courseId: true, isFreePreview: true, order: true },
      });

      if (!video) {
        throw new NotFoundException('Video not found');
      }

      // If video is marked as free preview or first lesson, allow public / anyone to stream!
      if (video.isFreePreview || video.order === 0 || video.order === 1) {
        return true;
      }

      courseId = video.courseId;
    }

    if (!user) {
      throw new ForbiddenException('Authentication required to access non-preview course videos');
    }

    // Admins bypass course access restrictions
    if (user.role === Role.ADMIN) {
      return true;
    }

    if (!courseId) {
      return true;
    }

    // Check enrollment
    const enrollment = await this.prisma.enrollment.findUnique({
      where: {
        userId_courseId: {
          userId: user.id,
          courseId,
        },
      },
      include: {
        videoAccesses: videoId
          ? {
              where: { videoId },
            }
          : false,
      },
    });

    if (!enrollment || enrollment.status !== EnrollmentStatus.ACTIVE) {
      throw new ForbiddenException(
        'Access denied: You do not have an active enrollment for this course.',
      );
    }

    // Check per-video access restriction if set
    if (videoId && enrollment.videoAccesses && enrollment.videoAccesses.length > 0) {
      const accessOverride = enrollment.videoAccesses[0];
      if (!accessOverride.isAllowed) {
        throw new ForbiddenException('Access to this specific video has been restricted by admin.');
      }
    }

    return true;
  }
}
