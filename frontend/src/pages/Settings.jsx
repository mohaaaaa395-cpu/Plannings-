import { useEffect, useState } from 'react';
import { api } from '../api.js';

const WEEKDAYS = [
  { v: 1, l: 'Lun' }, { v: 2, l: 'Mar' }, { v: 3, l: 'Mer' }, { v: 4, l: 'Jeu' },
  { v: 5, l: 'Ven' }, { v: 6, l: 'Sam' }, { v: 7, l: 'Dim' },
];
const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function getPath(cfg, path) { return path.reduce((o, k) => (o == null ? o : o[k]), cfg); }

// Helpers defined at module scope so they keep a stable identity across
// renders (otherwise inputs would lose focus after each keystroke).
function Num({ cfg, upd, path, label, step = 1, hint }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="number" step={step} value={getPath(cfg, path)}
        onChange={(e) => upd(path, Number(e.target.value))} />
      {hint && <div className="muted" style={{ fontSize: '.75rem' }}>{hint}</div>}
    </div>
  );
}
function Txt({ cfg, upd, path, label, placeholder }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input value={getPath(cfg, path)} placeholder={placeholder}
        onChange={(e) => upd(path, e.target.value)} />
    </div>
  );
}
function Chk({ cfg, upd, path, label }) {
  return (
    <div className="checkbox field">
      <input type="checkbox" checked={!!getPath(cfg, path)} onChange={(e) => upd(path, e.target.checked)} />
      <label>{label}</label>
    </div>
  );
}
function DaysPicker({ cfg, toggleDay, path }) {
  const arr = getPath(cfg, path) || [];
  return (
    <div className="row" style={{ gap: 6 }}>
      {WEEKDAYS.map((w) => (
        <button key={w.v} type="button" className={`btn btn--sm ${arr.includes(w.v) ? 'btn--primary' : ''}`}
          onClick={() => toggleDay(path, w.v)}>{w.l}</button>
      ))}
    </div>
  );
}

export default function Settings() {
  const [cfg, setCfg] = useState(null);
  const [saved, setSaved] = useState('');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwMsg, setPwMsg] = useState('');

  useEffect(() => { api.settings().then((d) => setCfg(clone(d.config))); }, []);
  if (!cfg) return <div className="loading">Chargement…</div>;

  const upd = (path, value) => {
    setCfg((prev) => {
      const next = clone(prev);
      let o = next;
      for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
      o[path[path.length - 1]] = value;
      return next;
    });
  };
  const toggleDay = (path, day) => {
    const arr = getPath(cfg, path) || [];
    const set = new Set(arr);
    set.has(day) ? set.delete(day) : set.add(day);
    upd(path, [...set].sort((a, b) => a - b));
  };

  const save = async () => {
    const d = await api.saveSettings(cfg);
    setCfg(clone(d.config));
    setSaved('Paramètres enregistrés ✓');
    setTimeout(() => setSaved(''), 2500);
  };
  const reset = async () => {
    if (!confirm('Réinitialiser tous les paramètres aux valeurs par défaut ?')) return;
    const d = await api.resetSettings();
    setCfg(clone(d.config));
    setSaved('Paramètres réinitialisés ✓');
    setTimeout(() => setSaved(''), 2500);
  };
  const changePw = async () => {
    setPwMsg('');
    try {
      await api.changePassword(pw.current, pw.next);
      setPw({ current: '', next: '' });
      setPwMsg('Mot de passe modifié ✓');
    } catch (e) { setPwMsg(e.message); }
  };

  const p = { cfg, upd };

  return (
    <div>
      <div className="section-title">
        <h1>Paramètres</h1>
        <div className="btn-row">
          {saved && <span className="badge badge--success">{saved}</span>}
          <button className="btn" onClick={reset}>Réinitialiser</button>
          <button className="btn btn--primary" onClick={save}>💾 Enregistrer</button>
        </div>
      </div>

      <div className="card">
        <h2>Magasin</h2>
        <div className="form-row">
          <Txt {...p} path={['store', 'name']} label="Nom" />
          <Txt {...p} path={['store', 'address']} label="Adresse" />
        </div>
        <div className="form-row">
          <Txt {...p} path={['store', 'weekday_open']} label="Ouverture (lun-sam)" placeholder="09:50" />
          <Txt {...p} path={['store', 'weekday_close']} label="Fermeture (lun-sam)" placeholder="19:40" />
          <Txt {...p} path={['store', 'sunday_open']} label="Ouverture dimanche" placeholder="10:50" />
          <Txt {...p} path={['store', 'sunday_close']} label="Fermeture dimanche" placeholder="19:10" />
        </div>
        <label>Jours d'ouverture</label>
        <DaysPicker cfg={cfg} toggleDay={toggleDay} path={['store', 'open_days']} />
      </div>

      <div className="card">
        <h2>Couverture</h2>
        <div className="form-row">
          <Num {...p} path={['coverage', 'min_opening']} label="Personnes à l'ouverture" />
          <Num {...p} path={['coverage', 'min_closing']} label="Personnes à la fermeture" />
        </div>
        <Chk {...p} path={['coverage', 'require_continuous']} label="Exiger une présence continue (pénaliser les creux)" />
      </div>

      <div className="card">
        <h2>Créneaux & pauses</h2>
        <div className="form-row">
          <Txt {...p} path={['shifts', 'break_start']} label="Début de pause" placeholder="14:00" />
          <Txt {...p} path={['shifts', 'break_end']} label="Fin de pause" placeholder="15:00" />
          <Num {...p} path={['shifts', 'break_minutes']} label="Durée pause (min)" />
        </div>
        <div className="form-row">
          <Num {...p} path={['shifts', 'break_threshold_minutes']} label="Seuil journée avec pause (min)" hint="Au-delà, une pause est insérée" />
          <Num {...p} path={['shifts', 'min_day_minutes']} label="Journée minimale (min)" />
          <Num {...p} path={['shifts', 'long_day_minutes']} label="Seuil journée longue (min)" />
        </div>
      </div>

      <div className="card">
        <h2>Commande</h2>
        <div className="form-row">
          <div className="field">
            <label>Jour de commande</label>
            <select value={cfg.order.weekday} onChange={(e) => upd(['order', 'weekday'], Number(e.target.value))}>
              {WEEKDAYS.map((w) => <option key={w.v} value={w.v}>{DAY_NAMES[w.v - 1]}</option>)}
            </select>
          </div>
          <Txt {...p} path={['order', 'deadline']} label="Heure limite" placeholder="12:00" />
        </div>
        <Chk {...p} path={['order', 'require_manager']} label="Exiger un responsable (Yassine ou Rose)" />
      </div>

      <div className="card">
        <h2>Livraisons</h2>
        <label>Jours de livraison</label>
        <DaysPicker cfg={cfg} toggleDay={toggleDay} path={['deliveries', 'weekdays']} />
      </div>

      <div className="card">
        <h2>Répartition week-end (salariés « week-end uniquement »)</h2>
        <div className="form-row">
          <Num {...p} path={['noussia', 'saturday_ratio']} label="Part du samedi" step={0.05} hint="Ex. 0.55 = 55%" />
          <Num {...p} path={['noussia', 'sunday_ratio']} label="Part du dimanche" step={0.05} hint="Ex. 0.45 = 45%" />
        </div>
      </div>

      <div className="card">
        <h2>Repos</h2>
        <div className="form-row">
          <Num {...p} path={['rest', 'min_days_per_week']} label="Jours de repos garantis / semaine" hint="Contrainte dure : 2 = maximum 5 jours travaillés" />
          <Num {...p} path={['rest', 'max_consecutive_days']} label="Jours consécutifs max" hint="Sur les 3 semaines, jointures comprises. 0 = désactivé" />
        </div>
      </div>

      <div className="card">
        <h2>Rotation & équité</h2>
        <div className="form-row">
          <Num {...p} path={['rotation', 'history_weeks']} label="Semaines d'historique pondérées" hint="0 = tout l'historique" />
          <Num {...p} path={['rotation', 'decay']} label="Décroissance par semaine" step={0.05} hint="1 = pas de décroissance" />
        </div>
      </div>

      <div className="card">
        <h2>Moteur de génération</h2>
        <div className="form-row">
          <Num {...p} path={['generator', 'candidates']} label="Nombre de candidats évalués" />
          <Num {...p} path={['generator', 'hours_tolerance_minutes']} label="Tolérance heures (min)" hint="Écart accepté avant alerte" />
        </div>
      </div>

      <div className="card">
        <h2>Poids du score</h2>
        <p className="muted">Plus le poids est élevé, plus la violation est pénalisée.</p>
        <div className="grid cols-3">
          {Object.keys(cfg.weights).map((k) => (
            <Num key={k} {...p} path={['weights', k]} label={k} step={0.5} />
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Compte administrateur</h2>
        {pwMsg && <div className={`alert ${pwMsg.includes('✓') ? 'alert--ok' : 'alert--error'}`}>{pwMsg}</div>}
        <div className="form-row">
          <div className="field"><label>Mot de passe actuel</label><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></div>
          <div className="field"><label>Nouveau mot de passe</label><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></div>
        </div>
        <button className="btn" onClick={changePw}>Changer le mot de passe</button>
      </div>
    </div>
  );
}
