#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { bootstrapV05, disposeApplicationV05 } from './bootstrap-v05.js';
import { loadWorkerConfig, workerError } from './naver/searchad/worker/config.js';
export async function main({env=process.env,clock=Date.now,bootstrap=bootstrapV05,logger=console}={}) {
  const config=loadWorkerConfig(env);
  if(!config.enabled) {logger.info?.('SearchAd worker is disabled');return {enabled:false,async close(){return true;}};}
  const app=await bootstrap(env.ATELIER_CONFIG_PATH || undefined,{env,clock});
  const runtime=app.searchAdCompletionRuntime?.workerRuntime;
  if(!runtime?.status().ready) {await disposeApplicationV05(app);throw workerError('STARTUP',503);}
  let closing;
  const close=()=>{
    if(closing)return closing;
    closing=disposeApplicationV05(app).then(value=>{process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);return value;}).catch(error=>{closing=null;throw error;});return closing;
  };
  const signal=()=>{void close().catch(()=>{logger.error?.('SearchAd worker shutdown is pending',{code:'SEARCHAD_WORKER_SHUTDOWN_PENDING'});process.exitCode=1;});};
  process.once('SIGINT',signal);process.once('SIGTERM',signal);
  runtime.worker.start();logger.info?.('SearchAd worker started');return {enabled:true,app,worker:runtime.worker,close};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('SearchAd worker startup failed');process.exitCode=1;});
