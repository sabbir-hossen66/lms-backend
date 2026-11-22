import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RequestStatus, EnrollmentStatus } from '@prisma/client';

export class ReviewAccessRequestDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsEnum(['APPROVED', 'REJECTED'])
  @IsNotEmpty()
  status!: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({ example: 'Transaction ID not found in bKash statement' })
  @IsString()
  @IsOptional()
  rejectReason?: string;
}

export class ManualAccessDto {
  @ApiProperty({ example: 'student-uuid-here' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({ example: 'course-uuid-here' })
  @IsString()
  @IsNotEmpty()
  courseId!: string;

  @ApiProperty({ enum: EnrollmentStatus })
  @IsEnum(EnrollmentStatus)
  @IsNotEmpty()
  status!: EnrollmentStatus;
}
