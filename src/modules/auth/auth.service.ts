import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Role, User } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ArgonUtil } from '../../common/utils/argon.util';
import { AuthUser } from '../../common/types/auth-user.type';

export interface TokenResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenResult> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });

    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await ArgonUtil.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        email: dto.email.toLowerCase().trim(),
        phone: dto.phone.trim(),
        passwordHash,
        role: Role.STUDENT,
      },
    });

    return this.generateTokens(user);
  }

  async login(dto: LoginDto): Promise<TokenResult> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.isBlocked) {
      throw new ForbiddenException('Your account has been suspended. Please contact support.');
    }

    // Check account lockout
    const now = new Date();
    if (user.lockoutUntil && user.lockoutUntil > now) {
      const remainingMinutes = Math.ceil((user.lockoutUntil.getTime() - now.getTime()) / 60000);
      throw new UnauthorizedException(
        `Account temporarily locked due to multiple failed login attempts. Please try again in ${remainingMinutes} minute(s).`,
      );
    }

    const isMatch = await ArgonUtil.verify(user.passwordHash, dto.password);

    if (!isMatch) {
      const maxAttempts = this.configService.get<number>('MAX_FAILED_LOGIN_ATTEMPTS') || 5;
      const lockoutMinutes = this.configService.get<number>('LOCKOUT_DURATION_MINUTES') || 15;
      const failedCount = user.failedLogins + 1;

      let lockoutUntil: Date | null = null;
      if (failedCount >= maxAttempts) {
        lockoutUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000);
        this.logger.warn(`User ${user.email} locked out until ${lockoutUntil}`);
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failedCount,
          lockoutUntil,
        },
      });

      throw new UnauthorizedException('Invalid email or password');
    }

    // Reset failed login attempts on successful login
    if (user.failedLogins > 0 || user.lockoutUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: 0,
          lockoutUntil: null,
        },
      });
    }

    return this.generateTokens(user);
  }

  async refresh(rawRefreshToken: string): Promise<TokenResult> {
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    let payload: { sub: string; jti?: string };
    try {
      payload = this.jwtService.verify(rawRefreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'dev_refresh_secret',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        refreshTokens: {
          where: {
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        },
      },
    });

    if (!user || user.isBlocked) {
      throw new UnauthorizedException('User account invalid or suspended');
    }

    // Verify token hash against active tokens for this user
    let matchingToken = null;
    for (const t of user.refreshTokens) {
      const isMatch = await ArgonUtil.verify(t.tokenHash, rawRefreshToken);
      if (isMatch) {
        matchingToken = t;
        break;
      }
    }

    if (!matchingToken) {
      // Security measure: check if token was revoked (reuse detection)
      const allTokens = await this.prisma.refreshToken.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      for (const t of allTokens) {
        if (t.revokedAt) {
          const isRevokedMatch = await ArgonUtil.verify(t.tokenHash, rawRefreshToken);
          if (isRevokedMatch) {
            this.logger.warn(`Refresh token reuse detected for user ${user.id}. Revoking all sessions.`);
            await this.prisma.refreshToken.updateMany({
              where: { userId: user.id },
              data: { revokedAt: new Date() },
            });
            break;
          }
        }
      }

      throw new UnauthorizedException('Invalid refresh token');
    }

    // Generate new tokens
    const { accessToken, refreshToken, tokenHash, newExpiresAt } = await this.createTokensPair(user);

    // Rotate token in a transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: matchingToken.id },
        data: {
          revokedAt: new Date(),
          replacedByToken: 'ROTATED',
        },
      });

      await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: newExpiresAt,
        },
      });
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        phone: user.phone,
      },
    };
  }

  async logout(rawRefreshToken?: string, userId?: string): Promise<void> {
    if (rawRefreshToken && userId) {
      const userTokens = await this.prisma.refreshToken.findMany({
        where: { userId, revokedAt: null },
      });

      for (const t of userTokens) {
        const isMatch = await ArgonUtil.verify(t.tokenHash, rawRefreshToken);
        if (isMatch) {
          await this.prisma.refreshToken.update({
            where: { id: t.id },
            data: { revokedAt: new Date() },
          });
          return;
        }
      }
    } else if (userId) {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  async getProfile(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  private async generateTokens(user: User): Promise<TokenResult> {
    const { accessToken, refreshToken, tokenHash, newExpiresAt } = await this.createTokensPair(user);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: newExpiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        phone: user.phone,
      },
    };
  }

  private async createTokensPair(user: User | AuthUser) {
    const accessSecret = this.configService.get<string>('JWT_ACCESS_SECRET') || 'dev_access_secret';
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET') || 'dev_refresh_secret';
    const accessExpiration = (this.configService.get<string>('JWT_ACCESS_EXPIRATION') || '15m') as any;
    const refreshExpiration = (this.configService.get<string>('JWT_REFRESH_EXPIRATION') || '7d') as any;

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: accessSecret,
      expiresIn: accessExpiration,
    });

    const refreshToken = this.jwtService.sign(
      { sub: user.id, jti: uuidv4() },
      {
        secret: refreshSecret,
        expiresIn: refreshExpiration,
      },
    );

    const tokenHash = await ArgonUtil.hash(refreshToken);
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    return { accessToken, refreshToken, tokenHash, newExpiresAt };
  }
}
