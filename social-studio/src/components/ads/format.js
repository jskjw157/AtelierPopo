const offsets={KRW:1,JPY:1,USD:100,EUR:100,GBP:100,AUD:100,CAD:100,SGD:100,HKD:100};
export function amount(value,currency='KRW',minor=false){
  if(value===null||value===undefined||value===''||!Number.isFinite(Number(value)))return '데이터 없음';
  if(minor&&!offsets[currency])return `${value} (Meta 원시 단위)`;
  return new Intl.NumberFormat('ko-KR',{style:'currency',currency,maximumFractionDigits:4}).format(Number(value)/(minor?offsets[currency]:1));
}
export function date(value,timezone){
  if(!value||!Number.isFinite(Date.parse(value)))return '—';
  try{return new Intl.DateTimeFormat('ko-KR',{dateStyle:'short',timeStyle:'short',timeZone:timezone||undefined}).format(new Date(value));}catch{return String(value);}
}
export const statusLabel={pending:'승인 대기',approved:'승인 완료',executing:'실행 중',verification_required:'결과 재확인 필요',executed:'실행 확인 완료',cancelled:'요청 취소',invalidated:'내용 변경으로 무효',expired:'만료',draft:'초안'};
export const actionLabel={launch:'새 광고 시작',pause:'중지',resume:'재개',change_budget:'예산 변경'};
export const objectiveLabel={TRAFFIC:'트래픽',ENGAGEMENT:'참여',SALES:'구매'};
