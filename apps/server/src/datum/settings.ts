/**
 * DATUM settings of one node that an operator can change from the console (GET/PUT
 * /api/datum/settings): whether the full stage compares frames with public street-level pictures,
 * and the Mapillary key that adds Mapillary to Panoramax.
 *
 * Files, per node (like `<dataDir>/datum/truth.json`):
 *   <dataDir>/datum/settings.json    { "version": 1, "streetLevel": { "enabled": true } }
 *   <dataDir>/datum/mapillary-key    the key alone, file mode 0600 where the OS has modes
 *
 * The street-level comparison is on by default: the owner allowed free external services for
 * finding the place. DATUM_STREETLEVEL=0 in the environment switches it off whatever the file
 * says (an installation that must not contact anyone can be sure of that from its start script),
 * and so does offline mode (SICHT_OFFLINE). Switched off, it is off everywhere: the engine does
 * not ask the services and the thumbnail route does not fetch pictures of earlier fixes.
 * MAPILLARY_TOKEN in the environment wins over a stored key and cannot be changed from the
 * console; it is how installations that keep secrets out of the data directory provide it.
 *
 * The key never leaves this module except through `mapillaryKey()` (for the Authorization header
 * of the Mapillary search): the view says only whether there is one and where it comes from.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { renameRetry, writeFileAtomic } from '../core/json.js';
import type { DatumSettings } from './contract.js';
import { GEOCLIP_FILES, defaultGeoclipDir, type GeoclipPrecision } from './geoclip.js';

export type MapillaryKeySource = DatumSettings['streetLevel']['mapillaryKeySource'];

/** Environment the settings read; a function, so that a change (tests, a restart script) is seen. */
export type EnvReader = () => Readonly<Record<string, string | undefined>>;

const SETTINGS_FILE = 'settings.json';
const KEY_FILE = 'mapillary-key';

/** Shortest and longest key accepted from the console. */
export const MAPILLARY_KEY_MIN = 20;
export const MAPILLARY_KEY_MAX = 300;

interface SettingsFile {
  version: 1;
  streetLevel: { enabled: boolean };
}

/** Values of DATUM_STREETLEVEL that switch the comparison off. */
const OFF_VALUES = new Set(['0', 'false', 'off', 'no', 'nein', 'aus']);

/**
 * A key as an operator pastes it: Mapillary client tokens have the documented form
 * "MLY|<client id>|<secret>" (developer dashboard, "Client Token"). The key goes into an HTTP
 * header, so only printable ASCII without spaces is allowed; surrounding white space (a line feed
 * copied along) is trimmed. Returns the cleaned key, or null when it cannot be one.
 */
export function plausibleMapillaryKey(raw: string): string | null {
  const key = raw.trim();
  if (key.length < MAPILLARY_KEY_MIN || key.length > MAPILLARY_KEY_MAX) return null;
  if (!/^[\x21-\x7e]+$/.test(key)) return null;
  return /^MLY\|[^|]+\|[^|]+$/.test(key) ? key : null;
}

/**
 * MAPILLARY_TOKEN from the environment. Checked as loosely as before this module existed (printable,
 * 8 to 512 characters), so that an installation whose token worked keeps working.
 */
export function envMapillaryToken(env: Readonly<Record<string, string | undefined>>): { set: boolean; key: string | null } {
  const raw = env['MAPILLARY_TOKEN'];
  if (raw === undefined || raw.trim() === '') return { set: false, key: null };
  const t = raw.trim();
  return { set: true, key: t.length >= 8 && t.length <= 512 && /^[\x21-\x7e]+$/.test(t) ? t : null };
}

// ------------------------------------------------------------------ world model

/** What the engine reported about GeoCLIP, if it did; otherwise the files on disk decide. */
let reportedWorldModel: DatumSettings['worldModel'] | null = null;

/**
 * Lets the engine state what it actually runs (the world model is loaded once per process, for
 * every node). Without a report the view looks at the model files.
 */
export function reportWorldModel(state: DatumSettings['worldModel'] | null): void {
  reportedWorldModel = state;
}

function geoclipFilesPresent(precision: GeoclipPrecision, dir: string): boolean {
  const files = [GEOCLIP_FILES.vision[precision], GEOCLIP_FILES.location, GEOCLIP_FILES.gallery];
  return files.every((f) => fs.existsSync(path.join(dir, f)));
}

/**
 * GeoCLIP state from the disk: DATUM_GEOCLIP_PRECISION picks the precision when set; otherwise
 * int8 when its weights are there (a quarter of the size, the default download), else fp32.
 */
export function worldModelState(env: Readonly<Record<string, string | undefined>> = process.env, dir: string = defaultGeoclipDir()): DatumSettings['worldModel'] {
  if (reportedWorldModel) return { ...reportedWorldModel };
  const wanted = env['DATUM_GEOCLIP_PRECISION'];
  if (wanted === 'fp32' || wanted === 'int8') return { available: geoclipFilesPresent(wanted, dir), precision: wanted };
  if (geoclipFilesPresent('int8', dir)) return { available: true, precision: 'int8' };
  return { available: geoclipFilesPresent('fp32', dir), precision: 'fp32' };
}

// ------------------------------------------------------------------ the store

export type SettingsListener = (view: DatumSettings) => void;

/** Why a key was not taken. */
export type KeyRefusal = 'env' | 'implausible';

export interface DatumSettingsOptions {
  env?: EnvReader;
  /** Directory of the GeoCLIP weights (tests). */
  geoclipDir?: string;
  /** Whether the node runs in offline mode (default: SICHT_OFFLINE, config.offline; tests swap it). */
  offline?: () => boolean;
}

/**
 * The settings of one node, read from its data directory on first use and written on change.
 * Reads are synchronous (two tiny files, once) so that the engine can ask at any point without
 * awaiting; writes are atomic and chained.
 */
export class DatumSettingsStore {
  readonly dir: string;
  private loaded = false;
  private enabled = true;
  private storedKey: string | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<SettingsListener>();
  private readonly env: EnvReader;

  constructor(
    readonly dataDir: string,
    private readonly options: DatumSettingsOptions = {},
  ) {
    this.dir = path.join(dataDir, 'datum');
    this.env = options.env ?? ((): NodeJS.ProcessEnv => process.env);
  }

  get settingsFile(): string {
    return path.join(this.dir, SETTINGS_FILE);
  }

  get keyFile(): string {
    return path.join(this.dir, KEY_FILE);
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')) as Partial<SettingsFile> | null;
      const enabled = parsed?.streetLevel?.enabled;
      // Anything but an explicit false keeps the default: a damaged file must not silently
      // change what the node does.
      this.enabled = enabled !== false;
    } catch {
      this.enabled = true;
    }
    try {
      // A key edited by hand that is not plausible is not used (and not reported as stored).
      this.storedKey = plausibleMapillaryKey(fs.readFileSync(this.keyFile, 'utf8'));
    } catch {
      this.storedKey = null;
    }
  }

  /** Forgets what was read, so the next question reads the files again (tests, external edits). */
  reload(): void {
    this.loaded = false;
  }

  /** True when the node runs in offline mode (SICHT_OFFLINE): it must not contact anyone. */
  offline(): boolean {
    return this.options.offline ? this.options.offline() : config.offline;
  }

  /**
   * True when the environment switches the comparison off: DATUM_STREETLEVEL=0, or offline mode,
   * which forbids every network access and so this one too. The console then shows it as off,
   * whatever the stored choice says.
   */
  forcedOff(): boolean {
    if (this.offline()) return true;
    const v = this.env()['DATUM_STREETLEVEL'];
    return v !== undefined && OFF_VALUES.has(v.trim().toLowerCase());
  }

  /** Whether the full stage may ask street-level services now. */
  streetLevelEnabled(): boolean {
    this.load();
    return this.enabled && !this.forcedOff();
  }

  /** The key for Mapillary requests: from the environment, else the stored one, else null. */
  mapillaryKey(): string | null {
    const fromEnv = envMapillaryToken(this.env());
    if (fromEnv.set) return fromEnv.key;
    this.load();
    return this.storedKey;
  }

  mapillaryKeySource(): MapillaryKeySource {
    if (envMapillaryToken(this.env()).set) return 'env';
    this.load();
    return this.storedKey ? 'stored' : 'none';
  }

  /**
   * True when MAPILLARY_TOKEN is set but malformed, so the street-level stage can say why it did
   * not ask Mapillary.
   */
  envKeyMalformed(): boolean {
    const fromEnv = envMapillaryToken(this.env());
    return fromEnv.set && fromEnv.key === null;
  }

  view(): DatumSettings {
    this.load();
    const key = this.mapillaryKey();
    return {
      streetLevel: {
        enabled: this.enabled,
        forcedOff: this.forcedOff(),
        offline: this.offline(),
        providers: key ? ['panoramax', 'mapillary'] : ['panoramax'],
        mapillaryKey: key !== null,
        mapillaryKeySource: this.mapillaryKeySource(),
      },
      worldModel: worldModelState(this.env(), this.options.geoclipDir),
    };
  }

  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): DatumSettings {
    const view = this.view();
    for (const l of this.listeners) {
      try {
        l(view);
      } catch {
        // A listener's fault must not undo a saved setting.
      }
    }
    for (const l of globalListeners) {
      try {
        l(this.dataDir, view);
      } catch {
        // as above
      }
    }
    return view;
  }

  /** Writes are chained, so two quick requests cannot leave the older state on disk. */
  private chain(write: () => Promise<void>): Promise<void> {
    const run = this.writing.then(write);
    this.writing = run.catch(() => undefined);
    return run;
  }

  async setStreetLevel(enabled: boolean): Promise<DatumSettings> {
    this.load();
    const data: SettingsFile = { version: 1, streetLevel: { enabled } };
    await this.chain(() => writeFileAtomic(this.settingsFile, `${JSON.stringify(data, null, 2)}\n`));
    this.enabled = enabled;
    return this.changed();
  }

  /**
   * Stores a key (or removes the stored one with an empty string). Refused while the environment
   * provides the key, and for anything that cannot be a Mapillary client token.
   */
  async setMapillaryKey(raw: string): Promise<{ view: DatumSettings; removed: boolean } | { refused: KeyRefusal }> {
    this.load();
    if (envMapillaryToken(this.env()).set) return { refused: 'env' };
    if (raw.trim() === '') {
      await this.chain(() => fsp.rm(this.keyFile, { force: true }));
      this.storedKey = null;
      return { view: this.changed(), removed: true };
    }
    const key = plausibleMapillaryKey(raw);
    if (!key) return { refused: 'implausible' };
    await this.chain(() => writeSecretFile(this.keyFile, `${key}\n`));
    this.storedKey = key;
    return { view: this.changed(), removed: false };
  }
}

/**
 * Writes a file only its owner can read (0600; Windows ignores modes and relies on the ACL of the
 * data directory). The temporary file is created with the mode already set, so the key is never
 * readable by others, not even for a moment.
 */
async function writeSecretFile(file: string, data: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    await fsp.writeFile(tmp, data, { mode: 0o600 });
    await renameRetry(tmp, file);
  } catch (err: unknown) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  if (process.platform !== 'win32') {
    // A file that existed before keeps its old mode across the rename on some file systems.
    await fsp.chmod(file, 0o600).catch(() => undefined);
  }
}

// ------------------------------------------------------------------ per node, for the engine

const stores = new Map<string, DatumSettingsStore>();
const globalListeners = new Set<(dataDir: string, view: DatumSettings) => void>();

/** The settings of the node with this data directory (one store per directory and process). */
export function datumSettings(dataDir: string = config.dataDir): DatumSettingsStore {
  const key = path.resolve(dataDir);
  let store = stores.get(key);
  if (!store) {
    store = new DatumSettingsStore(key);
    stores.set(key, store);
  }
  return store;
}

/** Whether the full stage may compare with street-level pictures (engine: pass `store.dataDir`). */
export function streetLevelEnabled(dataDir: string = config.dataDir): boolean {
  return datumSettings(dataDir).streetLevelEnabled();
}

/** The Mapillary key to use, or null (MAPILLARY_TOKEN first, then the stored key). */
export function mapillaryKey(dataDir: string = config.dataDir): string | null {
  return datumSettings(dataDir).mapillaryKey();
}

/** The settings as the console sees them (never the key). */
export function settingsView(dataDir: string = config.dataDir): DatumSettings {
  return datumSettings(dataDir).view();
}

/** Called after every change of any node's settings, with that node's data directory. */
export function onSettingsChange(listener: (dataDir: string, view: DatumSettings) => void): () => void {
  globalListeners.add(listener);
  return () => globalListeners.delete(listener);
}
