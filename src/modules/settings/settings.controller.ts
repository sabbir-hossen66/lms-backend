import { Controller, Get, Patch, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('Settings')
@Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Get public site settings (bKash number, site title)' })
  async getPublicSettings() {
    return this.settingsService.getPublicSettings();
  }

  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'Admin get all platform settings' })
  async getAllSettings() {
    return this.settingsService.getAllSettings();
  }

  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Patch()
  @ApiOperation({ summary: 'Admin update platform settings' })
  async updateSettings(
    @Body() values: Record<string, string>,
    @CurrentUser('id') adminId: string,
  ) {
    return this.settingsService.updateSettings(values, adminId);
  }
}
