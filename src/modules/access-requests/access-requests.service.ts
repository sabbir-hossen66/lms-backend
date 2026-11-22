import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccessRequestDto } from './dto/create-access-request.dto';
import { ReviewAccessRequestDto, ManualAccessDto } from './dto/review-access-request.dto';
import { AuthUser } from '../../common/types/auth-user.type';
import { RequestStatus, EnrollmentStatus } from '@prisma/client';

@Injectable()
export class AccessRequestsService {
  constructor(private prisma: PrismaService) {}

  async createRequest(dto: CreateAccessRequestDto, user: AuthUser) {
    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    // 1. Prevent duplicate if already enrolled
    const existingEnrollment = await this.prisma.enrollment.findUnique({
      where: {
        userId_courseId: {
          userId: user.id,
          courseId: course.id,
        },
      },
    });

    if (existingEnrollment && existingEnrollment.status === EnrollmentStatus.ACTIVE) {
      throw new BadRequestException('You are already actively enrolled in this course');
    }

    // 2. Prevent duplicate pending requests for the same course
    const pendingRequest = await this.prisma.accessRequest.findFirst({
      where: {
        userId: user.id,
        courseId: course.id,
        status: RequestStatus.PENDING,
      },
    });

    if (pendingRequest) {
      throw new ConflictException(
        'You already have a pending verification request for this course. Please wait for review.',
      );
    }

    // 3. Normalize TrxID and ensure uniqueness across database
    const normalizedTrxId = dto.trxId.trim().toUpperCase();

    const existingTrx = await this.prisma.accessRequest.findUnique({
      where: { trxId: normalizedTrxId },
    });

    if (existingTrx) {
      throw new ConflictException(
        'This Transaction ID has already been submitted or processed. Each transaction can only be used once.',
      );
    }

    const request = await this.prisma.accessRequest.create({
      data: {
        userId: user.id,
        courseId: course.id,
        amount: course.price,
        senderNumber: dto.senderNumber.trim(),
        trxId: normalizedTrxId,
        status: RequestStatus.PENDING,
      },
      include: {
        course: {
          select: { id: true, title: true, price: true },
        },
      },
    });

    return request;
  }

  async getMyRequests(userId: string) {
    // Strictly scoped to authenticated user (IDOR prevention)
    return this.prisma.accessRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            thumbnail: true,
            price: true,
          },
        },
      },
    });
  }

  async getAllRequests(
    page = 1,
    limit = 20,
    statusFilter?: RequestStatus,
    courseId?: string,
    search?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (statusFilter) {
      where.status = statusFilter;
    }

    if (courseId) {
      where.courseId = courseId;
    }

    if (search) {
      where.OR = [
        { trxId: { contains: search, mode: 'insensitive' } },
        { senderNumber: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.accessRequest.count({ where }),
      this.prisma.accessRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, name: true, email: true, phone: true },
          },
          course: {
            select: { id: true, title: true, price: true },
          },
        },
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async reviewRequest(
    requestId: string,
    dto: ReviewAccessRequestDto,
    adminId: string,
  ) {
    const request = await this.prisma.accessRequest.findUnique({
      where: { id: requestId },
      include: { course: true, user: true },
    });

    if (!request) {
      throw new NotFoundException('Payment request not found');
    }

    if (request.status !== RequestStatus.PENDING) {
      throw new BadRequestException(
        `This request has already been reviewed (${request.status})`,
      );
    }

    // Atomic Database Transaction for Approval/Rejection
    return this.prisma.$transaction(async (tx) => {
      if (dto.status === 'APPROVED') {
        // 1. Update request status
        const updatedRequest = await tx.accessRequest.update({
          where: { id: requestId },
          data: {
            status: RequestStatus.APPROVED,
            reviewedBy: adminId,
          },
        });

        // 2. Activate course enrollment for the student
        await tx.enrollment.upsert({
          where: {
            userId_courseId: {
              userId: request.userId,
              courseId: request.courseId,
            },
          },
          update: {
            status: EnrollmentStatus.ACTIVE,
            grantedBy: adminId,
          },
          create: {
            userId: request.userId,
            courseId: request.courseId,
            status: EnrollmentStatus.ACTIVE,
            grantedBy: adminId,
          },
        });

        // 3. Log Audit Trail
        await tx.auditLog.create({
          data: {
            actorId: adminId,
            action: 'PAYMENT_APPROVE',
            targetType: 'AccessRequest',
            targetId: requestId,
            details: {
              studentEmail: request.user.email,
              courseTitle: request.course.title,
              amount: request.amount,
              trxId: request.trxId,
            },
          },
        });

        return updatedRequest;
      } else {
        // REJECTED
        const updatedRequest = await tx.accessRequest.update({
          where: { id: requestId },
          data: {
            status: RequestStatus.REJECTED,
            reviewedBy: adminId,
            rejectReason: dto.rejectReason || 'Transaction could not be verified',
          },
        });

        await tx.auditLog.create({
          data: {
            actorId: adminId,
            action: 'PAYMENT_REJECT',
            targetType: 'AccessRequest',
            targetId: requestId,
            details: {
              studentEmail: request.user.email,
              trxId: request.trxId,
              reason: dto.rejectReason,
            },
          },
        });

        return updatedRequest;
      }
    });
  }

  async manualAccess(dto: ManualAccessDto, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('Student not found');

    const course = await this.prisma.course.findUnique({ where: { id: dto.courseId } });
    if (!course) throw new NotFoundException('Course not found');

    const enrollment = await this.prisma.enrollment.upsert({
      where: {
        userId_courseId: {
          userId: dto.userId,
          courseId: dto.courseId,
        },
      },
      update: {
        status: dto.status,
        grantedBy: adminId,
      },
      create: {
        userId: dto.userId,
        courseId: dto.courseId,
        status: dto.status,
        grantedBy: adminId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: dto.status === 'ACTIVE' ? 'MANUAL_GRANT_ACCESS' : 'MANUAL_REVOKE_ACCESS',
        targetType: 'Enrollment',
        targetId: enrollment.id,
        details: {
          studentEmail: user.email,
          courseTitle: course.title,
          status: dto.status,
        },
      },
    });

    return enrollment;
  }
}
