import { BadRequestException } from '@nestjs/common';
import * as path from 'path';
import { UploadedFileInput } from './storage.interface';

export class FileSecurityUtil {
  private static readonly ALLOWED_VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv']);
  private static readonly ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

  private static readonly ALLOWED_VIDEO_MIMES = new Set([
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-matroska',
  ]);

  private static readonly ALLOWED_IMAGE_MIMES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
  ]);

  static validateVideoUpload(file: UploadedFileInput): void {
    if (!file) {
      throw new BadRequestException('No video file provided');
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!this.ALLOWED_VIDEO_EXTS.has(ext)) {
      throw new BadRequestException(`Invalid video extension: ${ext}. Allowed: .mp4, .webm, .mov`);
    }

    if (!this.ALLOWED_VIDEO_MIMES.has(file.mimetype)) {
      throw new BadRequestException(`Invalid video MIME type: ${file.mimetype}`);
    }

    // Verify magic bytes
    if (file.buffer && file.buffer.length > 12) {
      const isMp4 = this.isMp4(file.buffer);
      const isWebm = this.isWebm(file.buffer);

      if (!isMp4 && !isWebm && ext === '.mp4') {
        throw new BadRequestException('Corrupted or invalid video file signature');
      }
    }
  }

  static validateImageUpload(file: UploadedFileInput): void {
    if (!file) {
      throw new BadRequestException('No image file provided');
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!this.ALLOWED_IMAGE_EXTS.has(ext)) {
      throw new BadRequestException(`Invalid image extension: ${ext}. Allowed: .jpg, .jpeg, .png, .webp`);
    }

    if (!this.ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
      throw new BadRequestException(`Invalid image MIME type: ${file.mimetype}`);
    }

    if (file.buffer && file.buffer.length > 8) {
      const isJpeg = file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff;
      const isPng =
        file.buffer[0] === 0x89 &&
        file.buffer[1] === 0x50 &&
        file.buffer[2] === 0x4e &&
        file.buffer[3] === 0x47;
      const isWebp =
        file.buffer.toString('ascii', 0, 4) === 'RIFF' &&
        file.buffer.toString('ascii', 8, 12) === 'WEBP';

      if (!isJpeg && !isPng && !isWebp) {
        throw new BadRequestException('Invalid image binary signature');
      }
    }
  }

  private static isMp4(buf: Buffer): boolean {
    const ftyp = buf.toString('ascii', 4, 8);
    return ftyp === 'ftyp';
  }

  private static isWebm(buf: Buffer): boolean {
    return (
      buf[0] === 0x1a &&
      buf[1] === 0x45 &&
      buf[2] === 0xdf &&
      buf[3] === 0xa3
    );
  }

  /**
   * Fast pure-TS MP4 duration detection by parsing the mvhd box
   */
  static parseMp4Duration(buffer: Buffer): number {
    try {
      let offset = 0;
      while (offset < buffer.length - 8) {
        const size = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);

        if (size <= 1) break;

        if (type === 'moov') {
          // Look inside moov
          let subOffset = offset + 8;
          const moovEnd = offset + size;
          while (subOffset < moovEnd - 8) {
            const subSize = buffer.readUInt32BE(subOffset);
            const subType = buffer.toString('ascii', subOffset + 4, subOffset + 8);
            if (subType === 'mvhd') {
              const version = buffer.readUInt8(subOffset + 8);
              let timescale = 0;
              let duration = 0;
              if (version === 0) {
                timescale = buffer.readUInt32BE(subOffset + 20);
                duration = buffer.readUInt32BE(subOffset + 24);
              } else if (version === 1) {
                timescale = buffer.readUInt32BE(subOffset + 28);
                duration = Number(buffer.readBigUInt64BE(subOffset + 32));
              }
              if (timescale > 0) {
                return Math.round((duration / timescale) * 10) / 10;
              }
            }
            if (subSize <= 0) break;
            subOffset += subSize;
          }
        }
        offset += size;
      }
    } catch {
      // Fallback
    }
    return 0;
  }
}
