import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, RequestStatus } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getDashboardStats() {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);
    fourteenDaysAgo.setHours(0, 0, 0, 0);

    const [
      totalStudents,
      totalCourses,
      pendingRequests,
      approvedRequests,
      revenueResult,
      recentSignups,
      signupsHistory,
      approvedRequestsHistory,
      mostWatchedRaw,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: Role.STUDENT } }),
      this.prisma.course.count(),
      this.prisma.accessRequest.count({ where: { status: RequestStatus.PENDING } }),
      this.prisma.accessRequest.count({ where: { status: RequestStatus.APPROVED } }),
      this.prisma.accessRequest.aggregate({
        where: { status: RequestStatus.APPROVED },
        _sum: { amount: true },
      }),
      this.prisma.user.findMany({
        where: { role: Role.STUDENT },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          isBlocked: true,
          createdAt: true,
          _count: { select: { enrollments: true } },
        },
      }),
      this.prisma.user.findMany({
        where: {
          role: Role.STUDENT,
          createdAt: { gte: fourteenDaysAgo },
        },
        select: { createdAt: true },
      }),
      this.prisma.accessRequest.findMany({
        where: {
          status: RequestStatus.APPROVED,
          createdAt: { gte: fourteenDaysAgo },
        },
        select: { createdAt: true, amount: true },
      }),
      this.prisma.watchSession.groupBy({
        by: ['courseId'],
        _sum: { watchedSeconds: true },
        orderBy: {
          _sum: {
            watchedSeconds: 'desc',
          },
        },
        take: 5,
      }),
    ]);

    // Format 14 days chart data
    const daysMap = new Map<string, { date: string; signups: number; revenue: number }>();
    const chartsData: Array<{ date: string; day: string; signups: number; revenue: number }> = [];

    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().split('T')[0];
      const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      daysMap.set(iso, { date: iso, signups: 0, revenue: 0 });
      chartsData.push({ date: iso, day, signups: 0, revenue: 0 });
    }

    signupsHistory.forEach((u) => {
      const key = u.createdAt.toISOString().split('T')[0];
      const item = daysMap.get(key);
      if (item) item.signups++;
    });

    approvedRequestsHistory.forEach((r) => {
      const key = r.createdAt.toISOString().split('T')[0];
      const item = daysMap.get(key);
      if (item) item.revenue += r.amount;
    });

    chartsData.forEach((cd) => {
      const item = daysMap.get(cd.date);
      if (item) {
        cd.signups = item.signups;
        cd.revenue = item.revenue;
      }
    });

    // Populate Most Watched Courses with Titles
    const courseIds = mostWatchedRaw.map((mw) => mw.courseId);
    const coursesInfo = await this.prisma.course.findMany({
      where: { id: { in: courseIds } },
      select: { id: true, title: true, price: true, thumbnail: true },
    });
    const coursesMap = new Map(coursesInfo.map((c) => [c.id, c]));

    const mostWatchedCourses = mostWatchedRaw.map((mw) => {
      const c = coursesMap.get(mw.courseId);
      return {
        courseId: mw.courseId,
        title: c?.title || 'Unknown Course',
        thumbnail: c?.thumbnail || null,
        totalWatchMinutes: Math.round(((mw._sum.watchedSeconds || 0) / 60) * 10) / 10,
      };
    });

    return {
      stats: {
        totalStudents,
        totalCourses,
        pendingRequests,
        approvedRequests,
        revenue: revenueResult._sum.amount || 0,
      },
      charts: chartsData,
      mostWatchedCourses,
      recentSignups,
    };
  }
}
