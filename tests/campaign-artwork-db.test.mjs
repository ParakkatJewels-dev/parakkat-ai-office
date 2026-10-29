import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
let db;
const campaign = '10000000-0000-4000-8000-000000000001';
const creative = '20000000-0000-4000-8000-000000000001';
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create table campaigns (id uuid primary key, status text not null, channels text[] not null);
    create table creatives (id uuid primary key, campaign_id uuid references campaigns(id), image_path text,
      headline text, body text, product_ids bigint[], art_status text, art_error text, queued_at timestamptz, review_note text, redo_note text);
    create table approvals (id int primary key, status text);`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261026000500_campaign_artwork_freeze.sql', import.meta.url), 'utf8'));
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('truncate creatives, campaigns, approvals;');
  await db.query("insert into campaigns values ($1,'in_approval',array['meta'])", [campaign]);
  await db.query("insert into creatives(id,campaign_id,image_path,headline,art_status) values($1,$2,'approved.png','Approved headline','ready')", [creative,campaign]);
  await db.exec("insert into approvals values(1,'pending')");
});

test('final approval waits for queued or running artwork and rolls back the whole decision', async () => {
  for (const status of ['queued','making']) {
    await db.query('update creatives set art_status=$1', [status]);
    await assert.rejects(db.transaction(async tx => {
      await tx.exec("update approvals set status='approved'");
      await tx.exec("update campaigns set status='approved'");
    }), /Wait for the banner redesign/);
    assert.equal((await db.query('select status from approvals')).rows[0].status, 'pending');
    assert.equal((await db.query('select status from campaigns')).rows[0].status, 'in_approval');
  }
});

test('a finished Meta banner is needed before final approval; manual plans can approve copy', async () => {
  await db.exec('update creatives set image_path=null');
  await assert.rejects(db.exec("update campaigns set status='approved'"), /finished banner/);
  await db.exec("update campaigns set channels=array['google']; update campaigns set status='approved'");
  assert.equal((await db.query('select status from campaigns')).rows[0].status, 'approved');
});

test('approved and publication states freeze new redraws and changes to the selected content', async () => {
  for (const status of ['approved','publishing','publish_review','live']) {
    await db.query('update campaigns set status=$1', [status]);
    for (const sql of ["update creatives set art_status='queued'", "update creatives set art_status='making'",
      "update creatives set image_path='replacement.png'", "update creatives set headline='Unapproved copy'",
      "update creatives set body='Unapproved body'", 'update creatives set product_ids=array[99]::bigint[]', 'delete from creatives']) {
      await assert.rejects(db.exec(sql), /frozen/);
    }
    await assert.rejects(db.query("insert into creatives(id,campaign_id,headline) values('20000000-0000-4000-8000-000000000002',$1,'New banner')",[campaign]), /frozen/);
  }
  const row = (await db.query('select image_path,headline from creatives')).rows[0];
  assert.equal(row.image_path,'approved.png'); assert.equal(row.headline,'Approved headline');
});

test('an old queued job can be cancelled after approval without replacing its approved image', async () => {
  await db.exec("update creatives set art_status='queued'; update campaigns set status='live'");
  await db.exec("update creatives set art_status='ready',queued_at=null,art_error='Cancelled: approved artwork is frozen'");
  assert.equal((await db.query('select image_path from creatives')).rows[0].image_path,'approved.png');
});

test('draft and pending artwork remains editable; cross-campaign reassignment is rejected', async () => {
  await db.exec("update creatives set art_status='queued'; update creatives set art_status='making'; update creatives set image_path='finished.png',art_status='ready'");
  await db.exec("update campaigns set status='approved'");
  assert.equal((await db.query('select image_path from creatives')).rows[0].image_path,'finished.png');
  await assert.rejects(db.exec("update creatives set campaign_id='10000000-0000-4000-8000-000000000002'"), /cannot move/);
});

test('trigger helpers cannot be called directly by signed-in or anonymous users', async () => {
  for (const role of ['anon','authenticated']) {
    const result = await db.query("select has_function_privilege($1,'guard_approved_campaign_artwork()','execute') as creative,has_function_privilege($1,'guard_campaign_artwork_approval()','execute') as approval",[role]);
    assert.equal(result.rows[0].creative,false); assert.equal(result.rows[0].approval,false);
  }
});
