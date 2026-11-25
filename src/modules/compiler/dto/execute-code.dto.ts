import { IsString, IsNotEmpty, IsOptional, MaxLength, IsIn } from 'class-validator';

export const SUPPORTED_LANGUAGES = [
  'c',
  'cpp',
  'python',
  'rust',
  'javascript',
  'typescript',
  'go',
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export class ExecuteCodeDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(SUPPORTED_LANGUAGES as unknown as string[], {
    message: `Language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}`,
  })
  language!: SupportedLanguage;

  @IsString()
  @IsNotEmpty({ message: 'Code cannot be empty' })
  @MaxLength(65536, { message: 'Code cannot exceed 64KB' })
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000, { message: 'Input cannot exceed 10KB' })
  stdin?: string;
}
