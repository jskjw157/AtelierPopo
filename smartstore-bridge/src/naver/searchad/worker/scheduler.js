import { contentHash } from '../write/canonical.js';
const DAY=86400000, HOUR=3600000;
export function intervalFor(kind) { return kind==='register_stat_report'?DAY:kind==='collect_stats'?900000:HOUR; }
export function slotFor(kind,now) { return kind==='register_stat_report'?Math.floor((now+6*HOUR)/DAY)*DAY-6*HOUR:Math.floor(now/intervalFor(kind))*intervalFor(kind); }
export function reportDates(slot) { return [1,2,3].map(offset=>new Date(slot+9*HOUR-offset*DAY).toISOString().slice(0,10)); }
export function staleSlot(kind,slot,now) { return now-slot>(kind==='register_stat_report'?7*DAY:intervalFor(kind)); }
export class SearchAdScheduler {
  constructor({repository,clock=Date.now}) { Object.assign(this,{repository,clock}); }
  async tick({now=this.clock()}={}) {
    let scheduled=0,skipped=0;
    for(const schedule of await this.repository.enabledSchedules()) {
      const end=slotFor(schedule.kind,now), step=intervalFor(schedule.kind);
      // Bounded work per tick. Old history is advanced gradually, never collapsed into a mutation burst.
      let slot=Date.parse(schedule.nextSlotAt), processed=0;
      for(;slot<=end && processed<256;slot+=step,processed++) {
        const stale=staleSlot(schedule.kind,slot,now);
        const job=await this.repository.enqueueSlot({...schedule,slotAt:new Date(slot).toISOString(),requestHash:contentHash({kind:schedule.kind,payload:schedule.payload}),now,skipped:stale});
        if(job.created) { if(stale)skipped++;else scheduled++; }
        await this.repository.advanceSchedule({...schedule,slotAt:new Date(slot).toISOString(),nextSlotAt:new Date(slot+step).toISOString()});
      }
    }
    return {scheduled,skipped};
  }
}
