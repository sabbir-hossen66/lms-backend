import { Injectable, Logger } from '@nestjs/common';
import { ExecuteCodeDto } from './dto/execute-code.dto';

interface CompilerConfig {
  compiler: string;
  options?: string;
}

const LANGUAGE_COMPILER_MAP: Record<string, CompilerConfig> = {
  c: { compiler: 'gcc-13.2.0-c' },
  cpp: { compiler: 'gcc-13.2.0' },
  python: { compiler: 'cpython-3.10.22' },
  rust: { compiler: 'rust-1.98.1' },
  javascript: { compiler: 'nodejs-20.17.0' },
  typescript: { compiler: 'typescript-5.6.2' },
  go: { compiler: 'go-1.27.4' },
};

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  compilerMessage?: string;
  exitCode: number;
  executionTimeMs: number;
}

@Injectable()
export class CompilerService {
  private readonly logger = new Logger(CompilerService.name);

  async executeCode(dto: ExecuteCodeDto): Promise<ExecutionResult> {
    const config = LANGUAGE_COMPILER_MAP[dto.language];
    if (!config) {
      return {
        success: false,
        output: '',
        error: `Language ${dto.language} is not supported.`,
        exitCode: 1,
        executionTimeMs: 0,
      };
    }

    const startTime = Date.now();

    try {
      const payload: Record<string, any> = {
        compiler: config.compiler,
        code: dto.code,
        stdin: dto.stdin || '',
      };

      if (config.options) {
        payload['compiler-option-raw'] = config.options;
      }

      const controller = new AbortController();
      const timeoutMs = dto.language === 'rust' ? 25000 : 15000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch('https://wandbox.org/api/compile.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Compiler service returned HTTP ${response.status}`);
      }

      const data = await response.json();
      const executionTimeMs = Date.now() - startTime;

      const programOutput = data.program_output || '';
      const programError = data.program_error || '';
      const compilerError = data.compiler_error || '';
      const compilerOutput = data.compiler_output || '';
      const status = Number(data.status ?? 0);

      const hasError = status !== 0 || Boolean(compilerError) || (Boolean(programError) && !programOutput);
      const combinedOutput = programOutput || compilerOutput;
      const combinedError = compilerError || programError;

      return {
        success: !hasError,
        output: combinedOutput,
        error: combinedError,
        compilerMessage: compilerOutput,
        exitCode: status,
        executionTimeMs,
      };
    } catch (err: any) {
      const executionTimeMs = Date.now() - startTime;
      this.logger.error(`Execution failed for ${dto.language}:`, err?.message || err);

      return {
        success: false,
        output: '',
        error:
          err.name === 'AbortError'
            ? 'Execution timed out (Time Limit Exceeded - 15s).'
            : `Execution error: ${err?.message || 'Failed to connect to compiler service'}`,
        exitCode: 1,
        executionTimeMs,
      };
    }
  }
}
