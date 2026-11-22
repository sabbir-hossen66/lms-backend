import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getStudentDashboardMetrics(userId: string) {
    // 1. Fetch active enrollments with course and videos
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        userId,
        status: 'ACTIVE',
      },
      include: {
        course: {
          include: {
            videos: {
              orderBy: { order: 'asc' },
              select: {
                id: true,
                title: true,
                duration: true,
                order: true,
              },
            },
          },
        },
      },
    });

    // 2. Fetch all video progress for this student
    const allProgress = await this.prisma.videoProgress.findMany({
      where: { userId },
      include: {
        video: {
          select: {
            id: true,
            title: true,
            duration: true,
            courseId: true,
            course: {
              select: {
                id: true,
                title: true,
                thumbnail: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const progressMap = new Map<string, (typeof allProgress)[0]>();
    allProgress.forEach((p) => progressMap.set(p.videoId, p));

    // Stats calculations
    const enrolledCoursesCount = enrollments.length;
    let totalEnrolledVideos = 0;
    let videosCompletedCount = 0;
    let totalWatchTimeSeconds = 0;

    allProgress.forEach((p) => {
      totalWatchTimeSeconds += p.watchedSeconds;
      if (p.completed) videosCompletedCount++;
    });

    // Per-Course Progress breakdown
    const courseProgressList = enrollments.map((e) => {
      const c = e.course;
      const totalVideos = c.videos.length;
      totalEnrolledVideos += totalVideos;

      let courseCompletedCount = 0;
      let courseWatchedSec = 0;

      c.videos.forEach((v) => {
        const prog = progressMap.get(v.id);
        if (prog) {
          courseWatchedSec += prog.watchedSeconds;
          if (prog.completed) courseCompletedCount++;
        }
      });

      const percentage =
        totalVideos > 0 ? Math.round((courseCompletedCount / totalVideos) * 100) : 0;

      return {
        courseId: c.id,
        title: c.title,
        thumbnail: c.thumbnail,
        totalVideos,
        completedVideos: courseCompletedCount,
        progressPercentage: percentage,
        watchedSeconds: courseWatchedSec,
        firstVideoId: c.videos[0]?.id || null,
      };
    });

    const overallProgressPercentage =
      totalEnrolledVideos > 0
        ? Math.round((videosCompletedCount / totalEnrolledVideos) * 100)
        : 0;

    // Continue Watching item
    const continueItem =
      allProgress.find((p) => !p.completed) || allProgress[0] || null;

    const continueWatching = continueItem
      ? {
          videoId: continueItem.video.id,
          videoTitle: continueItem.video.title,
          courseId: continueItem.video.courseId,
          courseTitle: continueItem.video.course.title,
          thumbnail: continueItem.video.course.thumbnail,
          lastPosition: continueItem.lastPosition,
          duration: continueItem.video.duration,
          percentage:
            continueItem.video.duration > 0
              ? Math.min(
                  100,
                  Math.round((continueItem.lastPosition / continueItem.video.duration) * 100),
                )
              : 0,
        }
      : null;

    // 3. Last 7 Days Daily Watch Time Analytics
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const watchSessions = await this.prisma.watchSession.findMany({
      where: {
        userId,
        date: { gte: sevenDaysAgo },
      },
    });

    // Aggregate by day
    const dayMap = new Map<string, number>();
    const daysArray: Array<{ date: string; dayName: string; minutes: number }> = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const isoDate = d.toISOString().split('T')[0];
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      dayMap.set(isoDate, 0);
      daysArray.push({ date: isoDate, dayName, minutes: 0 });
    }

    watchSessions.forEach((s) => {
      const dateKey = s.date.toISOString().split('T')[0];
      if (dayMap.has(dateKey)) {
        dayMap.set(dateKey, (dayMap.get(dateKey) || 0) + s.watchedSeconds);
      }
    });

    daysArray.forEach((d) => {
      const totalSec = dayMap.get(d.date) || 0;
      d.minutes = Math.round((totalSec / 60) * 10) / 10;
    });

    return {
      overview: {
        enrolledCoursesCount,
        videosCompletedCount,
        totalWatchTimeSeconds,
        overallProgressPercentage,
      },
      continueWatching,
      courseProgressList,
      dailyWatchTime: daysArray,
      recentActivity: allProgress.slice(0, 5).map((p) => ({
        videoId: p.videoId,
        videoTitle: p.video.title,
        courseTitle: p.video.course.title,
        completed: p.completed,
        updatedAt: p.updatedAt,
      })),
    };
  }
}
