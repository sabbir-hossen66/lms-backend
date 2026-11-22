import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAccessRequestDto {
  @ApiProperty({ example: 'c0000000-0000-0000-0000-000000000001' })
  @IsString()
  @IsNotEmpty()
  courseId!: string;

  @ApiProperty({ example: '01712345678' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[+]?[0-9]{10,15}$/, {
    message: 'Sender number must be a valid 10-15 digit phone number',
  })
  senderNumber!: string;

  @ApiProperty({ example: 'BKASH892J1K9' })
  @IsString()
  @IsNotEmpty()
  @Length(8, 20, { message: 'TrxID must be between 8 and 20 alphanumeric characters' })
  @Matches(/^[A-Za-z0-9]+$/, {
    message: 'Transaction ID must be alphanumeric without spaces or symbols',
  })
  trxId!: string;
}
