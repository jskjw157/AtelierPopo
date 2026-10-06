import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { reportingError } from "./contracts.js";
export const blobHash = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export function blobKey(customerId, sha256) {
  if (!/^\d{1,30}$/.test(customerId) || !/^[a-f0-9]{64}$/.test(sha256))
    throw reportingError("SEARCHAD_REPORT_BLOB_INVALID");
  return `${customerId}/${sha256}.tsv`;
}
export function validateBlobKey(customerId, key) {
  if (
    typeof key !== "string" ||
    key !== blobKey(customerId, key.split("/")[1]?.replace(/\.tsv$/, ""))
  )
    throw reportingError("SEARCHAD_REPORT_BLOB_INVALID");
  return key.split("/")[1].slice(0, -4);
}
export class LocalReportStorage {
  constructor({ root }) {
    this.root = path.resolve(root);
    this.durableProduction = false;
  }
  async put({ customerId, sha256, bytes }) {
    const key = blobKey(customerId, sha256);
    if (!Buffer.isBuffer(bytes) || blobHash(bytes) !== sha256)
      throw reportingError("SEARCHAD_REPORT_BLOB_CHECKSUM");
    await mkdir(path.join(this.root, customerId), { recursive: true });
    try {
      await writeFile(path.join(this.root, key), bytes, {
        flag: "wx",
        mode: 0o600,
      });
    } catch (e) {
      if (e.code !== "EEXIST")
        throw reportingError("SEARCHAD_REPORT_BLOB_UNAVAILABLE", 503);
    }
    await this.get({ customerId, key });
    return { key, sha256, size: bytes.length };
  }
  async get({ customerId, key }) {
    const hash = validateBlobKey(customerId, key);
    let bytes;
    try {
      bytes = await readFile(path.join(this.root, key));
    } catch {
      throw reportingError("SEARCHAD_REPORT_BLOB_UNAVAILABLE", 503);
    }
    if (blobHash(bytes) !== hash)
      throw reportingError("SEARCHAD_REPORT_BLOB_CHECKSUM", 503);
    return bytes;
  }
}
