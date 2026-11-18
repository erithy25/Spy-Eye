/**
 * Development harness for SpaceView and TerrainView on synthetic data (see fixtures.ts).
 * Open /space-harness.html on the Vite dev server. Views by hash:
 *   #space            street scene with heading and sun
 *   #space-relative   same without heading (relative compass, no sun)
 *   #space-error      a grid URL that fails
 *   #terrain          terrain around the camera
 *   #terrain-none     no elevation model
 */

import { StrictMode, useEffect, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { LangProvider } from '../../i18n';
import '../../styles.css';
import { makeFixtures, type Fixtures } from './fixtures';
import { SpaceView } from './SpaceView';
import { TerrainView } from './TerrainView';

const VIEWS = [
  ['space', 'Raum'],
  ['space-relative', 'Raum ohne Richtung'],
  ['space-error', 'Raum Fehler'],
  ['terrain', 'Gelände'],
  ['terrain-none', 'Gelände fehlt'],
] as const;

type ViewId = (typeof VIEWS)[number][0];

function currentView(): ViewId {
  const h = location.hash.slice(1);
  return (VIEWS.find(([id]) => id === h)?.[0] ?? 'space') as ViewId;
}

const bar: CSSProperties = {
  height: 34,
  display: 'flex',
  alignItems: 'center',
  gap: 18,
  padding: '0 14px',
  borderBottom: '1px solid var(--line-2)',
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
};

function Harness() {
  const [view, setView] = useState<ViewId>(currentView);
  const [fx, setFx] = useState<Fixtures | null>(null);
  const [exits, setExits] = useState(0);

  useEffect(() => {
    const on = (): void => setView(currentView());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    let alive = true;
    const t0 = performance.now();
    void makeFixtures().then((f) => {
      if (!alive) return;
      console.info(`[harness] fixtures in ${Math.round(performance.now() - t0)} ms`, { sun: f.sun });
      setFx(f);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <nav style={bar}>
        <strong style={{ letterSpacing: '0.22em' }}>DATUM · 3D</strong>
        {VIEWS.map(([id, name]) => (
          <a key={id} href={`#${id}`} style={{ color: id === view ? 'var(--fg)' : 'var(--low)', textDecoration: id === view ? 'underline' : 'none', textUnderlineOffset: 4 }}>
            {name}
          </a>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--faint)' }}>Verlassen: {exits}</span>
      </nav>
      <main style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {!fx && <div style={{ padding: 20, color: 'var(--low)' }}>SYNTHETISCHE DATEN WERDEN ERZEUGT …</div>}
        {fx && view === 'space' && (
          <SpaceView
            key="space"
            gridUrl={fx.street.gridUrl}
            imageUrl={fx.street.imageUrl}
            label="Bild 0142 · 00:05,7 · synthetisch"
            headingDeg={fx.street.headingDeg}
            fovDeg={fx.street.fovDeg}
            pitchDeg={fx.street.pitchDeg}
            sun={fx.sun}
            onExit={() => setExits((n) => n + 1)}
          />
        )}
        {fx && view === 'space-relative' && (
          <SpaceView key="space-relative" gridUrl={fx.street.gridUrl} imageUrl={fx.street.imageUrl} pitchDeg={fx.street.pitchDeg} label="ohne Blickrichtung" />
        )}
        {fx && view === 'space-error' && (
          <SpaceView key="space-error" gridUrl="/does-not-exist.dsg" imageUrl={fx.street.imageUrl} label="Fehlerfall" onExit={() => setExits((n) => n + 1)} />
        )}
        {fx && view === 'terrain' && (
          <TerrainView
            terrain={fx.terrain}
            camera={fx.camera}
            sun={fx.sun}
            sunPath={fx.sunPath}
            horizonProfile={fx.horizonProfile}
            skyline={fx.skyline}
            label="Synthetisches Gelände"
          />
        )}
        {fx && view === 'terrain-none' && <TerrainView terrain={null} camera={fx.camera} sun={fx.sun} label="ohne Höhenmodell" />}
      </main>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <LangProvider>
        <Harness />
      </LangProvider>
    </StrictMode>,
  );
}
