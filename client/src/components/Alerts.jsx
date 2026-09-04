export default function Alerts({ alerts = [], ok = [] }) {
  const errors = alerts.filter((a) => a.level === 'error');
  const warns = alerts.filter((a) => a.level === 'warn');
  if (!errors.length && !warns.length && !ok.length) return null;
  return (
    <div>
      {errors.map((a, i) => (
        <div key={`e${i}`} className="alert alert--error">
          <span>⛔</span>
          <span>{a.message}</span>
        </div>
      ))}
      {warns.map((a, i) => (
        <div key={`w${i}`} className="alert alert--warn">
          <span>⚠️</span>
          <span>{a.message}</span>
        </div>
      ))}
      {ok.map((a, i) => (
        <div key={`o${i}`} className="alert alert--ok">
          <span>✅</span>
          <span>{a.message.replace(/^✓\s*/, '')}</span>
        </div>
      ))}
    </div>
  );
}
