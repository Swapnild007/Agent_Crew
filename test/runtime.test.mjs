import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createRuntime } from '../runtime.mjs';

test('interleaved missions preserve their checkpoints and independent decisions', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
    let now = 1000;
    const runtime = createRuntime(db,{now:()=>now,delay:100});
    const first = runtime.create('Verify quantity handling');
    const second = runtime.create('Check the sample calculation');
    db.exec('UPDATE settings SET paused=1');
    now += 1000;
    runtime.tick();
    assert.equal(runtime.get(first.id).step,0);
    assert.equal(runtime.get(second.id).step,0);
    db.exec('UPDATE settings SET paused=0');
    for (let round=0;round<3;round++) {
      runtime.tick();
      runtime.tick();
      now += 100;
    }
    assert.equal(runtime.get(first.id).state,'awaiting_approval');
    assert.equal(runtime.get(second.id).state,'awaiting_approval');
    assert.equal(runtime.decide(first.id,'deny').state,'denied');
    assert.equal(runtime.decide(first.id,'approve'),null);
    now += 900000;
    assert.equal(runtime.decide(second.id,'approve'),null);
    runtime.tick();
    assert.equal(runtime.get(second.id).state,'expired');
    assert.equal(db.prepare('SELECT COUNT(*) total FROM artifacts').get().total,0);
  } finally {
    db.close();
  }
});
