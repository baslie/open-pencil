export type SharePermission = 'edit' | 'view'

export type ShareMember = {
  id: string
  name: string
  email: string
  permission: SharePermission | 'owner'
  /** An invitation not accepted yet, with when it expires. */
  pendingUntil?: string
  you?: boolean
}

export type ShareLinkState =
  | { access: 'restricted' }
  | { access: 'link'; permission: SharePermission; copyable: boolean }

/**
 * Whether the workspace allows links at all, and whether people who are not signed in to the
 * server may follow view and edit links; people signed in may follow any link.
 */
export type ShareLinkPolicy = { allowed: boolean; guestView: boolean; guestEdit: boolean }
