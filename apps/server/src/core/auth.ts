import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { PUBLISHED_DEMO_PASSWORD } from '../config.js';
import { Collection } from './json.js';
import type { Role, UserInfo } from '../types.js';

interface UserRecord {
  id: string;
  name: string;
  role: Role;
  /** Organisational unit shown next to the name. */
  unit: string;
  salt: string;
  hash: string;
  /** Seeded demonstration account. */
  demo: boolean;
}

export interface Session {
  token: string;
  userId: string;
  mandateId: string | null;
  createdAt: number;
  lastSeen: number;
}

/** What each role may do. Separation of duties: the auditor reads records but never sees imagery. */
export const PERMISSIONS = {
  operator: [
    'search', 'media', 'watch.read', 'watch.write', 'alert.triage', 'case.read', 'case.write',
    'source.read', 'source.write', 'mandate.read', 'metrics.read', 'scenario.read', 'scenario.control',
    'federation.read',
  ],
  supervisor: [
    'search', 'media', 'watch.read', 'watch.write', 'alert.triage', 'case.read', 'case.write', 'case.seal',
    'source.read', 'source.write', 'mandate.read', 'mandate.write', 'metrics.read', 'scenario.read',
    'scenario.control', 'federation.read', 'federation.write', 'privacy.unmask', 'ledger.read', 'source.live',
    // DATUM engine settings: street-level comparison on or off, the Mapillary key.
    'datum.settings',
  ],
  auditor: ['ledger.read', 'ledger.verify', 'mandate.read', 'metrics.read', 'case.read', 'watch.read', 'federation.read'],
} as const satisfies Record<Role, readonly string[]>;

export type Permission = (typeof PERMISSIONS)[Role][number];

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[role] as readonly string[]).includes(permission);
}

/** A session ends after this long without a request … */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** … and at the latest this long after sign-in, however busy it was. */
const SESSION_MAX_MS = 24 * 60 * 60 * 1000;

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex');
}

export class Auth {
  private readonly users: Collection<UserRecord>;
  private readonly sessions = new Map<string, Session>();
  /** True while only the seeded demonstration accounts exist. */
  demoMode = false;
  private demoPasswordHint = '';

  constructor(file: string) {
    this.users = new Collection<UserRecord>(file);
  }

  /** Loads users; seeds demonstration accounts on first start. */
  async open(demoPassword: string): Promise<void> {
    await this.users.load();
    if (this.users.size === 0) {
      const seed: [string, string, Role, string][] = [
        ['leitung', 'Einsatzleitung', 'supervisor', 'Stab · S2 Lage'],
        ['lage', 'Lagedienst', 'operator', 'Stab · S2 Lage'],
        ['aufsicht', 'Aufsicht', 'auditor', 'Behördliche Datenschutzaufsicht'],
      ];
      for (const [id, name, role, unit] of seed) {
        const salt = randomBytes(16).toString('hex');
        this.users.put({ id, name, role, unit, salt, hash: hashPassword(demoPassword, salt), demo: true });
      }
      await this.users.flush();
    }
    this.demoMode = this.users.all().every((u) => u.demo);
    // The sign-in page shows the password of a demonstration to whoever opens it. That is only
    // right for the published one; a password the operator chose is never handed out.
    this.demoPasswordHint = this.demoMode && demoPassword === PUBLISHED_DEMO_PASSWORD ? demoPassword : '';
  }

  info(user: UserRecord): UserInfo {
    return { id: user.id, name: user.name, role: user.role, unit: user.unit };
  }

  listUsers(): UserInfo[] {
    return this.users.all().map((u) => this.info(u));
  }

  /** Password hint for the login screen; only while the node runs on demonstration accounts. */
  get demoHint(): string {
    return this.demoPasswordHint;
  }

  getUser(id: string): UserInfo | null {
    const user = this.users.get(id);
    return user ? this.info(user) : null;
  }

  /** Checks credentials without creating a session (used for four-eyes approvals). */
  verify(userId: string, password: string): UserInfo | null {
    const user = this.users.get(userId.trim().toLowerCase());
    if (!user) {
      // Spend comparable time for unknown users.
      hashPassword(password, 'unknown-user-salt');
      return null;
    }
    const expected = Buffer.from(user.hash, 'hex');
    const actual = Buffer.from(hashPassword(password, user.salt), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    return this.info(user);
  }

  login(userId: string, password: string): { session: Session; user: UserInfo } | null {
    const user = this.verify(userId, password);
    if (!user) return null;
    const now = Date.now();
    // Sessions nobody came back to are cleared out whenever someone signs in.
    for (const [token, old] of this.sessions) {
      if (now - old.lastSeen > SESSION_TTL_MS || now - old.createdAt > SESSION_MAX_MS) this.sessions.delete(token);
    }
    const session: Session = {
      token: randomBytes(24).toString('hex'),
      userId: user.id,
      mandateId: null,
      createdAt: now,
      lastSeen: now,
    };
    this.sessions.set(session.token, session);
    return { session, user };
  }

  resolve(token: string | undefined): { session: Session; user: UserInfo } | null {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    const now = Date.now();
    if (now - session.lastSeen > SESSION_TTL_MS || now - session.createdAt > SESSION_MAX_MS) {
      this.sessions.delete(token);
      return null;
    }
    session.lastSeen = now;
    const user = this.getUser(session.userId);
    return user ? { session, user } : null;
  }

  logout(token: string): void {
    this.sessions.delete(token);
  }
}
