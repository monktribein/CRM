import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import type { Connection, Types } from 'mongoose';

const { GridFSBucket, ObjectId } = mongoose.mongo;

export const SCREENSHOT_BUCKET = 'screenshotFiles';

export class StorageError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export interface StoredImage {
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  sessionId: Types.ObjectId;
  captureId: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
}

/**
 * Screenshot image storage in the application's own MongoDB database (GridFS
 * bucket "screenshotFiles"). Uses the existing MONGODB_URI connection, so no
 * extra credentials are needed. Images never leave the backend except through
 * the authorised preview endpoints.
 */
@Injectable()
export class ScreenshotStorageService implements OnModuleInit {
  private bucket!: InstanceType<typeof GridFSBucket>;

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onModuleInit() {
    // Mongoose and the driver share the connection; the db handle is ready once connected.
    await this.connection.asPromise();
    this.bucket = new GridFSBucket(this.connection.db!, { bucketName: SCREENSHOT_BUCKET });
    await this.connection.db!.collection(`${SCREENSHOT_BUCKET}.files`).createIndex(
      { 'metadata.organizationId': 1, 'metadata.captureId': 1 },
      { name: 'org_capture' },
    );
  }

  /** Finds a file written by an earlier attempt for this capture (makes retries idempotent). */
  async findByCapture(organizationId: Types.ObjectId, captureId: string): Promise<string | null> {
    const file = await this.bucket.find({ 'metadata.organizationId': organizationId, 'metadata.captureId': captureId }).limit(1).next();
    return file ? String(file._id) : null;
  }

  async store(image: StoredImage): Promise<string> {
    const upload = this.bucket.openUploadStream(image.fileName, {
      metadata: {
        organizationId: image.organizationId,
        userId: image.userId,
        sessionId: image.sessionId,
        captureId: image.captureId,
        contentType: image.mimeType,
      },
    });
    await new Promise<void>((resolve, reject) => {
      upload.once('finish', () => resolve());
      upload.once('error', reject);
      upload.end(image.data);
    });
    return String(upload.id);
  }

  async read(fileId: string): Promise<Buffer> {
    if (!ObjectId.isValid(fileId)) throw new StorageError('Invalid file identifier.', 404);
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of this.bucket.openDownloadStream(new ObjectId(fileId))) chunks.push(chunk as Buffer);
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') throw new StorageError('The screenshot file is missing from the database.', 404);
      throw err;
    }
    return Buffer.concat(chunks);
  }

  /** Permanently deletes the file and its chunks. Already-deleted files count as success. */
  async delete(fileId: string): Promise<void> {
    if (!ObjectId.isValid(fileId)) return;
    try {
      await this.bucket.delete(new ObjectId(fileId));
    } catch (err) {
      if ((err as Error).message?.includes('File not found')) return;
      throw err;
    }
  }
}
