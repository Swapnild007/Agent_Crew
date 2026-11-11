import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { receiptTotal } from './fixtures/receipt.mjs';

export const plan = [
  {role:'Coordinator', task:'Plan and delegate', tool:'plan_fixture_review'},
  {role:'Research', task:'Read sample requirements', tool:'read_fixture_requirements'},
  {role:'Engineering', task:'Inspect receipt calculation', tool:'inspect_fixture_source'},
  {role:'Verification', task:'Run independent receipt checks', tool:'verify_fixture'}
];
export const digest = value => createHash('sha256').update(value).digest('hex');

export function createRuntime(db, {now = Date.now, delay = 1200} = {}) {
  const event = (mission, kind, detail) => db.prepare(
    'INSERT INTO events(mission,kind,detail,created) VALUES(?,?,?,?)'
  ).run(mission, kind, detail, now());
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  const get = id => db.prepare('SELECT * FROM missions WHERE id=?').get(id);
  function create(objective) {
    return transaction(() => {
      const id = randomUUID();
      db.prepare('INSERT INTO missions(id,objective,state,created,due) VALUES(?,?,?,?,?)')
        .run(id, objective, 'queued', now(), now()+delay);
      event(id,'queued','Review of the bundled receipt calculator requested');
      return get(id);
    });
  }
  function decide(id, action) {
    return transaction(() => {
      const mission = get(id);
      if (!mission) return;
      if (action === 'cancel' && ['queued','running','awaiting_approval'].includes(mission.state)) {
        db.prepare("UPDATE missions SET state='cancelled', approval=CASE WHEN approval='pending' THEN 'cancelled' ELSE approval END WHERE id=?").run(id);
      } else if (['approve','deny'].includes(action) && mission.state === 'awaiting_approval' && mission.expires > now()) {
        db.prepare('UPDATE missions SET state=?,approval=?,due=? WHERE id=?')
          .run(action === 'approve' ? 'running' : 'denied', action, now()+delay,id);
      } else {
        return null;
      }
      event(id,action,'Owner decision');
      return get(id);
    });
  }
  function tick() {
    transaction(() => {
      const expired = db.prepare("SELECT id FROM missions WHERE state='awaiting_approval' AND expires<=?").all(now());
      for (const {id} of expired) {
        db.prepare("UPDATE missions SET state='expired', approval='expired' WHERE id=?").run(id);
        event(id,'expired','Verification approval expired');
      }
      if (db.prepare('SELECT paused FROM settings WHERE id=1').get().paused) return;
      const mission = db.prepare("SELECT * FROM missions WHERE state IN ('queued','running') AND due<=? ORDER BY due,id LIMIT 1").get(now());
      if (!mission) return;
      const {id,step} = mission;
      const {role,tool} = plan[step];
      event(id,'tool_invoked',role+' · '+tool);
      if (step === 0) {
        event(id,'delegated','Research → Engineering → Verification');
      } else if (step === 1) {
        const requirements = readFileSync(new URL('./fixtures/README.md',import.meta.url),'utf8');
        event(id,'requirements',requirements);
      } else if (step === 2) {
        const source = readFileSync(new URL('./fixtures/receipt.mjs',import.meta.url),'utf8');
        event(id,'source_observed',source);
        db.prepare("UPDATE missions SET state='awaiting_approval', step=3, approval='pending', expires=? WHERE id=?")
          .run(now()+900000,id);
        event(id,'approval_requested','Run the bundled receipt calculation against fixed in-memory inputs. No network or file writes by sample code.');
        return;
      } else {
        if (mission.approval !== 'approve') throw new Error('Verification requires owner approval');
        const cases = [
          {lines:[{price:500,quantity:1}], expected:500},
          {lines:[{price:500,quantity:3},{price:200,quantity:2}], expected:1900}
        ].map(test => ({...test, actual:receiptTotal(test.lines)}));
        const outcome = cases.some(test => test.actual !== test.expected) ? 'verified_defect' : 'inconclusive';
        const body = JSON.stringify({fixture:'receipt.mjs', outcome, cases},null,2);
        db.prepare('INSERT INTO artifacts(mission,body,hash) VALUES(?,?,?)').run(id,body,digest(body));
        db.prepare("UPDATE missions SET state='completed',step=4,outcome=? WHERE id=?").run(outcome,id);
        event(id,'completed',outcome);
        return;
      }
      db.prepare("UPDATE missions SET state='running',step=?,due=? WHERE id=?").run(step+1,now()+delay,id);
    });
  }
  return {create,decide,tick,get,event,transaction};
}
