// Process fixture: actual application composition, with the external network closed.
import { bootstrapV05 } from '../../src/bootstrap-v05.js';
import { main } from '../../src/searchad-worker.js';
let outbound=0;
const control=await main({env:process.env,clock:()=>Date.parse('2026-10-05T03:00:00Z'),logger:{info(){},error(){}},bootstrap:(config,options)=>bootstrapV05(config,{...options,fetchImpl:async()=>{outbound++;throw new Error('fixture outbound denied');}})});
const pool=control.app.searchAdCompletionRuntime.automationRepository.pool;
process.send?.({started:true,writerInitialized:Boolean(control.app.searchAdWriteRuntime)});
process.once('SIGTERM',()=>{void control.close().then(()=>{process.send?.({closed:true,poolEnded:pool.ended,outbound},()=>process.disconnect?.());});});
