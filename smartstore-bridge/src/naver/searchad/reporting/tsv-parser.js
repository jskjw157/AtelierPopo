import { contentHash } from "../write/canonical.js";
import { validDate } from "./contracts.js";
function integer(x, type) {
  return (
    /^(0|[1-9]\d*)$/.test(x) &&
    BigInt(x) <= (type === "int" ? 2147483647n : 9223372036854775807n)
  );
}
export function parseReportTsv(bytes, descriptor, { customerId }) {
  const rows = [],
    reasons = [];
  try {
    const text = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\ufeff/, "");
    const lines = text.split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    if (!lines.length) throw new Error("EMPTY_REPORT");
    const seen = new Map();
    for (const [index, line] of lines.entries()) {
      const cells = line.split("\t");
      if (cells.length !== descriptor.columns.length)
        throw new Error("COLUMN_COUNT");
      const data = {};
      for (const [i, c] of descriptor.columns.entries()) {
        const value = cells[i];
        if (/[\r\0]/.test(value) || value.length > (c.maxLength ?? 16384))
          throw new Error("INVALID_FIELD");
        const historicalCost =
          c.name === "Cost" && descriptor.statDate < "2026-03-30";
        if (
          ["int", "long"].includes(c.type) &&
          !(historicalCost
            ? /^\d+(\.\d{1,12})?$/.test(value) && value.length <= 32
            : integer(value, c.type))
        )
          throw new Error("INVALID_NUMBER");
        if (
          c.type === "date" &&
          value !== "" &&
          (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
            value,
          ) ||
            !validDate(value.slice(0, 10)) ||
            !Number.isFinite(Date.parse(value)))
        )
          throw new Error("INVALID_DATE");
        data[c.name] = value;
      }
      if ((data["CUSTOMER ID"] ?? data["Customer ID"]) !== customerId)
        throw new Error("CUSTOMER_MISMATCH");
      if (
        descriptor.kind === "stat" &&
        (!validDate(data.Date) || data.Date !== descriptor.statDate)
      )
        throw new Error("STAT_DATE_MISMATCH");
      const master = descriptor.kind === "master";
      const term = descriptor.reportType === "EXPKEYWORD";
      const conversion = descriptor.reportType.includes("CONVERSION");
      if (
        conversion &&
        (!["1", "2"].includes(data["Conversion Method"]) ||
          !(descriptor.statDate < "2024-07-03"
            ? ["1", "2", "3", "4", "5"].includes(data["Conversion Type"])
            : /^(purchase|sign_up|add_to_cart|lead|custom00[1-9]|custom010|add_to_wishlist|subscribe|schedule|view_content)$/.test(
                data["Conversion Type"],
              )))
      )
        throw new Error("UNKNOWN_CONVERSION_ENUM");
      const entityType = master
        ? {
            Campaign: "campaign",
            Adgroup: "adgroup",
            Keyword: "keyword",
            Ad: "creative",
          }[descriptor.reportType]
        : term
          ? "adgroup"
          : "creative";
      const entityId = master
        ? data[
            {
              Campaign: "Campaign ID",
              Adgroup: "Ad Group ID",
              Keyword: "Ad Keyword ID",
              Ad: "Ad ID",
            }[descriptor.reportType]
          ]
        : term
          ? data["AD Group ID"]
          : data["AD ID"];
      if (!entityId || !/^[A-Za-z0-9_-]{1,200}$/.test(entityId))
        throw new Error("ENTITY_MISMATCH");
      for (const [key, value] of Object.entries(data))
        if (/ ID$/.test(key) && value && !/^[A-Za-z0-9_-]{1,200}$/.test(value))
          throw new Error("ENTITY_MISMATCH");
      const metricNames = [
        "Impression",
        "Click",
        "Cost",
        "Sum of AD rank",
        "View count",
        "Conversion count",
        "Sales by conversion",
      ];
      const dimensions = Object.fromEntries(
        Object.entries(data).filter(([key]) => !metricNames.includes(key)),
      );
      const naturalKey = contentHash(
          master ? { entityType, entityId } : dimensions,
        ),
        rowSha = contentHash(data);
      if (seen.has(naturalKey)) {
        if (seen.get(naturalKey) !== rowSha)
          throw new Error("CONFLICTING_DUPLICATE");
        continue;
      }
      seen.set(naturalKey, rowSha);
      let costBasis = "unknown",
        costGrossKrw = null,
        costNetKrw = null,
        vatPolicyVersion = "unproven";
      if (
        data.Cost !== undefined &&
        descriptor.vatPolicy?.blob ===
          "696fea89d3fd0c4c9664f3076c117182366b4861" &&
        descriptor.vatPolicy?.url
      ) {
        vatPolicyVersion = descriptor.vatPolicy.version;
        costBasis =
          descriptor.statDate >= "2026-03-30" ? "vat_included" : "vat_excluded";
        if (costBasis === "vat_included") costGrossKrw = data.Cost;
        else costNetKrw = data.Cost;
      }
      if (
        term &&
        !Object.hasOwn(
          descriptor.searchKeywordTypes,
          data["Search Keyword Type"],
        )
      )
        throw new Error("UNKNOWN_TERM_ENUM");
      rows.push({
        rowNumber: index + 1,
        naturalKey,
        rowSha,
        entityType,
        entityId,
        statDate: descriptor.statDate,
        dimensions,
        metrics: Object.fromEntries(
          Object.entries(data).filter(([key]) => metricNames.includes(key)),
        ),
        data,
        table: master
          ? "master"
          : term
            ? "term"
            : conversion
              ? "conversion"
              : "daily",
        costRaw: data.Cost ?? null,
        costBasis,
        costGrossKrw,
        costNetKrw,
        vatPolicyVersion,
        ...(term
          ? {
              searchKeywordType:
                descriptor.searchKeywordTypes[data["Search Keyword Type"]],
            }
          : {}),
      });
    }
  } catch (error) {
    reasons.push({
      code: /^[A-Z_]+$/.test(error.message)
        ? error.message
        : "INVALID_ENCODING",
    });
    return { rows: [], reasons };
  }
  return { rows, reasons };
}
