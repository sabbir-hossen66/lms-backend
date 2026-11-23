import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAllStudents(page = 1, limit = 20, search?: string, role?: Role) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (role) {
      where.role = role;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, students] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          role: true,
          isBlocked: true,
          createdAt: true,
          _count: {
            select: {
              enrollments: true,
              accessRequests: true,
            },
          },
        },
      }),
    ]);

    return {
      items: students,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        isBlocked: true,
        createdAt: true,
        enrollments: {
          include: {
            course: true,
          },
        },
        videoProgress: {
          include: {
            video: {
              select: {
                id: true,
                title: true,
                duration: true,
                course: {
                  select: { id: true, title: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async toggleBlockStatus(id: string, currentAdminId: string) {
    if (id === currentAdminId) {
      throw new BadRequestException('You cannot block your own admin account');
    }

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isBlocked: !user.isBlocked },
      select: {
        id: true,
        email: true,
        name: true,
        isBlocked: true,
      },
    });

    // If blocked, invalidate all active refresh tokens immediately
    if (updated.isBlocked) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    return updated;
  }

  async updateUserRole(id: string, newRole: Role, currentAdminId: string) {
    if (id === currentAdminId && newRole !== Role.ADMIN) {
      throw new BadRequestException('You cannot remove your own admin privileges');
    }

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.email === 'sabbir.ms2000@gmail.com' && newRole === Role.STUDENT) {
      throw new BadRequestException('Cannot remove the primary administrator account (Sabbir Hossen)');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { role: newRole },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isBlocked: true,
      },
    });

    // If demoted to student, revoke active refresh tokens so permissions update on next refresh
    if (newRole === Role.STUDENT) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    // Log admin action to AuditLog
    await this.prisma.auditLog.create({
      data: {
        actorId: currentAdminId,
        action: newRole === Role.ADMIN ? 'USER_PROMOTED_TO_ADMIN' : 'ADMIN_DEMOTED_TO_STUDENT',
        targetType: 'User',
        targetId: id,
        details: {
          targetEmail: user.email,
          targetName: user.name,
          previousRole: user.role,
          newRole,
        },
      },
    });

    return updated;
  }
}
