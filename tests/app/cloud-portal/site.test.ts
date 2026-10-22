import { describe, expect, test } from 'bun:test'

import type { CloudAccountStatus } from '@open-pencil/cloud/contract'

import { siteDestination, type SiteAccount } from '@/app/cloud-portal/site'

function account(state: CloudAccountStatus['state']): CloudAccountStatus {
  return {
    state,
    user: { userId: 'user-1', email: 'ada@example.com', name: 'Ada', deploymentRole: 'user' }
  }
}

const visit = (
  path: string,
  who: SiteAccount,
  options: { localEditor?: boolean; choseLocalEditor?: boolean } = {}
) =>
  siteDestination({
    path,
    account: who,
    localEditor: options.localEditor ?? true,
    choseLocalEditor: options.choseLocalEditor ?? false
  })

describe('Cloud server editor pages', () => {
  test('open the editor for an account that may use the server', () => {
    expect(visit('/', account('active'))).toBeNull()
    expect(visit('/', account('active'), { localEditor: false })).toBeNull()
  })

  test('welcome visitors at the root who are not signed in or not let in yet', () => {
    expect(visit('/', null)).toBe('/welcome')
    expect(visit('/', account('pending'))).toBe('/welcome')
    expect(visit('/', account('revoked'))).toBe('/welcome')
  })

  test('open the local editor once this browser chose it, and other pages without asking', () => {
    expect(visit('/', null, { choseLocalEditor: true })).toBeNull()
    expect(visit('/demo', null)).toBeNull()
  })

  test('welcome everyone without an account where the server turns the local editor off', () => {
    expect(visit('/', null, { localEditor: false, choseLocalEditor: true })).toBe('/welcome')
    expect(visit('/demo', null, { localEditor: false })).toBe('/welcome')
    expect(visit('/share/room', account('pending'), { localEditor: false })).toBe('/welcome')
  })

  test('leave document, shared file, and invitation links to sign in on their own', () => {
    for (const path of ['/cloud/documents/a', '/cloud/share/b', '/cloud/invitations/c']) {
      expect(visit(path, null, { localEditor: false })).toBeNull()
    }
  })

  test('open the editor when the server cannot say, since the editor works without it', () => {
    expect(visit('/', 'unreachable', { localEditor: false })).toBeNull()
  })
})
