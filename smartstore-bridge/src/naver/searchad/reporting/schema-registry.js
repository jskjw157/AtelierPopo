import fs from "node:fs";
import { blobHash } from "./blob-storage.js";
import { reportingError, validDate } from "./contracts.js";
export const reportSchemas = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../../../specs/naver-searchad/report-schemas.json",
      import.meta.url,
    ),
  ),
);
export function selectReportSchema(
  {
    kind,
    reportType,
    reportCreatedAt,
    statDate,
    parserVersion = "tsv-v1",
    generationWindow,
  },
  registry = reportSchemas,
) {
  const lower = Date.parse(generationWindow?.lower ?? reportCreatedAt),
    upper = Date.parse(generationWindow?.upper ?? reportCreatedAt);
  if (
    !Number.isFinite(lower) ||
    !Number.isFinite(upper) ||
    lower > upper ||
    (kind === "stat" && !validDate(statDate)) ||
    reportType === "NAVERPAY_CONVERSION"
  )
    throw reportingError("SEARCHAD_REPORT_SCHEMA_UNPROVEN", 409);
  const rollout = generationWindow?.policy?.rolloutUncertaintyMs ?? 0;
  const found = registry.descriptors.filter(
    (d) =>
      d.supported &&
      d.kind === kind &&
      d.reportType === reportType &&
      d.parserVersion === parserVersion &&
      (!d.generationFrom || lower > Date.parse(d.generationFrom) + rollout) &&
      (!d.generationTo || upper < Date.parse(d.generationTo) - rollout),
  );
  if (found.length !== 1)
    throw reportingError("SEARCHAD_REPORT_SCHEMA_UNPROVEN", 409);
  const d = found[0];
  if (blobHash(Buffer.from(JSON.stringify(d.columns))) !== d.orderedSchemaSha)
    throw reportingError("SEARCHAD_REPORT_SCHEMA_UNPROVEN", 409);
  return {
    ...structuredClone(d),
    statDate,
    vatPolicy: structuredClone(registry.vatPolicy),
    searchKeywordTypes: registry.searchKeywordTypes,
  };
}
