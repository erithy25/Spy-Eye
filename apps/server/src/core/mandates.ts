import { Collection, newId } from './json.js';
import type { Mandate } from '../types.js';

/**
 * A mandate is the legal purpose under which the system is used: an operation, an exercise,
 * an order. Nothing can be searched or watched without one, and every ledger entry names it.
 */
export class Mandates {
  private readonly items: Collection<Mandate>;

  constructor(file: string) {
    this.items = new Collection<Mandate>(file);
  }

  async open(): Promise<void> {
    await this.items.load();
  }

  list(): Mandate[] {
    return this.items.all().sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): Mandate | undefined {
    return this.items.get(id);
  }

  /**
   * Adds the English texts of a mandate the node seeded itself, when it was stored before they
   * existed. Only missing fields are filled and only when the German text is the seeded one, so a
   * mandate an operator changed by hand keeps exactly what it says.
   */
  addEnglish(id: string, seeded: { legalBasis: string; legalBasisEn: string; purpose: string; purposeEn: string; title?: string; titleEn?: string }): void {
    const mandate = this.items.get(id);
    if (!mandate) return;
    let changed = false;
    if (mandate.legalBasisEn === undefined && mandate.legalBasis === seeded.legalBasis) {
      mandate.legalBasisEn = seeded.legalBasisEn;
      changed = true;
    }
    if (mandate.purposeEn === undefined && mandate.purpose === seeded.purpose) {
      mandate.purposeEn = seeded.purposeEn;
      changed = true;
    }
    if (mandate.titleEn === undefined && seeded.titleEn !== undefined && mandate.title === seeded.title) {
      mandate.titleEn = seeded.titleEn;
      changed = true;
    }
    if (changed) this.items.touch();
  }

  /** A mandate can be used while it is open and inside its validity window. */
  isUsable(mandate: Mandate, now = Date.now()): boolean {
    return mandate.status === 'open' && now >= mandate.validFrom && (mandate.validTo === null || now <= mandate.validTo);
  }

  create(input: Omit<Mandate, 'id' | 'createdAt' | 'status' | 'closedAt'>, id?: string): Mandate {
    const mandate: Mandate = { ...input, id: id ?? newId('md'), createdAt: Date.now(), status: 'open', closedAt: null };
    return this.items.put(mandate);
  }

  close(id: string): Mandate | null {
    const mandate = this.items.get(id);
    if (!mandate) return null;
    mandate.status = 'closed';
    mandate.closedAt = Date.now();
    this.items.touch();
    return mandate;
  }

  flush(): Promise<void> {
    return this.items.flush();
  }
}
