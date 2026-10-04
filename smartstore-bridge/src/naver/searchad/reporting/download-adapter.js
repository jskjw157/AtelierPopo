import { reportingError } from "./contracts.js";
export class ReportDownloadAdapter {
  constructor({ jobService, transport, identityResolver, clock = Date.now }) {
    Object.assign(this, { jobService, transport, identityResolver, clock });
  }
  async download(input, context) {
    let job = await this.jobService.load(input, context);
    if (
      !job.remoteJobId ||
      !job.claimId ||
      job.reportType === "NAVERPAY_CONVERSION"
    )
      throw reportingError("SEARCHAD_REPORT_GENERATION_UNPROVEN", 409);
    try {
      return await this.jobService.remote.withDownload(
        job,
        async (response, downloadUrl) => {
          if (response.status !== "BUILT") throw new Error();
          job = await this.jobService.settle(
            job,
            "built",
            null,
            "BUILT",
            response,
          );
          await this.jobService.identity(job.customerId, job);
          const bytes = await this.transport.download({
            customerId: job.customerId,
            url: downloadUrl,
          });
          const identity = await this.jobService.identity(job.customerId, job);
          return {
            bytes,
            remoteJobId: job.remoteJobId,
            reportCreatedAt: job.reportCreatedAt,
            identity,
            job,
            downloadCompletedAt: this.clock(),
          };
        },
      );
    } catch {
      throw reportingError("SEARCHAD_REPORT_DOWNLOAD_FAILED", 502);
    }
  }
}
