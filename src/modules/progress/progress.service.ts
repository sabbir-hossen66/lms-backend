import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { AuthUser } from '../../common/types/auth-user.type';
import { Role } from '@prisma/client';

@Injectable()
export class ProgressService {
  private readonly logger = new Logger(ProgressService.name);

  constructor(private prisma: PrismaService) {}

  async recordHeartbeat(dto: HeartbeatDto, user: AuthUser) {
    const video = await this.prisma.video.findUnique({
      where: { id: dto.videoId },
      include: { course: true },
    });

    if (!video) {
      throw new NotFoundException('Video not found');
    }

    // Verify enrollment if not admin
    if (user.role !== Role.ADMIN) {
      const enrollment = await this.prisma.enrollment.findUnique({
        where: {
          userId_courseId: {
            userId: user.id,
            courseId: video.courseId,
          },
        },
      });

      if (!enrollment || enrollment.status !== 'ACTIVE') {
        throw new ForbiddenException('Cannot record progress for a course you are not actively enrolled in');
      }
    }

    // Anti-Abuse Checks:
    // 1. Position cannot exceed video duration + buffer
    const maxAllowedPos = video.duration > 0 ? video.duration + 5 : 86400;
    const sanitizedPosition = Math.min(dto.currentPosition, maxAllowedPos);

    // 2. Watched delta cannot exceed 35 seconds per beat
    const sanitizedDelta = Math.min(Math.max(0, dto.watchedDelta), 35);

    // Check existing progress
    const existing = await this.prisma.videoProgress.findUnique({
      where: {
        userId_videoId: {
          userId: user.id,
          videoId: video.id,
        },
      },
    });

    const newWatchedSeconds = (existing?.watchedSeconds || 0) + sanitizedDelta;
    // Mark completed if >= 90% of duration is reached or watched
    const isCompleted =
      existing?.completed ||
      (video.duration > 0 &&
        (sanitizedPosition >= video.duration * 0.9 ||
          newWatchedSeconds >= video.duration * 0.9));

    const progress = await this.prisma.videoProgress.upsert({
      where: {
        userId_videoId: {
          userId: user.id,
          videoId: video.id,
        },
      },
      update: {
        lastPosition: sanitizedPosition,
        watchedSeconds: newWatchedSeconds,
        completed: isCompleted,
      },
      create: {
        userId: user.id,
        videoId: video.id,
        lastPosition: sanitizedPosition,
        watchedSeconds: newWatchedSeconds,
        completed: isCompleted,
      },
    });

    // Record or update daily watch session for analytics
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await this.prisma.watchSession.upsert({
      where: {
        userId_videoId_date: {
          userId: user.id,
          videoId: video.id,
          date: today,
        },
      },
      update: {
        watchedSeconds: { increment: sanitizedDelta },
      },
      create: {
        userId: user.id,
        videoId: video.id,
        courseId: video.courseId,
        date: today,
        watchedSeconds: sanitizedDelta,
      },
    });

    return {
      progress: {
        lastPosition: progress.lastPosition,
        watchedSeconds: progress.watchedSeconds,
        completed: progress.completed,
      },
    };
  }
}
