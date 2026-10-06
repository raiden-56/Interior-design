/**
 * Roles and permissions.
 *
 * One vocabulary shared by the middleware, the API routes and the UI, so a
 * capability can never be enforced in one place and forgotten in another.
 * Every gate in the app asks `can(...)` rather than testing a role name.
 */

export type Role = 'owner' | 'editor' | 'viewer';

export interface Permissions {
  /** Mutate the model: walls, furniture, materials, floors. */
  edit: boolean;
  /** PNG snapshot, JSON download, printing. */
  exportFiles: boolean;
  /** Create and revoke share links. */
  share: boolean;
  /** Delete projects. */
  remove: boolean;
  /** Use the AI assistant. */
  ai: boolean;
  /** Leave comments on the plan. */
  comment: boolean;
  /** Run the protected-view hardening (watermark, no copy, blur on blur). */
  protectedView: boolean;
  /**
   * Enter the first-person walkthrough. Walking around never changes the
   * model, so every role may; a client link can additionally switch it off
   * when it is minted (see `ShareSession.allowWalkthrough`).
   */
  walkthrough: boolean;
}

const MATRIX: Record<Role, Permissions> = {
  owner: { edit: true, exportFiles: true, share: true, remove: true, ai: true, comment: true, protectedView: false, walkthrough: true },
  editor: { edit: true, exportFiles: true, share: false, remove: false, ai: true, comment: true, protectedView: false, walkthrough: true },
  viewer: { edit: false, exportFiles: false, share: false, remove: false, ai: false, comment: false, protectedView: true, walkthrough: true },
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Architect',
  editor: 'Collaborator',
  viewer: 'Client (view only)',
};

export const ROLE_HINTS: Record<Role, string> = {
  owner: 'Full control: edit, share, export and delete.',
  editor: 'Can edit and export, but cannot share the project or delete it.',
  viewer: 'Read-only presentation. No editing, exporting, printing or downloading.',
};

export function permissionsFor(role: Role): Permissions {
  return MATRIX[role] ?? MATRIX.viewer;
}

export function can(role: Role | null | undefined, action: keyof Permissions): boolean {
  if (!role) return false;
  return permissionsFor(role)[action];
}

/**
 * Permission check for a concrete session, which can be narrower than its
 * role: a client link minted without the walkthrough keeps the viewer role
 * but loses that one capability.
 */
export function sessionAllows(session: Session | null | undefined, action: keyof Permissions): boolean {
  if (!session) return false;
  if (!can(session.role, action)) return false;
  if (action === 'walkthrough' && session.kind === 'share' && session.allowWalkthrough === false) return false;
  return true;
}

/** The signed-in account. One seeded account for now; the shape is multi-user ready. */
export interface AccountSession {
  kind: 'account';
  email: string;
  name: string;
  role: Role;
}

/** A visitor holding a share link. Scoped to exactly one project. */
export interface ShareSession {
  kind: 'share';
  projectId: string;
  role: Role;
  /** Shown in the watermark so a leaked screenshot points somewhere. */
  label: string;
  expiresAt: number | null;
  allowComments: boolean;
  watermark: boolean;
  /** Whether the recipient may enter the 3D walkthrough. Defaults to true. */
  allowWalkthrough?: boolean;
}

export type Session = AccountSession | ShareSession;

export interface SharePayload {
  /** project id */
  p: string;
  /** role */
  r: Role;
  /** label shown in the watermark */
  l: string;
  /** issued at (ms) */
  iat: number;
  /** expiry (ms), 0 = never */
  exp: number;
  /** sha-256 of the passcode, empty when the link is open */
  pc: string;
  /** allow comments */
  cm: boolean;
  /** watermark on */
  wm: boolean;
  /** walkthrough allowed (absent on older links = allowed) */
  wt?: boolean;
}

export interface AccountPayload {
  sub: string;
  name: string;
  r: Role;
  iat: number;
  exp: number;
}
