import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getPublicSettings() {
    const settings = await this.prisma.setting.findMany({
      where: {
        key: { in: ['bkash_number', 'site_name', 'support_email', 'site_tagline', 'admin_name'] },
      },
    });

    const result: Record<string, string> = {
      bkash_number: '01783780066',
      site_name: 'Antigravity LMS',
      admin_name: 'Sabbir Hossen',
      support_email: 'sabbir.ms2000@gmail.com',
    };

    settings.forEach((s) => {
      result[s.key] = s.value;
    });

    return result;
  }

  async getAllSettings() {
    const settings = await this.prisma.setting.findMany();
    const result: Record<string, string> = {};
    settings.forEach((s) => {
      result[s.key] = s.value;
    });
    return result;
  }

  async updateSettings(values: Record<string, string>, adminId: string) {
    const updates = Object.entries(values).map(([key, value]) =>
      this.prisma.setting.upsert({
        where: { key },
        update: { value: value.toString() },
        create: { key, value: value.toString() },
      }),
    );

    await this.prisma.$transaction(updates);

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'SETTINGS_UPDATE',
        targetType: 'Setting',
        details: values,
      },
    });

    return this.getAllSettings();
  }
}
