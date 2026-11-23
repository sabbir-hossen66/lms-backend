import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CourseStatus } from '@prisma/client';

export class CreateCourseDto {
  @ApiProperty({ example: 'Complete NestJS & React Masterclass' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  title!: string;

  @ApiProperty({ example: 'Comprehensive guide to building production full-stack systems.' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  description!: string;

  @ApiProperty({ example: 2500 })
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ example: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97' })
  @IsString()
  @IsOptional()
  thumbnail?: string;

  @ApiPropertyOptional({ enum: CourseStatus, default: CourseStatus.DRAFT })
  @IsEnum(CourseStatus)
  @IsOptional()
  status?: CourseStatus;

  @ApiPropertyOptional({ example: 'ONGOING', enum: ['ONGOING', 'COMPLETED'] })
  @IsString()
  @IsOptional()
  contentStatus?: string;
}
