import { reportingError } from "./contracts.js";
/** Recompute the collection slot from the full window, never from age alone. */
export function hasProvenCollectionSlot(proof, statDate) {
  if (!Number.isSafeInteger(proof?.slot)) return false;
  const lower = Date.parse(proof.lower);
  const upper = Date.parse(proof.upper);
  const dayStart = Date.parse(`${statDate}T00:00:00+09:00`);
  if (![lower, upper, dayStart].every(Number.isFinite) || lower > upper)
    return false;
  return (
    Math.floor((lower - dayStart) / 86400000) === proof.slot &&
    Math.floor((upper - dayStart) / 86400000) === proof.slot
  );
}

/** Freshness starts at the original conservative bound, not evaluation time. */
export function isGenerationFresh(proof, now, maxAgeMs) {
  const lower = Date.parse(proof?.lower);
  const collectedAt = Date.parse(proof?.downloadCompletedAt);
  const age = now - lower;
  return (
    Number.isFinite(age) &&
    age >= 0 &&
    age <= maxAgeMs &&
    Number.isFinite(collectedAt) &&
    collectedAt >= lower &&
    collectedAt <= now
  );
}

export function generationProof(job, now, policy) {
  if (
    !policy ||
    policy.version !== "generation-window-v1" ||
    !Number.isSafeInteger(policy.clockUncertaintyMs) ||
    policy.clockUncertaintyMs < 1 ||
    policy.clockUncertaintyMs > 3600000 ||
    !Number.isSafeInteger(policy.rolloutUncertaintyMs) ||
    policy.rolloutUncertaintyMs < 1 ||
    policy.rolloutUncertaintyMs > 86400000
  )
    throw reportingError("SEARCHAD_REPORT_GENERATION_UNPROVEN", 409);
  const events = [
    job.registrationAttemptedAt,
    job.registrationInitiatedAt,
    job.registrationAcknowledgedAt,
    job.firstBuiltObservedAt,
  ].map(Date.parse);
  if (
    !job.claimId ||
    !job.remoteJobId ||
    events.some((v) => !Number.isFinite(v)) ||
    events.some((v, i) => i && v < events[i - 1]) ||
    events.at(-1) > now
  )
    throw reportingError("SEARCHAD_REPORT_GENERATION_UNPROVEN", 409);
  let lower = events[0] - policy.clockUncertaintyMs,
    upper = now + policy.clockUncertaintyMs;
  if (job.kind === "master") {
    const generated = Date.parse(job.reportCreatedAt);
    if (!Number.isFinite(generated) || generated < lower || generated > upper)
      throw reportingError("SEARCHAD_REPORT_GENERATION_UNPROVEN", 409);
    lower = generated - policy.clockUncertaintyMs;
    upper = generated + policy.clockUncertaintyMs;
  }
  const dayStart = Date.parse(`${job.statDate}T00:00:00+09:00`);
  const lowerSlot = Math.floor((lower - dayStart) / 86400000);
  const upperSlot = Math.floor((upper - dayStart) / 86400000);
  const slot =
    job.kind === "stat" && lowerSlot === upperSlot ? lowerSlot : null;
  return {
    downloadCompletedAt: new Date(now).toISOString(),
    basis: job.kind === "stat" ? "derived_window" : "response_generation_time",
    lower: new Date(lower).toISOString(),
    upper: new Date(upper).toISOString(),
    slot,
    stableAge:
      job.kind === "stat" &&
      Number.isSafeInteger(slot) &&
      slot >= 3 &&
      lower >= dayStart + 3 * 86400000,
    policy: {
      ...policy,
      assumptions: [
        "configured_local_clock_uncertainty_not_measured",
        "fresh_owned_acknowledged_job_causally_generates_report",
        "KST_date_only_notice_with_rollout_uncertainty",
      ],
      upstreamImmutable: false,
    },
  };
}
export class SpendEvidenceService {
  constructor({ repository, jobService, identityResolver, clock = Date.now }) {
    Object.assign(this, { repository, jobService, identityResolver, clock });
  }
  async evaluateGeneration(input, context) {
    const job = await this.jobService.load(input, context);
    const identity = await this.jobService.identity(job.customerId, job);
    return this.repository.evaluateGeneration({
      job,
      identity,
      now: this.clock(),
    });
  }
}
