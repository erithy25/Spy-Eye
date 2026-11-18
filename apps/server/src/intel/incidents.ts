import { haversineKm, toMgrs } from '../core/geo.js';
import { Collection, newId, readJson } from '../core/json.js';
import type { EventHub } from '../events.js';
import type { Alert, Incident, Severity } from '../types.js';

/** A named place used to describe where something is ("bei Güls"). */
export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** Lower is more important (city 1 … hamlet 6). */
  rank: number;
}

/** Alerts closer than this, in space and time, are treated as reports of the same situation. */
const MERGE_RADIUS_KM = 1.2;
const MERGE_WINDOW_MS = 20 * 60 * 1000;

/**
 * Groups alerts into incidents. Two sources that report something at the same place at the same
 * time are one incident with a corroboration count of two, not two separate problems.
 */
export class Incidents {
  private readonly items: Collection<Incident>;
  private places: Place[] = [];

  constructor(
    file: string,
    private readonly placesFile: string,
    private readonly hub: EventHub,
  ) {
    this.items = new Collection<Incident>(file);
  }

  async open(): Promise<void> {
    await this.items.load();
    this.places = await readJson<Place[]>(this.placesFile, []);
  }

  list(): Incident[] {
    return this.items.all().sort((a, b) => b.lastSeen - a.lastSeen);
  }

  get(id: string): Incident | undefined {
    return this.items.get(id);
  }

  /** Nearest named place; a larger place wins if it is not much farther away. */
  nearestPlace(lat: number, lon: number): { name: string; distanceKm: number } | null {
    let best: { name: string; distanceKm: number; cost: number } | null = null;
    for (const place of this.places) {
      if (Math.abs(place.lat - lat) > 0.12 || Math.abs(place.lon - lon) > 0.18) continue;
      const distanceKm = haversineKm(lat, lon, place.lat, place.lon);
      const cost = distanceKm + place.rank * 0.25;
      if (!best || cost < best.cost) best = { name: place.name, distanceKm, cost };
    }
    return best ? { name: best.name, distanceKm: best.distanceKm } : null;
  }

  /** Adds an alert to a matching open incident or opens a new one. Returns the incident. */
  attach(alert: Alert): Incident | null {
    if (alert.lat === null || alert.lon === null) return null;
    const { lat, lon } = alert;
    let incident: Incident | undefined;
    for (const candidate of this.items.all()) {
      if (candidate.status === 'closed' || candidate.exercise !== alert.exercise) continue;
      if (alert.firstSeen - candidate.lastSeen > MERGE_WINDOW_MS) continue;
      if (haversineKm(lat, lon, candidate.lat, candidate.lon) > MERGE_RADIUS_KM) continue;
      incident = candidate;
      break;
    }

    if (!incident) {
      const place = this.nearestPlace(lat, lon);
      const where = place ? place.name : '';
      incident = {
        id: newId('in'),
        title: where ? `${alert.watchName} · ${where}` : alert.watchName,
        titleEn: where ? `${alert.watchNameEn} · ${where}` : alert.watchNameEn,
        place: where,
        mgrs: toMgrs(lat, lon),
        severity: alert.severity,
        status: 'open',
        lat,
        lon,
        alertIds: [],
        sourceIds: [],
        watchNames: [],
        firstSeen: alert.firstSeen,
        lastSeen: alert.lastSeen,
        corroboration: 0,
        exercise: alert.exercise,
      };
      this.items.put(incident);
    }

    if (!incident.alertIds.includes(alert.id)) incident.alertIds.push(alert.id);
    if (!incident.sourceIds.includes(alert.sourceId)) incident.sourceIds.push(alert.sourceId);
    if (!incident.watchNames.includes(alert.watchName)) incident.watchNames.push(alert.watchName);
    incident.corroboration = incident.sourceIds.length;
    incident.severity = Math.max(incident.severity, alert.severity) as Severity;
    incident.lastSeen = Math.max(incident.lastSeen, alert.lastSeen);
    this.items.touch();
    this.hub.broadcast({ type: 'incident', incident });
    return incident;
  }

  /** Keeps the incident's time span current while its alerts are still being observed. */
  touch(incidentId: string | null, lastSeen: number): void {
    if (!incidentId) return;
    const incident = this.items.get(incidentId);
    if (!incident || lastSeen <= incident.lastSeen) return;
    incident.lastSeen = lastSeen;
    this.items.touch();
  }

  setStatus(id: string, status: Incident['status']): Incident | null {
    const incident = this.items.get(id);
    if (!incident) return null;
    incident.status = status;
    this.items.touch();
    this.hub.broadcast({ type: 'incident', incident });
    return incident;
  }

  /** Discards the incidents of an exercise run. */
  clearExercise(): void {
    for (const incident of this.items.all()) if (incident.exercise) this.items.delete(incident.id);
  }

  flush(): Promise<void> {
    return this.items.flush();
  }
}
