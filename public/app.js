const screens = ['Mission Control','Mission Canvas','Agent Studio','Execution Terminal','Memory Vault','Skill Forge','Approval Center','Artifact Workspace','System Settings'];
const slug = name => name.toLowerCase().replaceAll(' ','-');
const main = document.querySelector('main');
const nav = document.querySelector('nav');
const indicator = document.querySelector('#connection');
const feedback = document.querySelector('#feedback');
let state, live, selected, filter = '', query = '', activeView, pendingRender = false;
let toastTimer;
const escape = value => String(value ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const label = value => value.replaceAll('_',' ');
const date = value => new Date(value).toLocaleString();
const title = (name,subtitle) => '<h1>'+name+'</h1><p class="lede">'+subtitle+'</p>';
const panel = content => '<section class="panel">'+content+'</section>';
const button = (text,action,id='',primary=false) => '<button type="button" data-action="'+action+'" data-id="'+id+'"'+(primary?' class="primary"':'')+'>'+text+'</button>';
const empty = text => '<p class="muted">'+text+'</p>';
const eventList = items => items.map(e=>'<details><summary>'+escape(label(e.kind))+' · <small>'+escape(date(e.created))+'</small></summary><pre>'+escape(e.detail)+'</pre></details>').join('') || empty('No matching events.');
async function api(path,method='GET',data) {
  const result = await fetch('/api/v1'+path,{method,headers:{'X-Crew-Request':'1','Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const payload = await result.json();
  if (result.status === 401 && path !== '/login') showLogin();
  if (!result.ok) throw Error(payload.error);
  return payload;
}
function notify(message) {
  feedback.textContent = message;
  feedback.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>feedback.hidden=true,4500);
}
function showLogin() {
  live?.close();
  live = undefined;
  state = undefined;
  selected = undefined;
  activeView = undefined;
  nav.hidden = true;
  indicator.textContent = 'Owner access';
  main.innerHTML = title('Sign in','Open the Agent_Crew workspace with your owner password.')+
    panel('<form data-form="login"><label for="password">Owner password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button class="primary">Sign in</button></form>');
}
async function refresh(force=false) {
  const next = await api('/workspace');
  const previous = state;
  state = next;
  if (force || !previous || JSON.stringify(previous)!==JSON.stringify(next)) {
    if (force || !main.contains(document.activeElement)) render(force);
    else pendingRender = true;
  }
}
function connect() {
  if (live) return;
  live = new EventSource('/api/v1/events?after='+(state.events[0]?.id||0));
  live.onopen = ()=>{ indicator.textContent = '● Event stream connected'; refresh().catch(error=>notify(error.message)); };
  live.onmessage = ()=>refresh().catch(error=>notify(error.message));
  live.onerror = ()=>{
    indicator.textContent = 'Reconnecting';
    refresh().catch(()=>{});
  };
}
const missionRows = missions => missions.map(m=>panel('<div class="row"><div><strong>'+escape(m.objective)+'</strong><p class="status">'+escape(label(m.outcome||m.state))+'</p></div>'+button('Inspect','inspect',m.id)+'</div>')).join('');
const views = [
  () => {
    const missions=state.missions;
    const stats=[['Active',missions.filter(m=>['queued','running'].includes(m.state)).length],['Awaiting approval',missions.filter(m=>m.state==='awaiting_approval').length],['Completed',missions.filter(m=>m.state==='completed').length],['Total missions',missions.length]];
    return title('Mission Control','Launch a review of the bundled receipt calculator and follow its execution.')+
      '<div class="stats">'+stats.map(([name,count])=>'<div class="stat"><strong>'+count+'</strong>'+name+'</div>').join('')+'</div>'+
      panel('<h2>New mission</h2><form data-form="mission"><label for="objective">Review objective</label><textarea id="objective" name="objective" maxlength="600" required placeholder="Check whether the receipt total handles line quantities correctly."></textarea><button class="primary">Start sample review</button></form>')+
      '<h2>Missions</h2>'+(missionRows(missions)||empty('No missions yet.'));
  },
  () => {
    const mission=state.missions.find(m=>m.id===selected)||state.missions[0];
    return title('Mission Canvas','Inspect delegation, dependencies, and recorded evidence.')+(mission ?
      panel('<label for="mission-select">Mission</label><select id="mission-select">'+state.missions.map(m=>'<option value="'+m.id+'" '+(m.id===mission.id?'selected':'')+'>'+escape(m.objective)+'</option>').join('')+'</select><div class="row"><p class="status">'+escape(label(mission.outcome||mission.state))+'</p>'+(['queued','running','awaiting_approval'].includes(mission.state)?button('Cancel mission','cancel',mission.id):'')+'</div>')+
      '<div class="steps">'+state.plan.map((step,index)=>panel('<div class="step"><strong>'+step.role+'</strong><p>'+step.task+'</p><small>'+(index ? 'Depends on '+state.plan[index-1].role : 'First step')+'</small><p class="status">'+(index<mission.step?'Executed':index===mission.step&&mission.state==='awaiting_approval'?'Awaiting approval':index===mission.step&&['queued','running'].includes(mission.state)?'Pending':'Unexecuted')+'</p></div>')).join('')+'</div>'+
      panel('<h2>Mission evidence</h2>'+eventList(state.events.filter(e=>e.mission===mission.id))) : empty('Create a mission to inspect its plan.'));
  },
  () => title('Agent Studio','Inspect the workers and tools available to the sample workflow.')+
    '<div class="split">'+state.plan.map(role=>panel('<h2>'+role.role+'</h2><p>'+role.task+'</p><pre>'+role.tool+'</pre>'+button('Check capability','capability',role.tool))).join('')+'</div>',
  () => title('Execution Terminal','Read the persisted execution and security events.')+
    panel('<label for="event-filter">Event type</label><select id="event-filter"><option value="">All event types</option>'+[...new Set(state.events.map(e=>e.kind))].map(kind=>'<option value="'+escape(kind)+'" '+(kind===filter?'selected':'')+'>'+escape(label(kind))+'</option>').join('')+'</select>'+eventList(state.events.filter(e=>!filter||e.kind===filter))),
  () => title('Memory Vault','Search, save, export, and delete owner-authored notes.')+
    panel('<form data-form="note"><label for="note">New note</label><textarea id="note" name="text" maxlength="2000" required></textarea><button class="primary">Save note</button></form>')+
    panel('<form data-form="search"><label for="query">Search notes</label><input id="query" name="query" value="'+escape(query)+'"><button>Search</button> '+button('Export notes','export-notes')+'</form>')+
    (state.notes.filter(n=>n.body.toLowerCase().includes(query.toLowerCase())).map(n=>panel('<p>'+escape(n.body)+'</p><div class="row"><small>Owner note · '+escape(date(n.created))+'</small>'+button('Delete note','delete-note',n.id)+'</div>')).join('')||empty('No matching notes.')),
  () => title('Skill Forge','Save versioned skill drafts for review.')+
    panel('<form data-form="skill"><label for="name">Skill name</label><input id="name" name="name" maxlength="80" required><label for="description">Description</label><textarea id="description" name="description" maxlength="1000" required></textarea><button class="primary">Save draft version</button></form>')+
    (state.skills.map(s=>panel('<h2>'+escape(s.name)+' · v'+s.version+'</h2><p>'+escape(s.description)+'</p><small>Draft</small>')).join('')||empty('No skill drafts.')),
  () => title('Approval Center','Review execution scope and decide whether the verifier may run.')+
    (state.missions.filter(m=>m.approval).map(m=>panel('<h2>'+escape(m.objective)+'</h2><p>Run the bundled receipt calculator with fixed in-memory inputs. The sample uses no file writes or network.</p><p class="status">'+escape(label(m.approval))+'</p><small>Expires '+escape(date(m.expires))+'</small>'+
      (m.state==='awaiting_approval'?'<p>'+button('Approve verification','approve',m.id,true)+button('Deny','deny',m.id)+'</p>':''))).join('')||empty('No approval requests.')),
  () => title('Artifact Workspace','Inspect and download verification evidence with its SHA-256 digest.')+
    (state.artifacts.map(a=>panel('<h2>'+escape(state.missions.find(m=>m.id===a.mission)?.objective)+'</h2><pre>'+a.hash+'</pre>'+button('Inspect evidence','artifact',a.mission)+button('Download JSON','download',a.mission)+'<div id="artifact-'+a.mission+'"></div>')).join('')||empty('Completed verification reports appear here.')),
  () => title('System Settings','Control dispatch and owner sessions.')+
    panel('<h2>Dispatch is '+(state.paused?'paused':'enabled')+'</h2><form data-form="settings"><label for="reauth">Confirm owner password</label><input id="reauth" name="password" type="password" autocomplete="current-password" required><button name="intent" value="dispatch">'+(state.paused?'Resume dispatch':'Pause dispatch')+'</button><button name="intent" value="revoke">Revoke all sessions</button></form>')+
    panel('<h2>Current session</h2>'+button('Sign out','logout'))
];
function render(force=false) {
  if (!state) return;
  pendingRender = false;
  const name=location.hash.slice(1);
  const index=Math.max(0,screens.findIndex(screen=>slug(screen)===name));
  const open=[...main.querySelectorAll('details')].map((detail,i)=>detail.open?i:-1).filter(i=>i>=0);
  nav.hidden=false;
  if (activeView!==index || force) nav.innerHTML=screens.map((screen,i)=>'<a href="#'+slug(screen)+'" '+(index===i?'aria-current="page"':'')+'>'+screen+'</a>').join('');
  main.innerHTML=views[index]();
  if (!force && activeView===index) {
    const details=main.querySelectorAll('details');
    for (const i of open) if(details[i]) details[i].open=true;
  }
  activeView=index;
  document.title='Agent_Crew · '+screens[index];
}
function download(name,data) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download=name;
  anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
main.addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.target;
  const data=Object.fromEntries(new FormData(form));
  const kind=form.dataset.form;
  const submitter=event.submitter;
  if(submitter) submitter.disabled=true;
  try {
    if(kind==='login') { await api('/login','POST',data); await refresh(true); connect(); return; }
    if(kind==='search') { query=data.query; render(true); return; }
    if(kind==='mission') await api('/missions','POST',data);
    if(kind==='note') await api('/notes','POST',data);
    if(kind==='skill') await api('/skills','POST',data);
    if(kind==='settings') {
      if(submitter.value==='revoke') { await api('/logout-all','POST',data); showLogin(); return; }
      await api('/settings','POST',{...data,paused:!state.paused});
    }
    await refresh(true);
  } catch(error) { notify(error.message); }
  finally { if(submitter) submitter.disabled=false; }
});
main.addEventListener('click',async event=>{
  const control=event.target.closest('button[data-action]');
  if(!control) return;
  const {action,id}=control.dataset;
  control.disabled=true;
  try {
    if(action==='inspect') { selected=id; location.hash='mission-canvas'; render(true); return; }
    if(action==='capability') {
      const capabilities=await api('/capabilities');
      if(!capabilities.plan.some(item=>item.tool===id)) throw Error('Capability unavailable');
      notify('Registered capability · '+id);
      return;
    }
    if(action==='logout') { await api('/logout','POST'); showLogin(); return; }
    if(action==='export-notes') { download('agent-crew-notes.json',state.notes); return; }
    if(action==='delete-note') {
      if(!confirm('Delete this note?')) return;
      await api('/notes/'+id,'DELETE');
    }
    if(['approve','deny','cancel'].includes(action)) await api('/missions/'+id+'/'+action,'POST');
    if(['artifact','download'].includes(action)) {
      const report=await api('/missions/'+id+'/artifact');
      if(action==='download') download('verification-'+id+'.json',report);
      else document.querySelector('#artifact-'+id).innerHTML='<pre>'+escape(JSON.stringify(report.body,null,2))+'</pre>';
      return;
    }
    await refresh(true);
  } catch(error) { notify(error.message); }
  finally { control.disabled=false; }
});
main.addEventListener('change',event=>{
  if(event.target.id==='mission-select') { selected=event.target.value; render(true); document.querySelector('#mission-select').focus(); }
  if(event.target.id==='event-filter') { filter=event.target.value; render(true); document.querySelector('#event-filter').focus(); }
});
main.addEventListener('focusout',()=>setTimeout(()=>{
  if(state && pendingRender && !main.contains(document.activeElement)) render();
},50));
window.addEventListener('hashchange',()=>render(true));
try { await refresh(true); connect(); }
catch(error) { if(nav.hidden && !main.querySelector('form')) { main.innerHTML=title('Workspace unavailable','Reload when the local service is running.'); notify(error.message); } }
