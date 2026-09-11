export const SEARCHAD_STATS_VAT_BASIS = 'VAT_INCLUDED';

function finiteNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseKstCycleBaseTm(value) {
  const text = String(value ?? '').trim();
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(text);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const hour = Number(hh);
  const minute = Number(mm);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const utcMs = Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0);
  const kst = new Date(utcMs + 9 * 60 * 60 * 1000);
  if (
    kst.getUTCFullYear() !== year ||
    kst.getUTCMonth() + 1 !== month ||
    kst.getUTCDate() !== day ||
    kst.getUTCHours() !== hour ||
    kst.getUTCMinutes() !== minute
  ) return null;
  return utcMs;
}

function summarySpend(section, entityId) {
  const rows = section?.data;
  if (!Array.isArray(rows) || rows.length === 0) return { amount: null, validity: 'missing' };
  const matches = rows.filter(row => String(row?.id ?? '') === String(entityId));
  if (matches.length === 0) return { amount: null, validity: 'missing' };
  if (matches.length !== 1) return { amount: null, validity: 'malformed' };
  if (!Object.hasOwn(matches[0] || {}, 'salesAmt')) return { amount: null, validity: 'missing' };
  const amount = matches[0].salesAmt;
  return finiteNonNegativeNumber(amount)
    ? { amount, validity: 'valid' }
    : { amount: null, validity: 'malformed' };
}

function dailySpend(section, entityId) {
  const rows = section?.data;
  if (!Array.isArray(rows) || rows.length === 0) return { amount: null, validity: 'missing' };
  const relevant = rows.filter(row => row?.id == null || String(row.id) === String(entityId));
  if (relevant.length === 0) return { amount: null, validity: 'missing' };
  let total = 0;
  for (const row of relevant) {
    if (!Object.hasOwn(row || {}, 'salesAmt')) return { amount: null, validity: 'missing' };
    if (!finiteNonNegativeNumber(row.salesAmt)) return { amount: null, validity: 'malformed' };
    total += row.salesAmt;
  }
  return { amount: total, validity: 'valid' };
}

export function parseStatsResponse({
  data,
  entityId,
  timeIncrement = 'allDays',
  observedAtMs = Date.now(),
  maxCycleAgeMs = 72 * 60 * 60 * 1000
} = {}) {
  const section = timeIncrement === '1'
    ? data?.dailyStatResponse
    : data?.summaryStatResponse;
  const cycleBaseTm = section?.cycleBaseTm == null ? null : String(section.cycleBaseTm);
  const cycleMs = parseKstCycleBaseTm(cycleBaseTm);
  if (cycleBaseTm == null || cycleBaseTm === '') {
    return { salesAmtKrw: null, vatBasis: SEARCHAD_STATS_VAT_BASIS, cycleBaseTm, validity: 'missing' };
  }
  if (cycleMs == null) {
    return { salesAmtKrw: null, vatBasis: SEARCHAD_STATS_VAT_BASIS, cycleBaseTm, validity: 'malformed' };
  }

  const spend = timeIncrement === '1'
    ? dailySpend(section, entityId)
    : summarySpend(section, entityId);
  if (spend.validity !== 'valid') {
    return {
      salesAmtKrw: null,
      vatBasis: SEARCHAD_STATS_VAT_BASIS,
      cycleBaseTm,
      validity: spend.validity
    };
  }

  const nowMs = Number(observedAtMs);
  const maxAge = Number(maxCycleAgeMs);
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxAge) || maxAge < 0) {
    return { salesAmtKrw: null, vatBasis: SEARCHAD_STATS_VAT_BASIS, cycleBaseTm, validity: 'malformed' };
  }
  if (nowMs - cycleMs > maxAge) {
    return { salesAmtKrw: spend.amount, vatBasis: SEARCHAD_STATS_VAT_BASIS, cycleBaseTm, validity: 'stale' };
  }
  return { salesAmtKrw: spend.amount, vatBasis: SEARCHAD_STATS_VAT_BASIS, cycleBaseTm, validity: 'valid' };
}

export const _internal = { parseKstCycleBaseTm, summarySpend, dailySpend, finiteNonNegativeNumber };
