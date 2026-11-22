import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';

describe('Manual bKash Payment Request Flow & Access Activation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string[] = [];
  let studentCookie: string[] = [];
  let studentId: string;
  let testCourseId: string;
  let accessRequestId: string;
  const uniqueTrxId = `BKASH${Date.now().toString().slice(-8)}`;

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

    // Login Admin
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@lms.local', password: 'AdminPassword123!' });
    adminCookie = (adminLogin.headers['set-cookie'] as unknown as string[]) || [];

    // Register a fresh student for payment flow testing
    const newStudent = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Payment Test Student',
        email: `paystudent_${Date.now()}@example.com`,
        password: 'Password123!',
        phone: '+8801755554433',
      });
    studentCookie = (newStudent.headers['set-cookie'] as unknown as string[]) || [];
    studentId = newStudent.body.data.user.id;

    // Create a published test course
    const courseRes = await request(app.getHttpServer())
      .post('/api/v1/courses')
      .set('Cookie', adminCookie)
      .send({
        title: 'Payment Flow Test Course',
        description: 'Testing manual payment approval',
        price: 3000,
        status: 'PUBLISHED',
      });
    testCourseId = courseRes.body.data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Student submits valid bKash access request', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/access-requests')
      .set('Cookie', studentCookie)
      .send({
        courseId: testCourseId,
        senderNumber: '01712345678',
        trxId: uniqueTrxId,
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.trxId).toBe(uniqueTrxId);
    expect(res.body.data.amount).toBe(3000);
    accessRequestId = res.body.data.id;
  });

  it('2. Prevent duplicate pending requests for same course', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/access-requests')
      .set('Cookie', studentCookie)
      .send({
        courseId: testCourseId,
        senderNumber: '01712345678',
        trxId: `DIFF${Date.now()}`,
      })
      .expect(409);

    expect(res.body.success).toBe(false);
  });

  it('3. Prevent duplicate TrxID reuse across the platform', async () => {
    // Another student submits same TrxID
    const res = await request(app.getHttpServer())
      .post('/api/v1/access-requests')
      .set('Cookie', studentCookie)
      .send({
        courseId: 'c0000000-0000-0000-0000-000000000001',
        senderNumber: '01712345678',
        trxId: uniqueTrxId, // reuse!
      })
      .expect(409);

    expect(res.body.success).toBe(false);
  });

  it('4. Student can view their own requests (IDOR safe)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/access-requests/my')
      .set('Cookie', studentCookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((r: any) => r.trxId === uniqueTrxId)).toBe(true);
  });

  it('5. Deny student from accessing admin payment requests table', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/access-requests')
      .set('Cookie', studentCookie)
      .expect(403);
  });

  it('6. Admin can view and filter payment requests', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/access-requests')
      .set('Cookie', adminCookie)
      .query({ status: 'PENDING' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.total).toBeGreaterThan(0);
  });

  it('7. Admin approves request in transaction and activates enrollment', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/access-requests/${accessRequestId}/review`)
      .set('Cookie', adminCookie)
      .send({
        status: 'APPROVED',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('APPROVED');

    // Verify enrollment created in database
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        userId_courseId: {
          userId: studentId,
          courseId: testCourseId,
        },
      },
    });

    expect(enrollment).toBeDefined();
    expect(enrollment?.status).toBe('ACTIVE');
  });

  it('8. Admin can manually revoke enrollment access', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/access-requests/manual-access')
      .set('Cookie', adminCookie)
      .send({
        userId: studentId,
        courseId: testCourseId,
        status: 'REVOKED',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('REVOKED');
  });
});
