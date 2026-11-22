export interface UploadedFileInput {
  fieldname?: string;
  originalname: string;
  encoding?: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  destination?: string;
  filename?: string;
  path?: string;
}

export interface FileMetadata {
  storageKey: string;
  size: number;
  mimeType: string;
  originalName: string;
}

export interface StreamRangeOptions {
  start?: number;
  end?: number;
}

export interface StreamResult {
  stream: NodeJS.ReadableStream;
  totalSize: number;
  start: number;
  end: number;
  chunkSize: number;
  mimeType: string;
}

export interface IStorageService {
  saveFile(file: UploadedFileInput, subDirectory: string): Promise<FileMetadata>;
  getRangeStream(storageKey: string, options?: StreamRangeOptions): Promise<StreamResult>;
  getFileStat(storageKey: string): Promise<{ size: number; mimeType: string }>;
  deleteFile(storageKey: string): Promise<void>;
}

export const STORAGE_SERVICE = 'STORAGE_SERVICE';
