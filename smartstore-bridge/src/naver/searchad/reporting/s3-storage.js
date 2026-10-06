import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { blobKey, blobHash, validateBlobKey } from "./blob-storage.js";
import { reportingError } from "./contracts.js";
export class S3CompatibleReportStorage {
  constructor({ client, bucket, prefix = "reports" }) {
    if (
      !client?.send ||
      !bucket ||
      !/^[-A-Za-z0-9_/]+$/.test(prefix) ||
      prefix.includes("..")
    )
      throw reportingError("SEARCHAD_REPORTING_STORAGE_CONFIG_INVALID", 503);
    Object.assign(this, {
      client,
      bucket,
      prefix: prefix.replace(/\/$/, ""),
      durableProduction: true,
    });
  }
  async put({ customerId, sha256, bytes, contentType, retainUntil }) {
    const key = blobKey(customerId, sha256);
    if (!Buffer.isBuffer(bytes) || blobHash(bytes) !== sha256)
      throw reportingError("SEARCHAD_REPORT_BLOB_CHECKSUM");
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: `${this.prefix}/${key}`,
          Body: bytes,
          ContentType: contentType,
          ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
          Metadata: { "retain-until": retainUntil, sha256 },
        }),
      );
      await this.get({ customerId, key });
      return { key, sha256, size: bytes.length };
    } catch {
      throw reportingError("SEARCHAD_REPORT_BLOB_UNAVAILABLE", 503);
    }
  }
  async get({ customerId, key }) {
    const hash = validateBlobKey(customerId, key);
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: `${this.prefix}/${key}`,
          ChecksumMode: "ENABLED",
        }),
      );
      const bytes = Buffer.from(await result.Body.transformToByteArray());
      if (blobHash(bytes) !== hash) throw new Error();
      return bytes;
    } catch {
      throw reportingError("SEARCHAD_REPORT_BLOB_UNAVAILABLE", 503);
    }
  }
}
export function configuredReportStorage(env) {
  if (!env.ATELIER_SEARCHAD_REPORT_S3_BUCKET) return null;
  const endpoint = env.ATELIER_SEARCHAD_REPORT_S3_ENDPOINT;
  if (endpoint && new URL(endpoint).protocol !== "https:")
    throw reportingError("SEARCHAD_REPORTING_STORAGE_CONFIG_INVALID", 503);
  const client = new S3Client({
    region: env.ATELIER_SEARCHAD_REPORT_S3_REGION || "us-east-1",
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle: true,
    maxAttempts: 2,
  });
  return new S3CompatibleReportStorage({
    client,
    bucket: env.ATELIER_SEARCHAD_REPORT_S3_BUCKET,
    prefix: env.ATELIER_SEARCHAD_REPORT_S3_PREFIX || "reports",
  });
}
