import { mkdir } from "node:fs/promises";

export interface UploadOptions {
  dest?: string;
  maxFileSize?: number;
  maxFiles?: number;
  allowedExtensions?: string[];
  allowedMimeTypes?: string[];
  preserveFilename?: boolean;
}

export interface UploadedFile {
  filename: string;
  path: string;
  size: number;
  mimetype: string;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{2,}/g, "_");
}

function getExtension(filename: string): string {
  const pos = filename.lastIndexOf(".");
  return pos > -1 ? filename.slice(pos).toLowerCase() : "";
}

export async function parseUpload(
  request: Request,
  config: UploadOptions = {}
): Promise<{ fields: Record<string, unknown>; files: Record<string, UploadedFile[]> }> {
  const dest = config.dest ?? "./uploads";
  // Prevent path traversal in destination directory
  if (dest.includes("..") || dest.includes("\0")) {
    throw new Error("Invalid upload destination: path traversal detected");
  }
  const maxFileSize = config.maxFileSize ?? 10 * 1024 * 1024;
  const maxFiles = config.maxFiles ?? 5;
  const allowedExtensions = config.allowedExtensions;
  const allowedMimeTypes = config.allowedMimeTypes;
  const preserveFilename = config.preserveFilename ?? false;

  const formData = await request.formData();
  const files: Record<string, UploadedFile[]> = {};
  const fields: Record<string, unknown> = {};
  let fileCount = 0;

  for (const [key, entry] of formData.entries()) {
    const value = entry as unknown;
    if (value instanceof File) {
      if (fileCount >= maxFiles) {
        throw new Error(`Maximum ${String(maxFiles)} files allowed`);
      }
      if (value.size > maxFileSize) {
        throw new Error(`File too large (max ${String(maxFileSize)} bytes)`);
      }

      const ext = getExtension(value.name);
      if (allowedExtensions && !allowedExtensions.includes(ext)) {
        throw new Error(`File type ${ext} not allowed`);
      }
      const mimeType = value.type || "application/octet-stream";
      if (allowedMimeTypes && !allowedMimeTypes.includes(mimeType)) {
        throw new Error(`MIME type ${mimeType} not allowed`);
      }
      const timestamp = Date.now();
      const random = Math.random().toString(36).slice(2, 8);
      const safeName = preserveFilename
        ? sanitizeFilename(value.name)
        : `${timestamp}_${random}${ext || ".bin"}`;
      const filePath = `${dest}/${safeName}`;
      await mkdir(dest, { recursive: true });
      await Bun.write(filePath, value);

      if (!files[key]) files[key] = [];
      files[key].push({
        filename: value.name,
        path: filePath,
        size: value.size,
        mimetype: value.type || "application/octet-stream",
      });
      fileCount++;
    } else {
      fields[key] = value;
    }
  }

  return { fields, files };
}
