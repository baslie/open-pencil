import { useLocalStorage } from '@vueuse/core'

import {
  CloudPortalAPIError,
  createCloudPortalClient,
  type CloudPortalClient
} from '@open-pencil/cloud/client'
import type { CloudAccountStatus } from '@open-pencil/cloud/contract'

/**
 * A Cloud server serves the editor at its root to signed-in people and to visitors who chose to
 * use it without an account; everyone else gets the welcome page first.
 */
export const WELCOME_PATH = '/welcome'

/** Whether this browser chose to use the server's editor without an account. */
const localEditor = useLocalStorage('open-pencil:cloud-site-local', false, {
  // Written before the page leaves for the editor.
  flush: 'sync',
  writeDefaults: false
})

export function choseLocalEditor(): boolean {
  return localEditor.value
}

/** Opens the server's editor without an account, now and on later visits from this browser. */
export function openLocalEditor(): void {
  localEditor.value = true
  globalThis.location.assign('/')
}

/**
 * Where a visitor to the server's root belongs, from who is signed in: the editor, or the welcome
 * page, which sends an account waiting for review on to its standing page. An unreachable server
 * opens the editor, which works without it.
 */
export function rootDestination(account: CloudAccountStatus | null | 'unreachable'): string | null {
  if (account === 'unreachable' || account?.state === 'active') return null
  return WELCOME_PATH
}

async function signedInAccount(
  api: CloudPortalClient
): Promise<CloudAccountStatus | null | 'unreachable'> {
  try {
    return await api.accountStatus()
  } catch (error) {
    if (error instanceof CloudPortalAPIError && error.kind === 'authentication-required')
      return null
    console.warn('[Cloud] Could not read who is signed in', error)
    return 'unreachable'
  }
}

/**
 * Before the editor boots on a Cloud server: leaves the root for the welcome page when nobody who
 * may use the server is signed in and this browser never chose to go without an account. Returns
 * whether the editor should boot. Links to documents and shared files always open the editor.
 */
export async function enterCloudSite(location: Location = globalThis.location): Promise<boolean> {
  if (location.pathname !== '/' || choseLocalEditor()) return true
  const api = createCloudPortalClient({ baseURL: location.origin })
  const destination = rootDestination(await signedInAccount(api))
  if (!destination) return true
  location.replace(destination)
  return false
}
