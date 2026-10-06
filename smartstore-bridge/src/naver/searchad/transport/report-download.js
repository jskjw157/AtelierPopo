import { reportingError } from "../reporting/contracts.js";
/** Separate signed capability, not an additional raw Swagger operation. */
export class ReportDownloadTransport {
  constructor({ client, maxBytes = 64 * 1024 * 1024 }) {
    Object.assign(this, { client, maxBytes });
  }
  async download({ customerId, url }) {
    try {
      if (
        typeof url !== "string" ||
        !/^https:\/\/api\.searchad\.naver\.com\/report-download\?[^#]+$/.test(
          url,
        )
      )
        throw new Error();
      const target = new URL(url);
      if (
        target.origin !== "https://api.searchad.naver.com" ||
        target.pathname !== "/report-download" ||
        target.username ||
        target.password ||
        target.hash ||
        this.client.baseUrl !== target.origin
      )
        throw new Error();
      const entries = [...target.searchParams];
      if (
        entries.filter(
          ([key, value]) => key === "authtoken" && value.length > 0,
        ).length !== 1 ||
        entries.some(
          ([key, value]) =>
            !["authtoken", "fileVersion", "fileversion"].includes(key) ||
            !value,
        ) ||
        new Set(entries.map(([key]) => key.toLowerCase())).size !==
          entries.length
      )
        throw new Error();
      // URL query stays private to this call. Signer normalizes only the path.
      return (
        await this.client.request({
          customerId,
          method: "GET",
          path: "/report-download",
          query: Object.fromEntries(entries),
          responseType: "arrayBuffer",
          retrySafe: false,
          redirectPolicy: "error",
          maxBodyBytes: this.maxBytes,
        })
      ).data;
    } catch {
      throw reportingError("SEARCHAD_REPORT_DOWNLOAD_FAILED", 502);
    }
  }
}
