import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toE164,
  headlineStatus,
  buildDesiredContacts,
  planSync,
  contactSyncState,
} from './googleContacts.js';

test('toE164 normalizes Israeli numbers the dialer can match', () => {
  assert.equal(toE164('0521234567'), '+972521234567');
  assert.equal(toE164('052-123-4567'), '+972521234567');
  assert.equal(toE164('972521234567'), '+972521234567');
  assert.equal(toE164('9720521234567'), '+972521234567');
  assert.equal(toE164('+972521234567'), '+972521234567');
});

test('toE164 rejects fragments instead of writing a broken contact', () => {
  assert.equal(toE164(''), '');
  assert.equal(toE164(null), '');
  assert.equal(toE164('052'), '');
  assert.equal(toE164('לא מספר'), '');
});

test('headlineStatus reports the most advanced status in the family', () => {
  assert.equal(
    headlineStatus({ status: 'lead_new' }, [{ status: 'registered' }, { status: 'archived' }]),
    'registered'
  );
  assert.equal(headlineStatus({ status: 'lead_new' }, []), 'lead_new');
  assert.equal(headlineStatus({}, []), 'lead_new');
  assert.equal(headlineStatus({ status: 'nonsense' }, [{ status: 'waitlist' }]), 'waitlist');
});

test('parent contacts read status - parent - children', () => {
  const desired = buildDesiredContacts(
    [{ id: 'p1', name: 'דנה', lastName: 'כהן', phone: '0521234567', status: 'lead_new' }],
    [
      { id: 's1', parentId: 'p1', name: 'יובל', status: 'registered' },
      { id: 's2', parentId: 'p1', name: 'נועה', status: 'lead_new' },
    ]
  );
  assert.deepEqual(desired.get('parent:p1'), {
    key: 'parent:p1',
    name: 'חוג פעיל - דנה כהן - יובל כהן, נועה כהן',
    phone: '+972521234567',
  });
});

test('a parent with no children keeps a two-part name', () => {
  const desired = buildDesiredContacts(
    [{ id: 'p1', name: 'אבי לוי', phone: '0501112222', status: 'health_signed' }],
    []
  );
  assert.equal(desired.get('parent:p1').name, 'חתם הצהרה - אבי לוי');
});

test('archived children drop off the parent card but keep their own status weight', () => {
  const desired = buildDesiredContacts(
    [{ id: 'p1', name: 'מיכל ברק', phone: '0501112222', status: 'archived' }],
    [{ id: 's1', parentId: 'p1', name: 'איתי', status: 'archived' }]
  );
  assert.equal(desired.get('parent:p1').name, 'ארכיון - מיכל ברק');
});

test('a child full name already carrying a surname is left alone', () => {
  const desired = buildDesiredContacts(
    [{ id: 'p1', name: 'דנה', lastName: 'כהן', phone: '0521234567', status: 'registered' }],
    [{ id: 's1', parentId: 'p1', name: 'יובל מזרחי', status: 'registered' }]
  );
  assert.equal(desired.get('parent:p1').name, 'חוג פעיל - דנה כהן - יובל מזרחי');
});

test('an adult who trains is not listed twice on their own contact', () => {
  const desired = buildDesiredContacts(
    [{ id: 'p1', name: 'מירית בזר', lastName: 'בזר', phone: '0544402660', status: 'past_registered' }],
    [
      { id: 's1', parentId: 'p1', name: 'מירית בזר', status: 'past_registered' },
      { id: 's2', parentId: 'p1', name: 'עומר', status: 'registered' },
    ]
  );
  assert.equal(desired.get('parent:p1').name, 'חוג פעיל - מירית בזר - עומר בזר');
});

test('an adult who trains alone keeps a two-part name', () => {
  const desired = buildDesiredContacts(
    [{ id: 'p1', name: 'רן שדמי', phone: '0501112222', status: 'lead_new' }],
    [{ id: 's1', parentId: 'p1', name: 'רן שדמי', status: 'registered' }]
  );
  assert.equal(desired.get('parent:p1').name, 'חוג פעיל - רן שדמי');
});

test('trainees with their own line get a מטפס contact', () => {
  const desired = buildDesiredContacts(
    [{ id: 'p1', name: 'דנה', lastName: 'כהן', phone: '0521234567', status: 'registered' }],
    [{ id: 's1', parentId: 'p1', name: 'יובל', phone: '0539998888', status: 'registered' }]
  );
  assert.equal(desired.get('student:s1').name, 'מטפס - יובל כהן');
  assert.equal(desired.get('student:s1').phone, '+972539998888');
});

test('a trainee sharing the parent line does not become a second contact', () => {
  const desired = buildDesiredContacts(
    [{ id: 'p1', name: 'דנה כהן', phone: '0521234567', status: 'registered' }],
    [{ id: 's1', parentId: 'p1', name: 'יובל', phone: '052-123-4567', status: 'registered' }]
  );
  assert.equal(desired.has('student:s1'), false);
  assert.equal(desired.size, 1);
});

test('records without a usable phone are skipped', () => {
  const desired = buildDesiredContacts(
    [
      { id: 'p1', name: 'ללא טלפון', phone: '', status: 'lead_new' },
      { id: 'p2', name: 'טלפון שבור', phone: '12', status: 'lead_new' },
    ],
    [{ id: 's1', parentId: 'p1', name: 'ילד', status: 'lead_new' }]
  );
  assert.equal(desired.size, 0);
});

test('planSync creates, updates and deletes against the live address book', () => {
  const desired = new Map([
    ['parent:p1', { key: 'parent:p1', name: 'חוג פעיל - דנה כהן', phone: '+972521234567' }],
    ['parent:p2', { key: 'parent:p2', name: 'ליד חדש - אבי לוי', phone: '+972501112222' }],
  ]);
  const managed = new Map([
    [
      'parent:p1',
      {
        key: 'parent:p1',
        resourceName: 'people/c1',
        etag: 'e1',
        name: 'ליד חדש - דנה כהן',
        phone: '+972521234567',
      },
    ],
    [
      'parent:p9',
      {
        key: 'parent:p9',
        resourceName: 'people/c9',
        etag: 'e9',
        name: 'ליד חדש - נמחק',
        phone: '+972500000000',
      },
    ],
  ]);

  const { toCreate, toUpdate, toDelete } = planSync(desired, managed);
  assert.deepEqual(toCreate.map((c) => c.key), ['parent:p2']);
  assert.deepEqual(toUpdate.map((c) => c.key), ['parent:p1']);
  assert.equal(toUpdate[0].resourceName, 'people/c1');
  assert.equal(toUpdate[0].etag, 'e1');
  assert.deepEqual(toDelete.map((c) => c.key), ['parent:p9']);
});

test('planSync leaves untouched contacts alone', () => {
  const contact = { key: 'parent:p1', name: 'חוג פעיל - דנה כהן', phone: '+972521234567' };
  const { toCreate, toUpdate, toDelete } = planSync(
    new Map([['parent:p1', contact]]),
    new Map([['parent:p1', { ...contact, resourceName: 'people/c1', etag: 'e1' }]])
  );
  assert.equal(toCreate.length, 0);
  assert.equal(toUpdate.length, 0);
  assert.equal(toDelete.length, 0);
});

test('contactSyncState tells the customer screen where the record stands', () => {
  const wanted = { key: 'parent:p1', name: 'חוג פעיל - דנה כהן', phone: '+972521234567' };
  assert.equal(contactSyncState(wanted, { ...wanted, resourceName: 'people/c1' }), 'synced');
  assert.equal(contactSyncState(wanted, null), 'missing');
  assert.equal(contactSyncState(wanted, { ...wanted, name: 'ליד חדש - דנה כהן' }), 'stale');
  assert.equal(contactSyncState(wanted, { ...wanted, phone: '+972500000000' }), 'stale');
  assert.equal(contactSyncState(null, null), 'no_phone');
});
