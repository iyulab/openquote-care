import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accepted, checkReport, checkSession, sink } from './check-diagnostics-connection.mjs'

test('reads the collector from a connection string as the app does', () => {
  assert.deepEqual(
    sink('InstrumentationKey=00000000-1111-2222-3333-444444444444;IngestionEndpoint=https://example.in.applicationinsights.azure.com/;LiveEndpoint=https://live/'),
    { key: '00000000-1111-2222-3333-444444444444', trackUrl: 'https://example.in.applicationinsights.azure.com/v2.1/track' },
  )
})

test('a connection string without a key or an https endpoint names no collector', () => {
  for (const connection of [undefined, '', 'IngestionEndpoint=https://x/', 'InstrumentationKey=k;IngestionEndpoint=http://x/', 'InstrumentationKey=;IngestionEndpoint=https://x/']) {
    assert.equal(sink(connection), null, String(connection))
  }
})

test('the check report says it is a check and carries nothing else', () => {
  const report = checkReport('k', '0.1.8', '2026-10-02T00:00:00Z')
  assert.equal(report.tags['ai.application.ver'], '0.1.8-check')
  assert.equal(report.data.baseData.exceptions[0].typeName, 'ReleaseCheck')
  assert.equal(report.data.baseData.exceptions[0].stack, '')
  assert.deepEqual(report.data.baseData.properties, {})
})

test('the check session start is shaped like the app’s own, under a check version and an installation of zeros', () => {
  const start = checkSession('k', '0.15.1', '2026-10-08T00:00:00Z')
  assert.equal(start.tags['ai.application.ver'], '0.15.1-check')
  assert.equal(start.tags['ai.user.id'], '0'.repeat(32))
  assert.equal(start.data.baseType, 'EventData')
  assert.equal(start.data.baseData.name, 'SessionStart')
})

test('only an answer that took both items counts', () => {
  assert.ok(accepted(200, { itemsReceived: 2, itemsAccepted: 2, errors: [] }))
  assert.ok(!accepted(200, { itemsReceived: 2, itemsAccepted: 1, errors: [{ index: 1, statusCode: 400 }] }))
  assert.ok(!accepted(400, { itemsReceived: 2, itemsAccepted: 0 }))
  assert.ok(!accepted(200, undefined))
})
