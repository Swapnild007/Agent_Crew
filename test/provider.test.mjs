import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProvider } from '../provider.mjs';

const env={
  AGENT_CREW_PROVIDER:'openai',AGENT_CREW_MODEL:'gpt-5.4-mini',
  AGENT_CREW_OPENAI_KEY:'contract-test-placeholder',
  AGENT_CREW_INPUT_USD_MICROS_PER_MILLION:'750000',AGENT_CREW_OUTPUT_USD_MICROS_PER_MILLION:'4500000'
};
const fixture=(name,args)=>Response.json({choices:[{finish_reason:'tool_calls',message:{tool_calls:[
  {type:'function',function:{name,arguments:JSON.stringify(args)}}
]}}],usage:{prompt_tokens:410,completion_tokens:26}});

test('OpenAI adapter uses the fixed endpoint, strict tool schema and bounded generation',async()=>{
  const provider=createProvider({env,fetcher:async(url,request)=>{
    assert.equal(url,'https://api.openai.com/v1/chat/completions');
    assert.equal(request.redirect,'error');
    assert.equal(request.headers.Authorization,'Bearer contract-test-placeholder');
    const body=JSON.parse(request.body);
    assert.equal(body.model,'gpt-5.4-mini');
    assert.equal(body.store,false);
    assert.equal(body.max_completion_tokens,1600);
    assert.equal(body.parallel_tool_calls,false);
    assert.equal(body.tools[0].function.strict,true);
    assert.equal(body.tool_choice.function.name,'select_evidence');
    assert.doesNotMatch(request.body,/contract-test-placeholder/);
    return fixture('select_evidence',{paths:['README.md']});
  }});
  const request=provider.prepare('select_evidence',{paths:['README.md']});
  assert.ok(request.reserve>0);
  assert.deepEqual(await request.run(),{value:{paths:['README.md']},usage:{input:410,output:26}});
  assert.doesNotMatch(JSON.stringify(provider.status),/contract-test-placeholder/);
});

test('malformed calls, wrong tools, unconfigured credentials, timeouts and HTTP errors fail safely',async()=>{
  const configured=fetcher=>createProvider({env,fetcher}).prepare('select_evidence',{}).run();
  await assert.rejects(configured(()=>fixture('run_shell',{command:'untrusted'})),{code:'provider_schema'});
  await assert.rejects(configured(()=>fixture('select_evidence',{paths:[42]})),{code:'provider_schema'});
  await assert.rejects(configured(()=>new Response('sensitive diagnostic',{status:429})),error=>
    error.code==='provider_http_429'&&error.retryable&&!error.message.includes('sensitive'));
  await assert.rejects(configured(()=>new Response('',{status:401})),error=>error.code==='provider_http_401'&&!error.retryable);
  assert.throws(()=>createProvider({env:{...env,AGENT_CREW_OPENAI_KEY:''}}).prepare('select_evidence',{}),{code:'provider_configuration'});
  assert.throws(()=>createProvider({env}).prepare('select_evidence',{data:'x'.repeat(17000)}),{code:'context_limit'});
  const timeout=createProvider({env:{...env,AGENT_CREW_MODEL_TIMEOUT_MS:'50'},fetcher:(_,request)=>new Promise((resolve,reject)=>{
    request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true});
    setTimeout(()=>resolve(new Response()),100);
  })});
  await assert.rejects(timeout.prepare('select_evidence',{}).run(),{code:'provider_timeout',retryable:true});
});
