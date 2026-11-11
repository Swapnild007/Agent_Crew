import { randomUUID } from 'node:crypto';
import { digest } from './runtime.mjs';
import { roles, validCall } from './provider.mjs';
import { identifier, redact } from './repository.mjs';

const fail = (code,message) => Object.assign(new Error(message),{code});
const terminal = ['completed','failed','denied','expired','cancelled'];
export const capabilities = [
  {role:'Coordinator',tool:'plan_mission',task:'Build a dependency plan'},
  {role:'Research',tool:'catalog_commit',task:'Inventory the pinned Git tree'},
  {role:'Engineering',tool:'read_tracked_text',task:'Collect evidence from allowed text blobs'},
  {role:'Verification',tool:'recheck_citations',task:'Independently re-read evidence and assess relevance'}
];
const clean = (value,n) => redact(value).trim().slice(0,n);
const readJSON = value => JSON.parse(value);
const durableError = /^[a-z][a-z0-9_]{0,48}$/;

export function validatePlan(value) {
  if(!validCall('plan_mission',value) || value.nodes.length<3 || value.nodes.length>6)
    throw fail('plan_invalid','Plan must contain three to six specialist nodes');
  const nodes = value.nodes.map(node=>({...node,task:clean(node.task,180)}));
  const byId=new Map(nodes.map(node=>[node.id,node]));
  if(byId.size!==nodes.length || nodes.some(node=>!identifier.test(node.id)||!node.task||
      new Set(node.depends).size!==node.depends.length||node.depends.some(id=>!byId.has(id))))
    throw fail('plan_invalid','Plan identifiers or dependencies are invalid');
  if(roles.some(role=>!nodes.some(node=>node.role===role)))
    throw fail('plan_invalid','Plan omitted a required specialist');
  const reachable=(node,visiting=new Set())=>{
    if(visiting.has(node.id)) throw fail('plan_invalid','Plan contains a cycle');
    const next=new Set([...visiting,node.id]);
    return new Set(node.depends.flatMap(id=>[id,...reachable(byId.get(id),next)]));
  };
  const verifiers=nodes.filter(node=>node.role==='Verification');
  if(verifiers.length!==1||reachable(verifiers[0]).size!==nodes.length-1)
    throw fail('plan_invalid','Verification must follow all other nodes');
  if(nodes.some(node=>node.role==='Engineering' && ![...reachable(node)].some(id=>byId.get(id).role==='Research')))
    throw fail('plan_invalid','Engineering requires a Research dependency');
  return nodes;
}

export function createInvestigation(db,runtime,provider,inspector,{now=Date.now,retryDelay=1100}={}) {
  const {transaction,event,get}=runtime;
  const getRepo = name => db.prepare('SELECT * FROM repositories WHERE name=?').get(name);
  const nodesFor = id => db.prepare('SELECT * FROM mission_nodes WHERE mission=? ORDER BY rowid').all(id);
  const publicNodes = id => nodesFor(id).map(node=>({
    mission:node.mission,id:node.id,role:node.role,task:node.task,depends:readJSON(node.dependencies),
    state:node.state,attempts:node.attempts,output:node.output?readJSON(node.output):null
  }));
  const agentConfig = () => capabilities.map(item=>({...item,...(db.prepare('SELECT enabled,guidance FROM agent_settings WHERE role=?').get(item.role)||{enabled:1,guidance:''})}));
  let active;
  function create(objective,repository) {
    if (!provider.status.ready) throw fail('provider_configuration','Configure the selected provider first');
    return transaction(()=>{
      const repo=getRepo(repository);
      if(!repo) throw fail('repository_denied','Repository is outside the owner allowlist');
      if(agentConfig().some(item=>!item.enabled)) throw fail('agent_disabled','Enable all required specialist roles before starting');
      const id=randomUUID();
      db.prepare(`INSERT INTO missions(id,objective,state,created,due,approval,expires,repository,revision,provider)
        VALUES(?,?,'awaiting_approval',?,?,'pending',?,?,?,?)`)
        .run(id,objective,now(),now(),now()+900000,repo.name,repo.revision,provider.name);
      event(id,'approval_requested',`Allow read-only inspection of ${repo.name} at ${repo.revision} via ${provider.name}. ${provider.name!=='mock'?'The configured provider will receive the objective and selected redacted text.':'Model processing stays local.'}`);
      return get(id);
    });
  }

  function claim() {
    return transaction(()=>{
      if(db.prepare('SELECT paused FROM settings WHERE id=1').get().paused) return;
      const mission=db.prepare(`SELECT * FROM missions WHERE repository IS NOT NULL AND state IN ('queued','running')
        AND due<=? AND lease_until<=? ORDER BY due,id LIMIT 1`).get(now(),now());
      if(!mission) return;
      const nodes=nodesFor(mission.id);
      const node=nodes.find(candidate=>candidate.state!=='done' &&
        readJSON(candidate.dependencies).every(id=>nodes.some(item=>item.id===id&&item.state==='done')));
      const attempt=node ? node.attempts+1 : mission.plan_attempts+1;
      if(attempt>3 || (nodes.length&&!node)) {
        db.prepare("UPDATE missions SET state='failed',outcome='retry_limit',lease=NULL,lease_until=0 WHERE id=?").run(mission.id);
        event(mission.id,'failed','Checkpoint retry limit reached');
        return;
      }
      const lease=randomUUID();
      db.prepare("UPDATE missions SET lease=?,lease_until=?,state='running' WHERE id=?").run(lease,now()+5000,mission.id);
      if(node) db.prepare("UPDATE mission_nodes SET attempts=?,state='running' WHERE mission=? AND id=?").run(attempt,mission.id,node.id);
      else db.prepare('UPDATE missions SET plan_attempts=? WHERE id=?').run(attempt,mission.id);
      if(attempt>1) event(mission.id,'resumed',`${node?.role||'Coordinator'} attempt ${attempt}`);
      event(mission.id,'agent_started',node?.role||'Coordinator');
      return {mission,nodes,node,lease,attempt};
    });
  }

  const canCommit = work => {
    const latest=get(work.mission.id);
    return latest.state==='running'&&latest.lease===work.lease;
  };
  function authority(work) {
    const latest=get(work.mission.id);
    const repo=getRepo(latest.repository);
    const paused=db.prepare('SELECT paused FROM settings WHERE id=1').get().paused;
    if(!canCommit(work)) throw fail('cancelled','Mission stopped');
    if(paused) throw fail('dispatch_paused','Dispatch paused');
    if(latest.approval!=='approve'||!repo||repo.revision!==latest.revision)
      throw fail('tool_denied','Repository approval is unavailable');
    if(latest.provider!==provider.name||!provider.status.ready)
      throw fail('provider_configuration','Approved provider is unavailable');
    if(!agentConfig().find(item=>item.role===(work.node?.role||'Coordinator'))?.enabled)
      throw fail('agent_disabled','Agent is disabled');
    return repo;
  }

  async function run(work,signal) {
    const {mission,nodes,node}=work;
    const id=mission.id;
    const role=node?.role||'Coordinator';
    const tools = {
      catalog_commit: ['Research'],
      read_tracked_text: ['Engineering','Verification']
    };
    const context={objective:clean(mission.objective,600),task:node?.task||'Return a dependency graph. Research inventories files. Engineering depends on Research. Exactly one Verification node must depend directly or transitively on every other node. Use lowercase simple IDs.',guidance:agentConfig().find(item=>item.role===role)?.guidance||''};
    async function call(tool,payload) {
      authority(work);
      const request=provider.prepare(tool,payload);
      transaction(()=>{
        authority(work);
        if(get(id).budget_reserved+request.reserve>provider.maxBudget) throw fail('budget_limit','Mission budget exhausted');
        if(provider.daily){
          const day=new Date(now()).toISOString().slice(0,10);
          const usage=db.prepare('SELECT requests,tokens FROM provider_daily WHERE provider=? AND day=?')
            .get(provider.name,day)||{requests:0,tokens:0};
          const tokens=request.reservedTokens;
          if(usage.requests+1>provider.daily.requests||usage.tokens+tokens>provider.daily.tokens)
            throw fail('free_quota_limit','Local daily inference allowance reached');
          db.prepare('INSERT OR REPLACE INTO provider_daily VALUES(?,?,?,?)')
            .run(provider.name,day,usage.requests+1,usage.tokens+tokens);
        }
        db.prepare('UPDATE missions SET budget_reserved=budget_reserved+? WHERE id=?').run(request.reserve,id);
        event(id,'model_requested',`${role} · ${tool} · ${provider.name}`);
      });
      const {value,usage}=await request.run(signal);
      if(!validCall(tool,value)) throw fail('provider_schema','Invalid function result');
      if(canCommit(work)) event(id,'model_completed',`${role} · ${tool}${usage?' · '+usage.input+' input / '+usage.output+' output tokens':''}`);
      return value;
    }
    async function inspect(tool,path) {
      const repo=authority(work);
      if(!tools[tool]?.includes(role)) throw fail('tool_denied','Agent lacks tool capability');
      event(id,'tool_invoked',`${role} · ${tool}${path?' · '+path:''}`);
      const result=tool==='catalog_commit' ? await inspector.catalog(repo,signal) : await inspector.read(repo,path,signal);
      if(canCommit(work)) event(id,'tool_completed',`${role} · ${tool}${path?' · '+path:''}`);
      return result;
    }
    if(!node) return {plan:validatePlan(await call('plan_mission',context))};
    const byId=new Map(nodes.map(item=>[item.id,item]));
    const ancestors=new Set();
    function collect(item) {
      for(const dependency of readJSON(item.dependencies)){
        if(ancestors.has(dependency)) continue;
        ancestors.add(dependency);
        collect(byId.get(dependency));
      }
    }
    collect(node);
    const inputs=nodes.filter(item=>ancestors.has(item.id)).map(item=>readJSON(item.output));
    if(role==='Research') return {paths:(await inspect('catalog_commit')).map(item=>item.path)};
    if(role==='Engineering') {
      const paths=[...new Set(inputs.flatMap(item=>item.paths||[]))].slice(0,70);
      const selected=await call('select_evidence',{...context,paths});
      if(selected.paths.length>2||selected.paths.some(path=>!paths.includes(path)))
        throw fail('tool_denied','Model selected a path outside its authorized catalog');
      const files=[];
      for(const path of new Set(selected.paths)) {
        const file=await inspect('read_tracked_text',path);
        files.push({...file,text:file.text.slice(0,4000)});
      }
      const report=await call('report_findings',{...context,files});
      return {findings:report.findings.slice(0,3).map(item=>({
        path:item.path,quote:clean(item.quote,240),claim:clean(item.claim,350),hash:files.find(file=>file.path===item.path)?.hash
      })).filter(item=>item.hash&&item.quote&&item.claim)};
    }
    const proposed=inputs.flatMap(item=>item.findings||[]).slice(0,8);
    const files=new Map();
    const findings=[];
    for(const candidate of proposed){
      if(!files.has(candidate.path)) files.set(candidate.path,await inspect('read_tracked_text',candidate.path));
      const file=files.get(candidate.path);
      if(file.hash===candidate.hash&&candidate.quote.length>=8&&file.text.split('\n').some(line=>line.includes(candidate.quote)))
        findings.push(candidate);
    }
    const assessment=await call('assess_evidence',{...context,findings});
    return {findings,rejected:proposed.length-findings.length,assessment:{verdict:assessment.verdict,reason:clean(assessment.reason,500)},
      outcome:findings.length&&assessment.verdict==='supported'?'evidence_verified':'inconclusive'};
  }

  async function tick() {
    if(active) return;
    const work=claim();
    if(!work) return;
    const {mission,node,attempt,lease}=work;
    const controller=new AbortController();
    active={id:mission.id,controller};
    const renew=setInterval(()=>{
      try {
        if(!canCommit(work)||db.prepare('SELECT paused FROM settings WHERE id=1').get().paused||!getRepo(mission.repository))
          return controller.abort();
        db.prepare('UPDATE missions SET lease_until=? WHERE id=? AND lease=?').run(now()+5000,mission.id,lease);
      } catch { controller.abort(); }
    },750);
    try {
      const output=await run(work,controller.signal);
      transaction(()=>{
        authority(work);
        const id=mission.id;
        if(output.plan){
          const insert=db.prepare('INSERT INTO mission_nodes(mission,id,role,task,dependencies) VALUES(?,?,?,?,?)');
          for(const item of output.plan) insert.run(id,item.id,item.role,item.task,JSON.stringify(item.depends));
          event(id,'delegated',`Coordinator persisted ${output.plan.length} specialist tasks`);
        } else {
          db.prepare("UPDATE mission_nodes SET state='done',output=? WHERE mission=? AND id=?").run(JSON.stringify(output),id,node.id);
          event(id,'agent_completed',node.role);
          if(node.role==='Verification'){
            const body=JSON.stringify({repository:mission.repository,revision:mission.revision,provider:mission.provider,...output},null,2);
            db.prepare('INSERT INTO artifacts(mission,body,hash) VALUES(?,?,?)').run(id,body,digest(body));
            db.prepare("UPDATE missions SET state='completed',outcome=? WHERE id=?").run(output.outcome,id);
            event(id,'verification_completed',output.outcome);
          }
        }
        db.prepare('UPDATE missions SET lease=NULL,lease_until=0,due=?,step=step+1 WHERE id=?').run(now()+250,id);
      });
    } catch(error) {
      transaction(()=>{
        if(!canCommit(work)) return;
        const id=mission.id;
        const paused=db.prepare('SELECT paused FROM settings WHERE id=1').get().paused;
        const code=paused?'dispatch_paused':durableError.test(error.code||'')?error.code:'inspection_failed';
        const retry=paused||Boolean(error.retryable)&&attempt<3;
        if(node) db.prepare('UPDATE mission_nodes SET state=?,attempts=attempts-? WHERE mission=? AND id=?')
          .run(retry?'pending':'failed',paused?1:0,id,node.id);
        db.prepare('UPDATE missions SET state=?,outcome=?,lease=NULL,lease_until=0,due=?,plan_attempts=plan_attempts-? WHERE id=?')
          .run(retry?'running':'failed',retry?null:code,now()+retryDelay*attempt,paused&&!node?1:0,id);
        event(id,retry?'retry_scheduled':'failed',code);
      });
    } finally {
      clearInterval(renew);
      active=undefined;
    }
  }
  function abort(id) {
    if(active&&(!id||active.id===id)) active.controller.abort();
  }
  function remove(name) {
    return transaction(()=>{
      const exists=db.prepare('DELETE FROM repositories WHERE name=?').run(name).changes;
      if(!exists) return false;
      const missions=db.prepare('SELECT id,state FROM missions WHERE repository=?').all(name);
      for(const mission of missions.filter(item=>!terminal.includes(item.state))){
        runtime.decideWithin(mission.id,'cancel');
        abort(mission.id);
      }
      event(null,'repository_revoked',name);
      return true;
    });
  }
  return {create,tick,abort,remove,publicNodes,agentConfig};
}
