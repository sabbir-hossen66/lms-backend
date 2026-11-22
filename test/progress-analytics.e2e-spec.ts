import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { EnrollmentStatus } from '@prisma/client';

describe('Progress Tracking & Student Dashboard Analytics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let studentCookie: string[] = [];
  let studentId: string;
  const courseId = 'c0000000-0000-0000-0000-000000000001';
  const videoId = 'v0000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });

    await app.init();
    prisma = app.get(PrismaService);

    // Login Sample Student
    const studentLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'student@lms.local', password: 'StudentPassword123!' });
    studentCookie = (studentLogin.headers['set-cookie'] as unknown as string[]) || [];
    studentId = studentLogin.body.data.user.id;

    // Reset any previous test progress for clean state
    await prisma.videoProgress.deleteMany({ where: { userId: studentId } });
    await prisma.watchSession.deleteMany({ where: { userId: studentId } });

    // Ensure student is actively enrolled in sample course
    await prisma.enrollment.upsert({
      where: {
        userId_courseId: {
          userId: studentId,
          courseId,
        },
      },
      update: { status: EnrollmentStatus.ACTIVE },
      create: {
        userId: studentId,
        courseId,
        status: EnrollmentStatus.ACTIVE,
        grantedBy: 'SEED_ADMIN',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Record progress heartbeat successfully', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/progress/heartbeat')
      .set('Cookie', studentCookie)
      .send({
        videoId,
        currentPosition: 65,
        watchedDelta: 10,
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.progress.lastPosition).toBe(65);
    expect(res.body.data.progress.watchedSeconds).toBeGreaterThanOrEqual(10);
    expect(res.body.data.progress.completed).toBe(false);
  });

  it('2. Anti-abuse: enforce max limits on watchedDelta', async () => {
    // Sending delta > 35 should fail validation pipe
    await request(app.getHttpServer())
      .post('/api/v1/progress/heartbeat')
      .set('Cookie', studentCookie)
      .send({
        videoId,
        currentPosition: 100,
        watchedDelta: 500, // impossible jump
      })
      .expect(400);
  });

  it('3. Auto-mark video as completed when >= 90% watched', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/progress/heartbeat')
      .set('Cookie', studentCookie)
      .send({
        videoId,
        currentPosition: 360, // 360 / 385 duration > 90%
        watchedDelta: 10,
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.progress.completed).toBe(true);
  });

  it('4. Student dashboard returns overview cards, continue watching and charts', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/analytics/student-dashboard')
      .set('Cookie', studentCookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    const data = res.body.data;

    // Overview cards
    expect(data.overview.enrolledCoursesCount).toBeGreaterThanOrEqual(1);
    expect(data.overview.videosCompletedCount).toBeGreaterThanOrEqual(1);
    expect(data.overview.totalWatchTimeSeconds).toBeGreaterThan(0);
    expect(data.overview.overallProgressPercentage).toBeGreaterThanOrEqual(0);

    // Course progress list
    expect(Array.isArray(data.courseProgressList)).toBe(true);
    expect(data.courseProgressList.length).toBeGreaterThanOrEqual(1);
    expect(data.courseProgressList[0].courseId).toBe(courseId);

    // Analytics daily watch time chart
    expect(Array.isArray(data.dailyWatchTime)).toBe(true);
    expect(data.dailyWatchTime.length).toBe(7);
  });
});
