/** Fixed 1/10000 KRW arithmetic; no binary floating point in financial values. */
export const SCALE=10000n;
export function decimal(value){if(typeof value!=='string'&&typeof value!=='number'||typeof value==='number'&&!Number.isSafeInteger(value))return null;const s=String(value);if(!/^-?(0|[1-9]\d{0,20})(\.\d{1,4})?$/.test(s))return null;const [a,b='']=s.replace('-','').split('.');return (BigInt(a)*SCALE+BigInt(b.padEnd(4,'0')))*(s.startsWith('-')?-1n:1n);}
export function format(value){if(value===null)return null;const sign=value<0n?'-':'';const n=value<0n?-value:value;const frac=String(n%SCALE).padStart(4,'0').replace(/0+$/,'');return `${sign}${n/SCALE}${frac?`.${frac}`:''}`;}
export function sum(values){const parsed=values.map(decimal);return parsed.length&&parsed.every(x=>x!==null)?format(parsed.reduce((a,b)=>a+b,0n)):null;}
export function multiply(a,b){const x=decimal(a),y=decimal(b);return x===null||y===null?null:format(roundDivide(x*y,SCALE));}
function roundDivide(n,d){const negative=(n<0n)!==(d<0n);n=n<0n?-n:n;d=d<0n?-d:d;return (n/d+(n%d*2n>=d?1n:0n))*(negative?-1n:1n);}
function ratio(n,d,places=6){if(n===null||d===null||d===0n)return null;const scale=10n**BigInt(places);const value=roundDivide(n*scale,d),sign=value<0n?'-':'',absolute=value<0n?-value:value,frac=String(absolute%scale).padStart(places,'0').replace(/0+$/,'');return `${sign}${absolute/scale}${frac?`.${frac}`:''}`;}
const deductions=['cogs','fees','shipping','sellerDiscount','returnProvision','adCost'];
const reasonsName=k=>k.replace(/[A-Z]/g,c=>`_${c}`).toUpperCase();
export function calculateProfitability(inputs={},policy={}){
  const components=inputs.components||{},missing=new Set(inputs.missingReasons||[]),componentProvenance={},values={},deducted={};
  for(const k of ['paidRevenue','netRevenue',...deductions,'adAttributedRevenue']){
    const c=components[k]||{},raw=decimal(c.amountKrw);values[k]=raw;
    const netted=c.alreadyIncludedInNetRevenue;
    const value=deductions.includes(k)?(netted===true?0n:netted===false?raw:null):raw;
    if(deductions.includes(k))deducted[k]=value;
    if(value===null&&k!=='adAttributedRevenue'&&k!=='paidRevenue')missing.add(`${reasonsName(k)}_MISSING`);
    componentProvenance[k]={...c,rawAmountKrw:c.rawAmountKrw??c.amountKrw??null,amountKrw:format(raw),deductedKrw:deductions.includes(k)?format(value):null};
  }
  const essential=['netRevenue',...deductions];
  const complete=values.netRevenue!==null&&deductions.every(k=>deducted[k]!==null);
  const costs=complete?deductions.reduce((n,k)=>n+deducted[k],0n):null;
  const contribution=complete?values.netRevenue-costs:null;
  const gross=values.netRevenue!==null&&deducted.cogs!==null?values.netRevenue-deducted.cogs:null;
  const preAd=complete?contribution+deducted.adCost:null;
  if(inputs.mappingVerified!==true)missing.add('MAPPING_UNVERIFIED');
  if(inputs.allocationVerified!==true)missing.add('ALLOCATION_UNVERIFIED');
  const reconciled=essential.every(k=>components[k]?.quality==='estimated'||(components[k]?.quality==='actual'&&components[k]?.reconciled===true));
  if(complete&&!reconciled)missing.add('FINANCIAL_RECONCILIATION_REQUIRED');
  const quality=values.netRevenue===null?'unknown':!complete||missing.size?'partial':essential.some(k=>components[k]?.quality==='estimated')?'estimated':'actual';
  const conversions=decimal(inputs.counts?.conversions),clicks=decimal(inputs.counts?.clicks);
  const metrics={paidRevenueKrw:format(values.paidRevenue),netRevenueKrw:format(values.netRevenue),adAttributedRevenueKrw:format(values.adAttributedRevenue),adCostRawKrw:components.adCost?.rawAmountKrw??format(values.adCost),adCostKrw:format(values.adCost),cogsKrw:format(values.cogs),feesKrw:format(values.fees),shippingKrw:format(values.shipping),sellerDiscountKrw:format(values.sellerDiscount),returnProvisionKrw:format(values.returnProvision),grossMarginKrw:format(gross),contributionKrw:format(contribution),conversions:format(conversions),clicks:format(clicks),marginRate:ratio(contribution,values.netRevenue),breakEvenRoas:values.netRevenue===0n||preAd===null||preAd<=0n?null:ratio(values.netRevenue,preAd),profitRoas:ratio(contribution,values.adCost),roas:ratio(values.adAttributedRevenue,values.adCost),acos:ratio(values.adCost,values.adAttributedRevenue),cpaKrw:ratio(values.adCost,conversions),cvr:ratio(conversions,clicks)};
  return {metrics,quality,missingReasons:[...missing].sort(),componentProvenance,basis:{currency:'KRW',moneyScale:4,rounding:'half_away_from_zero',ratioScale:6,version:'profitability-v1',ratios:{marginRate:['contributionKrw','netRevenueKrw'],breakEvenRoas:['netRevenueKrw','netRevenue_minus_deductions_before_ad'],profitRoas:['contributionKrw','adCostKrw'],roas:['adAttributedRevenueKrw','adCostKrw'],acos:['adCostKrw','adAttributedRevenueKrw'],cpaKrw:['adCostKrw','conversions'],cvr:['conversions','clicks']}},asOf:inputs.asOf??null};
}
export function summarizeOrders(rows){const unique=new Map();let conflict=false;for(const row of rows){if(!row.sourceReference){conflict=true;continue;}const old=unique.get(row.sourceReference);if(old&&JSON.stringify(old)!==JSON.stringify(row))conflict=true;unique.set(row.sourceReference,row);}const values=[...unique.values()];return {paidRevenueKrw:conflict?null:sum(values.map(r=>r.paidAmountKrw)),netRevenueKrw:conflict?null:sum(values.map(r=>r.netRevenueKrw)),quantity:conflict?null:sum(values.map(r=>r.remainingQuantity)),conflict};}
/** Largest remainder apportionment at 1/10000 KRW; stable product-ID tie break.
 * Sum across all products equals the original row, including fractional units. */
export function allocateSpend(rows,haarProductId){
  const unique=new Map();let conflict=false;
  for(const r of rows){const old=unique.get(r.sourceKey);if(!r.sourceKey||old&&JSON.stringify(old)!==JSON.stringify(r))conflict=true;unique.set(r.sourceKey,r);}
  let allocated=0n,unallocated=0n,known=rows.length>0,valid=rows.length>0;
  for(const r of unique.values()){
    const amount=decimal(r.amountKrw),weights=r.weights||[];
    if(amount===null)known=false;
    const total=weights.reduce((n,w)=>n+(decimal(w.weight)??0n),0n),own=weights.find(w=>w.haarProductId===haarProductId);
    const okay=r.verified===true&&typeof r.generation==='string'&&r.generation.length>0&&r.allocationGeneration===r.generation&&total===SCALE&&new Set(weights.map(w=>w.haarProductId)).size===weights.length&&weights.every(w=>decimal(w.weight)>0n)&&own&&amount!==null&&!conflict;
    if(!okay){valid=false;unallocated+=amount??0n;continue;}
    const sign=amount<0n?-1n:1n,absolute=amount*sign;
    const parts=weights.map(w=>({id:w.haarProductId,units:absolute*decimal(w.weight)/SCALE,remainder:absolute*decimal(w.weight)%SCALE})).sort((a,b)=>a.remainder===b.remainder?a.id.localeCompare(b.id):a.remainder>b.remainder?-1:1);
    let remaining=absolute-parts.reduce((n,p)=>n+p.units,0n);
    for(const p of parts){if(remaining>0n){p.units++;remaining--;}if(p.id===haarProductId)allocated+=p.units*sign;}
  }
  return {allocatedKrw:valid?format(allocated):null,unallocatedKrw:known?format(unallocated):null,complete:valid,conflict};
}
