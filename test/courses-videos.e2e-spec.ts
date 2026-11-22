import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { Role, EnrollmentStatus } from '@prisma/client';

describe('Courses, Videos & Range Streaming (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string[] = [];
  let studentCookie: string[] = [];
  let studentId: string;
  let courseId: string;
  let videoId: string;

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

    // Ensure student is unblocked
    await prisma.user.updateMany({
      where: { email: 'student@lms.local' },
      data: { isBlocked: false },
    });

    // Login Admin
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@lms.local', password: 'AdminPassword123!' });
    adminCookie = (adminLogin.headers['set-cookie'] as unknown as string[]) || [];

    // Login Sample Student
    const studentLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'student@lms.local', password: 'StudentPassword123!' });
    studentCookie = (studentLogin.headers['set-cookie'] as unknown as string[]) || [];
    studentId = studentLogin.body.data.user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Public catalog: list published courses without auth', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/courses')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.items.length).toBeGreaterThan(0);
  });

  it('2. Deny student from creating a new course', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/courses')
      .set('Cookie', studentCookie)
      .send({
        title: 'Unauthorized Course',
        description: 'Should fail because student is not admin',
        price: 1000,
      })
      .expect(403);

    expect(res.body.success).toBe(false);
  });

  it('3. Admin creates a new course', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/courses')
      .set('Cookie', adminCookie)
      .send({
        title: 'Phase 2 Test Course',
        description: 'Testing video streaming and course access',
        price: 1500,
        status: 'PUBLISHED',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    courseId = res.body.data.id;
    expect(courseId).toBeDefined();
  });

  it('4. Admin adds video metadata to the course', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/videos')
      .set('Cookie', adminCookie)
      .send({
        courseId,
        title: 'Lesson 01 - Getting Started',
        description: 'First video',
        order: 1,
        duration: 120,
        storageKey: 'sample-intro.mp4',
        mimeType: 'video/mp4',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    videoId = res.body.data.id;
    expect(videoId).toBeDefined();
  });

  it('5. Deny unauthenticated range-stream request', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/videos/${videoId}/stream`)
      .set('Range', 'bytes=0-1024')
      .expect(401);
  });

  it('6. Deny un-enrolled student from streaming video', async () => {
    // Student is not enrolled in courseId
    await request(app.getHttpServer())
      .get(`/api/v1/videos/${videoId}/stream`)
      .set('Cookie', studentCookie)
      .set('Range', 'bytes=0-1024')
      .expect(403);
  });

  it('7. Admin can stream video with HTTP 206 Range request', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/videos/${videoId}/stream`)
      .set('Cookie', adminCookie)
      .set('Range', 'bytes=0-1023')
      .expect(206);

    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-range']).toBe('bytes 0-1023/102400');
    expect(res.headers['content-length']).toBe('1024');
    expect(res.headers['content-type']).toContain('video/mp4');
    expect(res.headers['cache-control']).toBe('private, no-store, no-cache, must-revalidate');
  });

  it('8. Student with ACTIVE enrollment can stream video with Range header', async () => {
    // Enroll student in course
    await prisma.enrollment.create({
      data: {
        userId: studentId,
        courseId,
        status: EnrollmentStatus.ACTIVE,
        grantedBy: 'ADMIN_TEST',
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/videos/${videoId}/stream`)
      .set('Cookie', studentCookie)
      .set('Range', 'bytes=2048-4095')
      .expect(206);

    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-range']).toBe('bytes 2048-4095/102400');
    expect(res.headers['content-length']).toBe('2048');
  });

  it('9. Revoked student instantly loses video stream access (checked on every stream request)', async () => {
    // Revoke enrollment
    await prisma.enrollment.update({
      where: {
        userId_courseId: {
          userId: studentId,
          courseId,
        },
      },
      data: {
        status: EnrollmentStatus.REVOKED,
      },
    });

    // Immediate stream request must fail with 403 Forbidden
    await request(app.getHttpServer())
      .get(`/api/v1/videos/${videoId}/stream`)
      .set('Cookie', studentCookie)
      .set('Range', 'bytes=0-1024')
      .expect(403);
  });
});
