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
    const user = request.user as AuthUser;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    // Admins bypass course access restrictions
    if (user.role === Role.ADMIN) {
      return true;
    }

    // Determine target courseId and videoId
    const params = request.params;
    let courseId = params.courseId;
    const videoId = params.videoId || (request.url.includes('/videos/') ? params.id : undefined);

    if (videoId && !courseId) {
      const video = await this.prisma.video.findUnique({
        where: { id: videoId },
        select: { courseId: true },
      });

      if (!video) {
        throw new NotFoundException('Video not found');
      }
      courseId = video.courseId;
    }

    if (!courseId) {
      // If endpoint is not course-specific, allow
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
