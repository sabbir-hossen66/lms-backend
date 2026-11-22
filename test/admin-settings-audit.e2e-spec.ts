import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';

describe('Admin Dashboard, Settings & Audit Logs (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string[] = [];
  let studentCookie: string[] = [];
  let sampleStudentId: string;

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

    // Login Admin
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@lms.local', password: 'AdminPassword123!' });
    adminCookie = (adminLogin.headers['set-cookie'] as unknown as string[]) || [];

    // Login Student
    const studentLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'student@lms.local', password: 'StudentPassword123!' });
    studentCookie = (studentLogin.headers['set-cookie'] as unknown as string[]) || [];
    sampleStudentId = studentLogin.body.data.user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Deny student access to admin dashboard', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/dashboard')
      .set('Cookie', studentCookie)
      .expect(403);
  });

  it('2. Admin gets dashboard stats, charts & metrics', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/dashboard')
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.stats.totalStudents).toBeGreaterThanOrEqual(1);
    expect(res.body.data.stats.totalCourses).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.data.charts)).toBe(true);
  });

  it('3. Public gets public settings (bKash number, site name)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/settings/public')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.bkash_number).toBeDefined();
    expect(res.body.data.site_name).toBeDefined();
  });

  it('4. Admin updates platform settings and verifies persistence', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/settings')
      .set('Cookie', adminCookie)
      .send({
        bkash_number: '01799887766',
        site_name: 'Antigravity LMS Enterprise',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.bkash_number).toBe('01799887766');
    expect(res.body.data.site_name).toBe('Antigravity LMS Enterprise');
  });

  it('5. Admin views audit logs', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.total).toBeGreaterThan(0);
  });

  it('6. Admin toggles student block status', async () => {
    // Create dedicated student for block testing
    const newStudentRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Block Test User',
        email: `block_test_${Date.now()}@example.com`,
        password: 'Password123!',
        phone: '+8801900000001',
      })
      .expect(201);

    const targetStudentId = newStudentRes.body.data.user.id;
    const targetEmail = newStudentRes.body.data.user.email;

    // Block student
    const blockRes = await request(app.getHttpServer())
      .patch(`/api/v1/users/${targetStudentId}/block`)
      .set('Cookie', adminCookie)
      .expect(200);

    expect(blockRes.body.success).toBe(true);
    expect(blockRes.body.data.isBlocked).toBe(true);

    // Blocked student cannot login
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: targetEmail, password: 'Password123!' })
      .expect(403);

    // Unblock student
    const unblockRes = await request(app.getHttpServer())
      .patch(`/api/v1/users/${targetStudentId}/block`)
      .set('Cookie', adminCookie)
      .expect(200);

    expect(unblockRes.body.data.isBlocked).toBe(false);
  });
});
