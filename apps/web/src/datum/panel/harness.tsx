/** Development harness for the DATUM result panel: renders the fixtures without a node. */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Evidence, Fix } from '../../../../server/src/datum/contract';
import { LangProvider, useLang } from '../../i18n';
import '../../styles.css';
import { FIX_ALPEN, FIX_ERROR, FIX_KOELN, FIX_KOELN_METADATA, FIX_KOELN_NACHT, FIX_LEER, FIX_PENDING, FIX_RUNNING } from './fixture';
import { CandidateList, ClockDial, CountryBars, EvidenceList, FixSummary, SkylineFrame, SunDial } from './index';

const FIXTURES: Record<string, { name: string; fix: Fix }> = {
  koeln: { name: 'Köln · Landmarke', fix: FIX_KOELN },
  alpen: { name: 'Alpen · Region', fix: FIX_ALPEN },
  meta: { name: 'Köln · Metadaten', fix: FIX_KOELN_METADATA },
  nacht: { name: 'Köln · Nacht', fix: FIX_KOELN_NACHT },
  leer: { name: 'Leer', fix: FIX_LEER },
};

function initialKey(): string {
  const key = new URLSearchParams(location.search).get('fix') ?? 'koeln';
  return key in FIXTURES ? key : 'koeln';
}

function Harness() {
  const { lang, setLang } = useLang();
  const [key, setKey] = useState(initialKey);
  const [selected, setSelected] = useState(0);
  const [picked, setPicked] = useState<Evidence | null>(null);
  const fix = (FIXTURES[key] ?? FIXTURES['koeln'])!.fix;
  const frame = fix.keyframes[0];
  return (
    <div className="hx">
      <header className="hx-bar">
        <span className="label">Datum · Panel-Harness</span>
        <nav className="hx-tabs">
          {Object.entries(FIXTURES).map(([k, v]) => (
            <button
              key={k}
              type="button"
              className={k === key ? 'segment hx-on' : 'segment'}
              aria-pressed={k === key}
              onClick={() => {
                setKey(k);
                setSelected(0);
                history.replaceState(null, '', `?fix=${k}`);
              }}
            >
              {v.name}
            </button>
          ))}
          <button type="button" className="segment" onClick={() => setLang(lang === 'de' ? 'en' : 'de')}>
            {lang === 'de' ? 'EN' : 'DE'}
          </button>
        </nav>
        <span className="hx-picked low">{picked ? `→ ${picked.label}` : ''}</span>
      </header>
      <main className="hx-grid">
        <div className="hx-col">
          {frame && (
            <SkylineFrame
              imageUrl={frame.imageUrl}
              skyline={frame.skyline}
              horizonProfile={fix.horizon?.profile ?? null}
              heading={fix.heading}
            />
          )}
          <FixSummary fix={fix} />
          <EvidenceList evidence={fix.evidence} onSelect={setPicked} />
        </div>
        <div className="hx-col">
          <ClockDial time={fix.time} sun={fix.sun} />
          {fix.sun && <SunDial sun={fix.sun} heading={fix.heading} time={fix.time} />}
        </div>
        <div className="hx-col">
          <CandidateList candidates={fix.candidates} selected={selected} onSelect={setSelected} />
          <CountryBars countries={fix.countries} />
        </div>
      </main>
      <section className="hx-states">
        <FixSummary fix={FIX_PENDING} />
        <FixSummary fix={FIX_RUNNING} />
        <FixSummary fix={FIX_ERROR} />
      </section>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root is missing in panel-harness.html');
createRoot(root).render(
  <StrictMode>
    <LangProvider>
      <Harness />
    </LangProvider>
  </StrictMode>,
);
