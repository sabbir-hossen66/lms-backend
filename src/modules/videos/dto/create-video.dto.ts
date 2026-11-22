import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVideoDto {
  @ApiProperty({ example: 'c0000000-0000-0000-0000-000000000001' })
  @IsString()
  @IsNotEmpty()
  courseId!: string;

  @ApiProperty({ example: '01 - Introduction to NestJS' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({ example: 'Learn the architectural foundations of NestJS' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(0)
  order!: number;

  @ApiPropertyOptional({ example: 340.5 })
  @IsNumber()
  @IsOptional()
  duration?: number;

  @ApiProperty({ example: 'videos/unique-uuid.mp4' })
  @IsString()
  @IsNotEmpty()
  storageKey!: string;

  @ApiPropertyOptional({ example: 'video/mp4' })
  @IsString()
  @IsOptional()
  mimeType?: string;
}
