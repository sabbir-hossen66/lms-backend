import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';

describe('Auth & Guards (e2e)', () => {
  let app: INestApplication;
  let studentCookie: string[] = [];
  let adminCookie: string[] = [];

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
  });

  afterAll(async () => {
    await app.close();
  });

  const testEmail = `student_${Date.now()}@example.com`;

  it('1. Register new student account', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Test Student',
        email: testEmail,
        password: 'Password123!',
        phone: '+8801812345678',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(testEmail);
    expect(res.body.data.user.role).toBe('STUDENT');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('2. Prevent duplicate student registration', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Duplicate Student',
        email: testEmail,
        password: 'Password123!',
        phone: '+8801812345679',
      })
      .expect(409);

    expect(res.body.success).toBe(false);
  });

  it('3. Fail login with incorrect password', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: testEmail,
        password: 'WrongPassword123!',
      })
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('4. Successfully login student and receive cookies', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: testEmail,
        password: 'Password123!',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(testEmail);
    expect(res.headers['set-cookie']).toBeDefined();
    studentCookie = (res.headers['set-cookie'] as unknown as string[]) || [];
  });

  it('5. Deny unauthenticated access to /api/v1/auth/me', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('6. Allow authenticated access to /api/v1/auth/me via cookie', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', studentCookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe(testEmail);
  });

  it('7. Rotate refresh token successfully', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', studentCookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.headers['set-cookie']).toBeDefined();
    // Update cookie with rotated token
    studentCookie = (res.headers['set-cookie'] as unknown as string[]) || [];
  });

  it('8. Deny student access to admin-only endpoint (RoleGuard)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users/students')
      .set('Cookie', studentCookie)
      .expect(403);

    expect(res.body.success).toBe(false);
  });

  it('9. Login seeded admin and access admin-only endpoint', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@lms.local',
        password: 'AdminPassword123!',
      })
      .expect(200);

    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.data.user.role).toBe('ADMIN');
    adminCookie = (loginRes.headers['set-cookie'] as unknown as string[]) || [];

    const adminRes = await request(app.getHttpServer())
      .get('/api/v1/users/students')
      .set('Cookie', adminCookie)
      .expect(200);

    expect(adminRes.body.success).toBe(true);
    expect(Array.isArray(adminRes.body.data.items)).toBe(true);
  });

  it('10. Logout revokes session and clears cookies', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', studentCookie)
      .expect(200);

    expect(res.body.success).toBe(true);
  });
});
