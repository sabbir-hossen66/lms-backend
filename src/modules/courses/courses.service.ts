import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { CourseStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { AuthUser } from '../../common/types/auth-user.type';
import { IStorageService, STORAGE_SERVICE } from '../storage/storage.interface';

@Injectable()
export class CoursesService {
  constructor(
    private prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private storageService: IStorageService,
  ) {}

  async findAll(
    user?: AuthUser,
    page = 1,
    limit = 20,
    search?: string,
    statusFilter?: CourseStatus,
  ) {
    const skip = (page - 1) * limit;
    const isAdmin = user?.role === Role.ADMIN;

    const where: any = {};

    if (!isAdmin) {
      where.status = CourseStatus.PUBLISHED;
    } else if (statusFilter) {
      where.status = statusFilter;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, courses] = await Promise.all([
      this.prisma.course.count({ where }),
      this.prisma.course.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: {
              videos: true,
              enrollments: true,
            },
          },
        },
      }),
    ]);

    // Check enrollment for student if logged in
    let enrolledCourseIds = new Set<string>();
    if (user && user.role === Role.STUDENT) {
      const enrollments = await this.prisma.enrollment.findMany({
        where: {
          userId: user.id,
          status: 'ACTIVE',
        },
        select: { courseId: true },
      });
      enrolledCourseIds = new Set(enrollments.map((e) => e.courseId));
    }

    const items = courses.map((course) => ({
      ...course,
      isEnrolled: isAdmin ? true : enrolledCourseIds.has(course.id),
      totalVideos: course._count.videos,
      totalStudents: course._count.enrollments,
    }));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, user?: AuthUser) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        videos: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            title: true,
            description: true,
            thumbnailUrl: true,
            isFreePreview: true,
            moduleName: true,
            order: true,
            duration: true,
            createdAt: true,
          },
        },
        _count: {
          select: { enrollments: true },
        },
      },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    const isAdmin = user?.role === Role.ADMIN;
    let isEnrolled = false;
    let userProgressMap: Record<string, any> = {};

    if (user) {
      if (isAdmin) {
        isEnrolled = true;
      } else {
        const enrollment = await this.prisma.enrollment.findUnique({
          where: {
            userId_courseId: {
              userId: user.id,
              courseId: id,
            },
          },
        });
        isEnrolled = enrollment?.status === 'ACTIVE';

        // Load progress for videos
        if (isEnrolled) {
          const progresses = await this.prisma.videoProgress.findMany({
            where: {
              userId: user.id,
              videoId: { in: course.videos.map((v) => v.id) },
            },
          });
          userProgressMap = progresses.reduce((acc, curr) => {
            acc[curr.videoId] = curr;
            return acc;
          }, {} as Record<string, any>);
        }
      }
    }

    // Attach locked state and progress
    const videosWithAccess = course.videos.map((v, idx) => ({
      ...v,
      isLocked: !isEnrolled && idx > 0 && !v.isFreePreview,
      progress: userProgressMap[v.id] || null,
    }));

    return {
      ...course,
      isEnrolled,
      videos: videosWithAccess,
      totalVideos: course.videos.length,
      totalStudents: course._count.enrollments,
    };
  }

  async create(dto: CreateCourseDto, adminId: string) {
    const course = await this.prisma.course.create({
      data: {
        title: dto.title.trim(),
        description: dto.description.trim(),
        price: dto.price,
        thumbnail: dto.thumbnail,
        status: dto.status || CourseStatus.DRAFT,
        contentStatus: dto.contentStatus || 'ONGOING',
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'COURSE_CREATE',
        targetType: 'Course',
        targetId: course.id,
        details: { title: course.title, price: course.price },
      },
    });

    return course;
  }

  async update(id: string, dto: UpdateCourseDto, adminId: string) {
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) {
      throw new NotFoundException('Course not found');
    }

    const updated = await this.prisma.course.update({
      where: { id },
      data: {
        ...(dto.title && { title: dto.title.trim() }),
        ...(dto.description && { description: dto.description.trim() }),
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.thumbnail !== undefined && { thumbnail: dto.thumbnail }),
        ...(dto.status && { status: dto.status }),
        ...(dto.contentStatus && { contentStatus: dto.contentStatus }),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'COURSE_UPDATE',
        targetType: 'Course',
        targetId: updated.id,
        details: dto as any,
      },
    });

    return updated;
  }

  async delete(id: string, adminId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: { videos: true },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    // Delete associated physical video files from storage
    for (const v of course.videos) {
      if (v.storageKey) {
        await this.storageService.deleteFile(v.storageKey);
      }
    }

    await this.prisma.course.delete({ where: { id } });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'COURSE_DELETE',
        targetType: 'Course',
        targetId: id,
        details: { title: course.title },
      },
    });

    return { message: 'Course and related assets successfully deleted' };
  }
}
