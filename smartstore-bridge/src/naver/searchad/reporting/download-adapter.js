import { reportingError } from "./contracts.js";
import { parseReportResponse } from "./remote-adapter.js";
import { REPORT_OPERATION_KEYS } from "./operations.js";
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
      const remote = this.jobService.remote;
      const data = (
        await remote.gateway.execute(
          job.kind === "stat"
            ? REPORT_OPERATION_KEYS.getStat
            : REPORT_OPERATION_KEYS.getMaster,
          {
            customerId: job.customerId,
            pathParams:
              job.kind === "stat"
                ? { reportJobId: job.remoteJobId }
                : { id: job.remoteJobId },
          },
        )
      ).data;
      const response = parseReportResponse(data, job, {
        knownId: job.remoteJobId,
      });
      if (response.status !== "BUILT") throw new Error();
      job = await this.jobService.settle(job, "built", null, "BUILT", response);
      await this.jobService.identity(job.customerId, job);
      const bytes = await this.transport.download({
        customerId: job.customerId,
        url: data.downloadUrl,
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
    } catch {
      throw reportingError("SEARCHAD_REPORT_DOWNLOAD_FAILED", 502);
    }
  }
}
