import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { frLongDate, frMonthYear, nextMondayISO } from '../lib/format.js';

export default function Generate() {
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState(nextMondayISO());
  const [label, setLabel] = useState('');
  const [overtime, setOvertime] = useState('0');
  const [weeks, setWeeks] = useState(3);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!startDate) return;
    api.previewDates(startDate, weeks).then(setPreview).catch(() => setPreview(null));
  }, [startDate, weeks]);

  const generate = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const ot = parseFloat(String(overtime).replace(',', '.')) || 0;
      const r = await api.generate(startDate, label || undefined, ot, weeks);
      setResult(r);
      if (r.feasible && r.schedule) {
        // Give a beat to show success, then open the schedule
        setTimeout(() => navigate(`/planning/${r.schedule.id}`), 900);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Générer un planning</h1>
      <p className="muted">
        Sélectionnez une date de début et le nombre de semaines. L'application calcule les dates,
        récupère les contrats, disponibilités, absences et l'historique, puis génère plusieurs
        plannings candidats pour retenir le meilleur.
      </p>

      <div className="card">
        <div className="form-row">
          <div className="field">
            <label>Date de début</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Durée</label>
            <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
              {[1, 2, 3].map((n) => (
                <button key={n} type="button"
                  className={`btn btn--sm ${weeks === n ? 'btn--primary' : ''}`}
                  style={{ flex: 1 }}
                  onClick={() => setWeeks(n)}>
                  {n} sem.
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Nom du planning (optionnel)</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. Rentrée septembre" />
          </div>
          <div className="field">
            <label>Heures supp. (+h / semaine)</label>
            <input type="text" inputMode="decimal" value={overtime}
              onChange={(e) => setOvertime(e.target.value)} placeholder="0" />
            <div className="hint" style={{ fontSize: '.75rem' }}>
              Ajouté à chaque salarié pour ce planning uniquement (les contrats ne changent pas).
            </div>
          </div>
        </div>

        {preview && (
          <div className="card" style={{ background: 'var(--surface-2)', marginTop: 8 }}>
            <h3 style={{ marginTop: 0 }}>
              Planning du {frLongDate(preview.start_date)} au {frLongDate(preview.end_date)}
            </h3>
            <div className="muted" style={{ marginBottom: 10 }}>{frMonthYear(preview.start_date)}</div>
            <div className="grid cols-3">
              {preview.weeks.map((w) => (
                <div key={w.week_index} className="stat-tile">
                  <div className="label">Semaine {w.week_index}</div>
                  <div style={{ fontWeight: 700, marginTop: 4 }}>
                    {frLongDate(w.start_date)}
                  </div>
                  <div className="muted">→ {frLongDate(w.end_date)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn btn--primary" onClick={generate} disabled={busy}>
            {busy ? '⏳ Génération en cours…' : '⚙️ Générer le planning'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {result && !result.feasible && (
        <div className="card" style={{ borderLeft: '4px solid var(--danger)' }}>
          <h2 style={{ color: 'var(--danger)' }}>⛔ Impossible de respecter toutes les contraintes</h2>
          <p className="muted">
            Le moteur n'invente pas de solution. Voici précisément ce qui bloque :
          </p>
          {result.reasons?.map((r, i) => (
            <div key={i} className="alert alert--error">{r}</div>
          ))}
          {result.soft_reasons?.length > 0 && (
            <>
              <h3>À surveiller</h3>
              {result.soft_reasons.map((r, i) => (
                <div key={i} className="alert alert--warn">{r}</div>
              ))}
            </>
          )}
        </div>
      )}

      {result && result.feasible && (
        <div className="card" style={{ borderLeft: '4px solid var(--success)' }}>
          <h2 style={{ color: 'var(--success)' }}>✓ Planning généré — score {result.score}/100</h2>
          <p className="muted">
            {result.candidatesTried} plannings candidats évalués. Ouverture du planning…
          </p>
          {result.manual_warnings?.length > 0 &&
            result.manual_warnings.map((w, i) => (
              <div key={i} className="alert alert--warn">{w}</div>
            ))}
        </div>
      )}
    </div>
  );
}
