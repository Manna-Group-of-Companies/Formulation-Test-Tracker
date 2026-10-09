// Small pieces shared by the pages: pass/fail badges, the row of summary
// tiles, and the reactor recipe box.

import { REACTOR_FIELDS, hasReactor, materialsTotal } from "../lib/format.js";

export function Badge({ result }) {
  if (result === "pass") return <span className="badge pass">Pass</span>;
  if (result === "fail") return <span className="badge fail">Fail</span>;
  if (result === "recorded") return <span className="badge rec">Recorded</span>;
  return <span className="badge rec">—</span>;
}

// The row of summary numbers at the top of the board, queue and history.
export function Tiles({ tiles }) {
  return (
    <div className="tiles">
      {tiles.map(function (t) {
        return (
          <div className="tile" key={t.label}>
            <div className="label">{t.label}</div>
            <div className="value mono">{t.value}</div>
            <div className="sub">{t.sub}</div>
          </div>
        );
      })}
    </div>
  );
}

// Raw materials, reactor conditions and notes: what the lab works from.
export function Recipe({ f }) {
  var materials = f.materials || [];
  var reactor = hasReactor(f);
  if (!materials.length && !reactor && !f.description) return null;
  return (
    <div className="composition recipe">
      {materials.length > 0 && (
        <div className="recipe-block">
          <span className="k">Raw materials</span>
          <ul className="recipe-list">
            {materials.map(function (m, i) {
              return <li key={i}><span>{m.name}</span><span className="mono">{m.percent != null ? m.percent + " %" : "—"}</span></li>;
            })}
            <li className="recipe-total"><span>Total</span><span className="mono">{materialsTotal(materials)} %</span></li>
          </ul>
        </div>
      )}
      {reactor && (
        <div className="recipe-block">
          <span className="k">Reactor conditions</span>
          <ul className="recipe-list">
            {REACTOR_FIELDS.map(function (r) {
              var v = f.reactor[r.key];
              return <li key={r.key}><span>{r.label}</span><span className="mono">{v != null ? v + " " + r.unit : "—"}</span></li>;
            })}
          </ul>
        </div>
      )}
      {f.description && (
        <div className="recipe-block recipe-notes"><span className="k">Notes</span><p>{f.description}</p></div>
      )}
    </div>
  );
}

// A whole-card message: nothing here, or not for this side.
export function EmptyCard({ title, children }) {
  return (
    <div className="card">
      <div className="empty">{title && <div className="big">{title}</div>}<div>{children}</div></div>
    </div>
  );
}
