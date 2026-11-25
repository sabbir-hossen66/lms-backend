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

const CODAPI_SANDBOX_MAP: Record<string, { sandbox: string; filename: string }> = {
  c: { sandbox: 'gcc', filename: 'main.c' },
  cpp: { sandbox: 'cpp', filename: 'main.cpp' },
  python: { sandbox: 'python', filename: 'main.py' },
  rust: { sandbox: 'rust', filename: 'main.rs' },
  go: { sandbox: 'go', filename: 'main.go' },
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

  private async executeViaCodapi(language: string, code: string): Promise<ExecutionResult | null> {
    const map = CODAPI_SANDBOX_MAP[language];
    if (!map) return null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch('https://api.codapi.org/v1/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sandbox: map.sandbox,
          command: 'run',
          files: {
            [map.filename]: code,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) return null;

      const data = await response.json();
      if (typeof data.ok !== 'boolean') return null;

      const output = data.stdout || '';
      const error = data.stderr || '';

      return {
        success: data.ok && !error,
        output: output + (output && !output.endsWith('\n') ? '\n' : ''),
        error: error || undefined,
        exitCode: data.ok ? 0 : 1,
        executionTimeMs: data.duration || 500,
      };
    } catch {
      return null;
    }
  }

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

    // 1. High-Speed Codapi Execution Path (<1s)
    if (!dto.stdin && CODAPI_SANDBOX_MAP[dto.language]) {
      const codapiRes = await this.executeViaCodapi(dto.language, dto.code);
      if (codapiRes) {
        return codapiRes;
      }
    }

    // 2. Wandbox Fallback Path
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
      const timeoutMs = 35000;
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
            ? 'Execution timed out (Time Limit Exceeded - 35s).'
            : `Execution error: ${err?.message || 'Failed to connect to compiler service'}`,
        exitCode: 1,
        executionTimeMs,
      };
    }
  }
}
