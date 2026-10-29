import 'server-only';
import {createHash} from 'node:crypto';
import {checkPause} from '@/lib/pause';
import {recordUsage} from '@/lib/usage';
import {runAiBudgetedText} from '@/lib/ai-budget';
import {getNimConfig,canUseNim,recordNimResult} from './nim-config';
import {nimJSON,NimError} from './nim-core.mjs';

export async function nimChat<T>(system:string,user:string,options:{signal?:AbortSignal;timeoutMs?:number;maxOutputTokens?:number}={}):Promise<T>{
  if(!await canUseNim())throw new NimError('Verify NVIDIA NIM in Settings → AI providers before using it.','not_verified');
  const config=await getNimConfig();
  const accountKey=createHash('sha256').update(config.apiKey).digest('hex');
  return runAiBudgetedText({provider:'nim',accountKey,model:config.model,system,user,signal:options.signal,timeoutMs:options.timeoutMs,maxOutputTokens:options.maxOutputTokens},async run=>{
    const started=Date.now();
    try{
      await checkPause();
      const result=await nimJSON<T>({...config,system,user,maxOutputTokens:Math.min(run.maxOutputTokens,4096),signal:run.signal});
      run.reportUsage(result.usage);
      await recordUsage({provider:'nim',model:result.model,system,input:result.usage.inputTokens,output:result.usage.outputTokens,ms:Date.now()-started});
      return result.value;
    }catch(error){
      const usage=error instanceof NimError?error.usage:undefined;
      if(usage?.usageKnown)run.reportUsage(usage);
      await recordUsage({provider:'nim',model:config.model,system,input:usage?.inputTokens,output:usage?.outputTokens,ok:false,ms:Date.now()-started});
      // A failed hosted inference disables further NIM routing until the
      // administrator's explicit connection test succeeds again.
      if(error instanceof NimError)await recordNimResult(config,error);
      throw error;
    }
  });
}

/** One opt-in synthetic check. The provider request is still admitted through app usage limits. */
export async function testNim():Promise<void>{
  await checkPause();
  const config=await getNimConfig();
  if(!config.apiKey)throw new NimError('Add a NVIDIA NIM API key first.','missing_key');
  const system='Return exactly one JSON object with the boolean field ok set to true.';
  const user='Connection check.';
  const accountKey=createHash('sha256').update(config.apiKey).digest('hex');
  try{
    const value=await runAiBudgetedText({provider:'nim',accountKey,model:config.model,system,user,maxOutputTokens:256},async run=>{
      const started=Date.now();
      try{
        const answer=await nimJSON<{ok:boolean}>({...config,system,user,maxOutputTokens:Math.min(256,run.maxOutputTokens),signal:run.signal});
        run.reportUsage(answer.usage);
        await recordUsage({provider:'nim',model:answer.model,system,input:answer.usage.inputTokens,output:answer.usage.outputTokens,ms:Date.now()-started});
        return answer.value;
      }catch(error){await recordUsage({provider:'nim',model:config.model,system,ok:false,ms:Date.now()-started});throw error;}
    });
    if(value.ok!==true)throw new NimError('NVIDIA NIM did not return the expected test answer.','invalid_response');
    await recordNimResult(config);
  }catch(error){if(error instanceof NimError)await recordNimResult(config,error);throw error;}
}
