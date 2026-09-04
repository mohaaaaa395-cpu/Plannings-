import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import ScheduleDisplay from '../components/ScheduleDisplay.jsx';
import Alerts from '../components/Alerts.jsx';
import { frLongDate } from '../lib/format.js';

const CHECK_LABELS = {
  contracts: 'Contrats',
  openings: 'Ouvertures',
  closings: 'Fermetures',
  order: 'Commande mardi',
  deliveries: 'Livraisons',
  availability: 'Disponibilités',
  rotation: 'Rotation',
  equity: 'Équité',
};

export default function ScheduleView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.schedule(id).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="loading">Chargement du planning…</div>;
  if (!data || !data.schedule) return <div className="card empty">Planning introuvable.</div>;

  const { schedule, analysis, employees, manual_changes } = data;
  const isDraft = schedule.status === 'draft';

  const statusBadge = {
    validated: <span className="badge badge--success">Validé</span>,
    draft: <span className="badge badge--warn">Brouillon</span>,
    archived: <span className="badge">Archivé</span>,
  }[schedule.status];

  const onShiftSaved = (fresh) => setData((prev) => ({ ...prev, ...fresh }));

  const validate = async () => {
    if (!confirm('Valider ce planning ? Il sera enregistré définitivement dans l\'historique et servira de mémoire pour les prochaines générations.')) return;
    setBusy(true);
    try {
      const fresh = await api.validate(id);
      setData((prev) => ({ ...prev, ...fresh }));
    } finally { setBusy(false); }
  };

  const duplicate = async () => {
    const copy = await api.duplicate(id);
    navigate(`/planning/${copy.id}`);
  };
  const archive = async () => {
    if (!confirm('Archiver ce planning ?')) return;
    await api.archive(id);
    load();
  };
  const remove = async () => {
    if (!confirm('Supprimer définitivement ce planning ?')) return;
    await api.deleteSchedule(id);
    navigate('/historique');
  };

  return (
    <div>
      <div className="section-title no-print">
        <div>
          <h1 style={{ marginBottom: 4 }}>{schedule.label || 'Planning'} {statusBadge}</h1>
          <div className="muted">
            du {frLongDate(schedule.start_date)} au {frLongDate(schedule.end_date)}
            {schedule.score != null && <> · score <strong>{schedule.score}/100</strong></>}
            {schedule.version > 1 && <> · version {schedule.version}</>}
          </div>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => window.print()}>🖨️ Imprimer</button>
          <a className="btn" href={api.exportUrl(id)}>📊 Export Excel</a>
          <button className="btn" onClick={duplicate}>📑 Dupliquer</button>
          {schedule.status !== 'archived' && <button className="btn" onClick={archive}>🗄️ Archiver</button>}
          <button className="btn btn--danger" onClick={remove}>🗑️ Supprimer</button>
        </div>
      </div>

      {/* Print-only header */}
      <div className="print-only" style={{ display: 'none' }}>
        <h1>CEDIF Saint-Antoine — Planning</h1>
      </div>

      {/* Validation summary */}
      <div className="card no-print">
        <div className="card__head">
          <h2 style={{ margin: 0 }}>Résumé de validation</h2>
          {isDraft && (
            <button className="btn btn--success" onClick={validate} disabled={busy}>
              ✓ Valider le planning
            </button>
          )}
        </div>
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          {Object.entries(analysis.checks).map(([k, v]) => (
            <span key={k} className={`badge ${v ? 'badge--success' : 'badge--danger'}`}>
              {v ? '✓' : '✗'} {CHECK_LABELS[k] || k}
            </span>
          ))}
        </div>
        <Alerts alerts={analysis.alerts} ok={analysis.ok} />
        {manual_changes?.length > 0 && (
          <div className="alert alert--info">
            ✍️ {manual_changes.length} modification(s) manuelle(s) enregistrée(s) sur ce planning.
          </div>
        )}
        {isDraft && (
          <p className="muted" style={{ fontSize: '.85rem' }}>
            Cliquez sur une case matin ou après-midi pour modifier une journée. Les modifications
            manuelles sont enregistrées et ne seront jamais écrasées silencieusement.
          </p>
        )}
      </div>

      <div className="card">
        <h2 className="no-print">Planning détaillé</h2>
        <ScheduleDisplay
          schedule={schedule}
          employees={employees}
          editable={schedule.status !== 'archived'}
          onShiftSaved={onShiftSaved}
        />
      </div>
    </div>
  );
}
