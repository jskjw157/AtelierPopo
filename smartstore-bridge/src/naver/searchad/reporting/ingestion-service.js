import { blobHash } from "./blob-storage.js";
import { selectReportSchema } from "./schema-registry.js";
import { parseReportTsv } from "./tsv-parser.js";
import {
  generationProof,
  hasProvenCollectionSlot,
} from "./spend-evidence-service.js";
import { reportingError } from "./contracts.js";
export class ReportIngestionService {
  constructor({
    repository,
    downloadAdapter,
    storage,
    jobService,
    clock = Date.now,
    generationPolicy = null,
  }) {
    Object.assign(this, {
      repository,
      downloadAdapter,
      storage,
      jobService,
      clock,
      generationPolicy,
    });
  }
  async ingest(input, context) {
    const downloaded = await this.downloadAdapter.download(input, context);
    const { bytes, job, identity } = downloaded;
    const sha256 = blobHash(bytes);
    const now = this.clock();
    let blob;
    try {
      blob = await this.storage.put({
        customerId: job.customerId,
        sha256,
        bytes,
        contentType: "text/tab-separated-values",
        retainUntil: new Date(now + 2 * 366 * 86400000).toISOString(),
      });
      const archived = await this.storage.get({
        customerId: job.customerId,
        key: blob.key,
      });
      if (
        blobHash(archived) !== sha256 ||
        blob.sha256 !== sha256 ||
        blob.size !== bytes.length
      )
        throw new Error();
    } catch {
      throw reportingError("SEARCHAD_REPORT_BLOB_UNAVAILABLE", 503);
    }
    blob = {
      ...blob,
      retainUntil: new Date(now + 2 * 366 * 86400000).toISOString(),
    };
    let proof, schema;
    const binding = await this.repository.getIngestionBinding({
      customerId: job.customerId,
      reportJobId: job.reportJobId,
      sha256,
      identity,
    });
    try {
      proof =
        binding?.proof ||
        generationProof(
          job,
          downloaded.downloadCompletedAt,
          this.generationPolicy,
        );
      if (
        job.kind === "stat" &&
        !hasProvenCollectionSlot(proof, job.statDate)
      ) {
        throw reportingError("SEARCHAD_REPORT_COLLECTION_SLOT_UNPROVEN", 409);
      }
      schema = selectReportSchema({
        ...job,
        generationWindow: proof,
        parserVersion: "tsv-v1",
      });
    } catch (error) {
      return this.repository.quarantineIngestion({
        job,
        blob,
        schema: null,
        identity,
        now,
        reasons: [
          { code: error.code || "SEARCHAD_REPORT_GENERATION_UNPROVEN" },
        ],
      });
    }
    const parsed = parseReportTsv(bytes, schema, {
      customerId: job.customerId,
    });
    await this.jobService.identity(job.customerId, identity);
    if (parsed.reasons.length)
      return this.repository.quarantineIngestion({
        job,
        blob,
        schema,
        identity,
        now,
        proof,
        reasons: parsed.reasons,
      });
    return this.repository.commitIngestion({
      job,
      blob,
      schema,
      rows: parsed.rows,
      quality: "provisional",
      identity,
      now,
      proof,
    });
  }
  async archived(input, context) {
    const job = await this.jobService.load(input, context, { readOnly: true });
    const blob = await this.repository.getArchivedBlob({
      customerId: job.customerId,
      reportJobId: job.reportJobId,
    });
    if (!blob) throw reportingError("SEARCHAD_REPORT_BLOB_NOT_FOUND", 404);
    return this.storage.get({ customerId: job.customerId, key: blob.key });
  }
}
