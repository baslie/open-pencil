import { describe, expect, test } from 'bun:test'

import type { CloudAccountStatus } from '@open-pencil/cloud/contract'

import { rootDestination } from '@/app/cloud-portal/site'

function account(state: CloudAccountStatus['state']): CloudAccountStatus {
  return {
    state,
    user: { userId: 'user-1', email: 'ada@example.com', name: 'Ada', deploymentRole: 'user' }
  }
}

describe('Cloud server root', () => {
  test('opens the editor for an account that may use the server', () => {
    expect(rootDestination(account('active'))).toBeNull()
  })

  test('welcomes visitors who are not signed in or not let in yet', () => {
    expect(rootDestination(null)).toBe('/welcome')
    expect(rootDestination(account('pending'))).toBe('/welcome')
    expect(rootDestination(account('revoked'))).toBe('/welcome')
  })

  test('opens the editor when the server cannot say, since the editor works without it', () => {
    expect(rootDestination('unreachable')).toBeNull()
  })
})
