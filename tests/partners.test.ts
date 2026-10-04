import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
const dir = mkdtempSync(path.join(os.tmpdir(), 'krok-partners-test-'));
process.env.KROK_STORAGE_DIR = dir;

// A database from before edit tokens existed: the table has no extra columns and one old declaration.
const legacy = new DatabaseSync(path.join(dir, 'reports.sqlite'));
legacy.exec('CREATE TABLE partner_objects (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL)');
legacy.prepare('INSERT INTO partner_objects (id, body, created_at) VALUES (?, ?, ?)').run('old-1', JSON.stringify({
  id: 'old-1', name: 'Stara Galeria', category: 'culture', lat: 50.061, lon: 19.937, contactEmail: 'old@example.com', features: [{ key: 'lift', value: 'yes' }], promote: false, plan: 'free', obtainedAt: '2026-01-01T00:00:00.000Z',
}), '2026-01-01T00:00:00.000Z');
legacy.close();

const objects = await import('../src/lib/objects');
const { db } = await import('../src/lib/server');

const valid = { name: 'Kawiarnia Poprawkowa', category: 'food', lat: 50.06, lon: 19.94, contactEmail: 'owner@example.com', features: [{ key: 'step_free_entrance', value: 'no', detail: '3 stopnie' }], promote: false, plan: 'free', description: 'Pierwszy opis' };
const feature = (o: { features: { key: string; value: string }[] } | null, key: string) => o?.features.find(f => f.key === key)?.value;

test('creating a declaration returns the edit token once and stores only its hash; old databases are migrated', async () => {
  const { object, editToken, partnerId } = await objects.savePartnerObject(valid);
  assert.match(editToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(object.id, `partner-${partnerId}`);
  const row = db().prepare('SELECT body, edit_hash FROM partner_objects WHERE id=?').get(partnerId) as { body: string; edit_hash: string };
  assert.equal(row.edit_hash, createHash('sha256').update(editToken).digest('hex'));
  assert.ok(!row.body.includes(editToken) && !row.edit_hash.includes(editToken));
  assert.ok(!JSON.stringify(object).includes(editToken) && !JSON.stringify(object).includes('owner@example.com'));
  // The declaration that predates tokens still shows and can be changed by nobody.
  assert.equal((await objects.listObjects({ q: 'stara galeria' }))[0]?.name, 'Stara Galeria');
  assert.equal((await objects.updatePartnerObject('old-1', 'anything', valid)).access, 'forbidden');
  assert.equal(await objects.withdrawPartnerObject('old-1', null), 'forbidden');
});

test('correcting needs the right token and replaces the declaration, keeping id, creation date and the attached place', async () => {
  const { object, editToken, partnerId } = await objects.savePartnerObject(valid);
  const created = object.sources.find(s => s.id === `partner:${partnerId}`)!;
  const change = { ...valid, name: 'Kawiarnia Poprawkowa Nowa', features: [{ key: 'step_free_entrance', value: 'yes', detail: 'rampa' }], description: 'Drugi opis', promote: true, plan: 'partner' };

  for (const token of [undefined, null, '', 'wrong-token', editToken.slice(0, -1) + (editToken.endsWith('A') ? 'B' : 'A')]) {
    assert.equal((await objects.updatePartnerObject(partnerId, token, change)).access, 'forbidden', String(token));
  }
  assert.equal((await objects.updatePartnerObject('no-such-id', editToken, change)).access, 'not_found');
  assert.equal(feature(await objects.getObject(object.id), 'step_free_entrance'), 'no', 'rejected edits change nothing');
  await assert.rejects(() => objects.updatePartnerObject(partnerId, editToken, { ...valid, lat: 52.2 }), 'same validation as create');
  await assert.rejects(() => objects.updatePartnerObject(partnerId, editToken, { ...valid, admin: true }));

  const result = await objects.updatePartnerObject(partnerId, editToken, { ...change, existingObjectId: 'osm-node-1' });
  assert.equal(result.access, 'ok');
  const now = (await objects.getObject(object.id))!;
  assert.equal(now.id, object.id);
  assert.equal(now.name, 'Kawiarnia Poprawkowa Nowa');
  assert.equal(now.description, 'Drugi opis');
  assert.equal(feature(now, 'step_free_entrance'), 'yes');
  assert.equal(now.partner?.promoted, true);
  const source = now.sources.find(s => s.id === `partner:${partnerId}`)!;
  assert.equal(source.obtainedAt, created.obtainedAt);
  assert.ok(source.editedAt && source.editedAt >= created.obtainedAt);
  assert.ok(!JSON.stringify(now).includes('owner@example.com'));
  assert.equal((await objects.listObjects({ q: 'poprawkowa nowa' }))[0]?.id, object.id, 'the catalogue cache was invalidated');
  // The owner can read the record back, with the private e-mail, to prefill the form.
  const read = await objects.readPartnerDeclaration(partnerId, editToken);
  assert.equal(read.record?.contactEmail, 'owner@example.com');
  assert.equal(read.record?.existingObjectId, undefined, 'existingObjectId from the body is ignored');
  assert.equal((await objects.readPartnerDeclaration(partnerId, 'nope')).record, undefined);
});

test('withdrawing needs the right token, removes the declaration from the catalogue and keeps an audit row without the e-mail', async () => {
  const { object, editToken, partnerId } = await objects.savePartnerObject({ ...valid, name: 'Kawiarnia Wycofana' });
  assert.equal(await objects.withdrawPartnerObject(partnerId, undefined), 'forbidden');
  assert.equal(await objects.withdrawPartnerObject(partnerId, 'wrong'), 'forbidden');
  assert.equal(await objects.withdrawPartnerObject('no-such-id', editToken), 'not_found');
  assert.ok(await objects.getObject(object.id));
  assert.equal(await objects.withdrawPartnerObject(partnerId, editToken), 'ok');
  assert.equal(await objects.getObject(object.id), null);
  assert.equal((await objects.listObjects({ q: 'kawiarnia wycofana' })).length, 0);
  const row = db().prepare('SELECT body, withdrawn_at FROM partner_objects WHERE id=?').get(partnerId) as { body: string; withdrawn_at: string };
  assert.ok(row.withdrawn_at);
  assert.ok(!row.body.includes('owner@example.com'));
  assert.equal(await objects.withdrawPartnerObject(partnerId, editToken), 'not_found', 'already withdrawn');
  assert.equal((await objects.updatePartnerObject(partnerId, editToken, valid)).access, 'not_found');
  assert.ok(!(await objects.listPartnerDeclarations()).some(d => d.id === partnerId), 'withdrawn ones are not in the city list');
});

test('a declaration attached to an existing place is withdrawn without touching the place', async () => {
  const { object: base, editToken: t1, partnerId: p1 } = await objects.savePartnerObject({ ...valid, name: 'Kawiarnia Bazowa' });
  const { object, editToken, partnerId } = await objects.savePartnerObject({ ...valid, existingObjectId: base.id, features: [{ key: 'lift', value: 'yes' }] });
  assert.equal(object.id, base.id);
  assert.equal(object.sources.filter(s => s.kind === 'partner').length, 2);
  assert.equal(await objects.withdrawPartnerObject(partnerId, editToken), 'ok');
  const after = (await objects.getObject(base.id))!;
  assert.deepEqual(after.sources.filter(s => s.kind === 'partner').map(s => s.id), [`partner:${p1}`]);
  assert.equal(feature(after, 'lift'), undefined);
  assert.equal(await objects.withdrawPartnerObject(p1, t1), 'ok');
});

test('the city can hide a false declaration and restore it; hidden ones stay stored for audit', async () => {
  const { object, editToken, partnerId } = await objects.savePartnerObject({ ...valid, name: 'Kawiarnia Ukrywana' });
  assert.ok((await objects.listPartnerDeclarations()).some(d => d.id === partnerId && !d.hidden));
  const hidden = await objects.setPartnerHidden(partnerId, true);
  assert.equal(hidden?.hidden, true);
  assert.ok(hidden?.hiddenAt);
  assert.equal(await objects.getObject(object.id), null);
  assert.equal((await objects.listObjects({ q: 'kawiarnia ukrywana' })).length, 0);
  assert.equal((await objects.listPartnerDeclarations()).find(d => d.id === partnerId)?.hidden, true, 'still listed for the city');
  // The owner can still correct it, but that does not undo the city's decision.
  assert.equal((await objects.updatePartnerObject(partnerId, editToken, { ...valid, name: 'Kawiarnia Ukrywana 2' })).access, 'ok');
  assert.equal(await objects.getObject(object.id), null);
  assert.equal((await objects.setPartnerHidden(partnerId, false))?.hidden, false);
  assert.equal((await objects.getObject(object.id))?.name, 'Kawiarnia Ukrywana 2');
  assert.equal(await objects.setPartnerHidden('no-such-id', true), null);
});

test('the demo partner cannot be edited, read or withdrawn', async () => {
  const id = objects.DEMO_PARTNER.id;
  for (const token of [undefined, 'x', objects.DEMO_PARTNER.contactEmail]) {
    assert.equal((await objects.updatePartnerObject(id, token, valid)).access, 'not_found');
    assert.equal(await objects.withdrawPartnerObject(id, token), 'not_found');
    assert.equal((await objects.readPartnerDeclaration(id, token)).access, 'not_found');
  }
  assert.ok(await objects.getObject(objects.DEMO_PARTNER_OBJECT_ID));
  assert.ok(!(await objects.listPartnerDeclarations()).some(d => d.id === id), 'example data is not a real declaration to moderate');
});
