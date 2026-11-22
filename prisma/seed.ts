import { PrismaClient, Role, CourseStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Hash passwords
  const adminPasswordHash = await argon2.hash('AdminPassword123!');
  const studentPasswordHash = await argon2.hash('StudentPassword123!');

  // 1. Create Admin
  const admin = await prisma.user.upsert({
    where: { email: 'admin@lms.local' },
    update: {
      name: 'Super Admin',
      phone: '+8801700000001',
      role: Role.ADMIN,
      passwordHash: adminPasswordHash,
      isBlocked: false,
    },
    create: {
      email: 'admin@lms.local',
      name: 'Super Admin',
      phone: '+8801700000001',
      role: Role.ADMIN,
      passwordHash: adminPasswordHash,
      isBlocked: false,
    },
  });
  console.log(`Admin user ready: ${admin.email}`);

  // 2. Create Sample Student
  const student = await prisma.user.upsert({
    where: { email: 'student@lms.local' },
    update: {
      name: 'Sample Student',
      phone: '+8801700000002',
      role: Role.STUDENT,
      passwordHash: studentPasswordHash,
      isBlocked: false,
    },
    create: {
      email: 'student@lms.local',
      name: 'Sample Student',
      phone: '+8801700000002',
      role: Role.STUDENT,
      passwordHash: studentPasswordHash,
      isBlocked: false,
    },
  });
  console.log(`Student user ready: ${student.email}`);

  // 3. Create Sample Course
  const course = await prisma.course.upsert({
    where: { id: 'c0000000-0000-0000-0000-000000000001' },
    update: {
      title: 'Mastering Full-Stack TypeScript & NestJS',
      description: 'Comprehensive, production-ready course covering NestJS, PostgreSQL, Prisma, React, Tailwind CSS, and secure video streaming architecture.',
      price: 2500,
      status: CourseStatus.PUBLISHED,
      thumbnail: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&auto=format&fit=crop&q=60',
    },
    create: {
      id: 'c0000000-0000-0000-0000-000000000001',
      title: 'Mastering Full-Stack TypeScript & NestJS',
      description: 'Comprehensive, production-ready course covering NestJS, PostgreSQL, Prisma, React, Tailwind CSS, and secure video streaming architecture.',
      price: 2500,
      status: CourseStatus.PUBLISHED,
      thumbnail: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&auto=format&fit=crop&q=60',
    },
  });
  console.log(`Sample course ready: ${course.title} (ID: ${course.id})`);

  // 4. Create Sample Video
  const video = await prisma.video.upsert({
    where: { id: 'v0000000-0000-0000-0000-000000000001' },
    update: {
      title: '01 - System Architecture & Tech Stack Tour',
      description: 'Overview of the modular NestJS architecture, database schemas, and frontend client setup.',
      order: 1,
      duration: 385, // seconds
      storageKey: 'sample-intro.mp4',
      mimeType: 'video/mp4',
    },
    create: {
      id: 'v0000000-0000-0000-0000-000000000001',
      courseId: course.id,
      title: '01 - System Architecture & Tech Stack Tour',
      description: 'Overview of the modular NestJS architecture, database schemas, and frontend client setup.',
      order: 1,
      duration: 385,
      storageKey: 'sample-intro.mp4',
      mimeType: 'video/mp4',
    },
  });
  console.log(`Sample video ready: ${video.title}`);

  // 5. Default Settings
  const defaultSettings = [
    { key: 'bkash_number', value: '01712345678' },
    { key: 'site_name', value: 'Antigravity LMS' },
    { key: 'support_email', value: 'support@lms.local' },
  ];

  for (const s of defaultSettings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: { key: s.key, value: s.value },
    });
  }
  console.log('System settings seeded.');
  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
