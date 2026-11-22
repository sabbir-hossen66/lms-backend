import { IsNotEmpty, IsNumber, IsString, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class HeartbeatDto {
  @ApiProperty({ example: 'v0000000-0000-0000-0000-000000000001' })
  @IsString()
  @IsNotEmpty()
  videoId!: string;

  @ApiProperty({ example: 45.2, description: 'Current playback position in seconds' })
  @IsNumber()
  @Min(0)
  currentPosition!: number;

  @ApiProperty({ example: 10, description: 'Seconds watched since previous heartbeat (max 30s per beat)' })
  @IsNumber()
  @Min(0)
  @Max(35)
  watchedDelta!: number;
}
