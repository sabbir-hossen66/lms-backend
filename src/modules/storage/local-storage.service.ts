import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  IStorageService,
  FileMetadata,
  StreamRangeOptions,
  StreamResult,
  UploadedFileInput,
} from './storage.interface';

@Injectable()
export class LocalStorageService implements IStorageService {
  private readonly logger = new Logger(LocalStorageService.name);
  private readonly baseDir: string;

  constructor(private configService: ConfigService) {
    const rawDir = this.configService.get<string>('STORAGE_LOCAL_DIR') || './uploads';
    this.baseDir = path.resolve(process.cwd(), rawDir);

    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private resolveSafePath(storageKey: string): string {
    const safeKey = path.normalize(storageKey).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.resolve(this.baseDir, safeKey);

    if (!fullPath.startsWith(this.baseDir)) {
      throw new InternalServerErrorException('Security error: Path traversal attempt detected');
    }

    return fullPath;
  }

  async saveFile(file: UploadedFileInput, subDirectory = ''): Promise<FileMetadata> {
    const targetDir = path.resolve(this.baseDir, subDirectory);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const randomizedName = `${uuidv4()}${ext}`;
    const storageKey = subDirectory ? path.join(subDirectory, randomizedName) : randomizedName;
    const fullPath = this.resolveSafePath(storageKey);

    await fs.promises.writeFile(fullPath, file.buffer);

    return {
      storageKey,
      size: file.size,
      mimeType: file.mimetype,
      originalName: file.originalname,
    };
  }

  async getFileStat(storageKey: string): Promise<{ size: number; mimeType: string }> {
    const fullPath = this.resolveSafePath(storageKey);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException(`Requested file does not exist on storage: ${storageKey}`);
    }

    const stat = await fs.promises.stat(fullPath);
    const ext = path.extname(storageKey).toLowerCase();
    let mimeType = 'video/mp4';

    if (ext === '.webm') mimeType = 'video/webm';
    else if (ext === '.mov') mimeType = 'video/quicktime';
    else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.webp') mimeType = 'image/webp';

    return {
      size: stat.size,
      mimeType,
    };
  }

  async getRangeStream(storageKey: string, options?: StreamRangeOptions): Promise<StreamResult> {
    const fullPath = this.resolveSafePath(storageKey);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException('Video media not found on disk');
    }

    const { size: totalSize, mimeType } = await this.getFileStat(storageKey);

    let start = options?.start ?? 0;
    let end = options?.end ?? totalSize - 1;

    // Validate boundaries
    if (start >= totalSize || start < 0) {
      start = 0;
    }
    if (end >= totalSize || end < start) {
      end = totalSize - 1;
    }

    // Typical range chunk size: 1MB to 5MB to optimize buffering
    const maxChunkSize = 3 * 1024 * 1024; // 3MB chunks
    if (end - start + 1 > maxChunkSize) {
      end = start + maxChunkSize - 1;
    }

    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(fullPath, { start, end });

    return {
      stream,
      totalSize,
      start,
      end,
      chunkSize,
      mimeType,
    };
  }

  async deleteFile(storageKey: string): Promise<void> {
    try {
      const fullPath = this.resolveSafePath(storageKey);
      if (fs.existsSync(fullPath)) {
        await fs.promises.unlink(fullPath);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to delete file from storage: ${storageKey} - ${err.message}`);
    }
  }
}
