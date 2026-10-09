// One formulation from the Test Queue on a page of its own (/test/:id):
// the reactor recipe, each requested test with its limits, and the lab's
// controls — start, put on hold, record each result, release. It is the
// same component as the board's detail panel, and it stays current while
// the other side makes changes.

import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { Page } from "../components/Layout.jsx";
import { EmptyCard } from "../components/bits.jsx";
import FormulationDetail from "../components/FormulationDetail.jsx";
import { useData } from "../context/data.jsx";
import { useSession } from "../context/session.jsx";

export default function ConductTest() {
  var { id } = useParams();
  var { user } = useSession();
  var { formulations, loaded } = useData();
  var f = formulations.find(function (x) { return x.id === id; });

  useEffect(function () { document.title = (f ? f.name + " — " : "") + "Conduct Test"; }, [f && f.name]); // eslint-disable-line react-hooks/exhaustive-deps

  var body;
  if (user.role !== "lab") body = <EmptyCard title="Manna lab only">Tests are conducted by the lab. <Link to="/history">See your test results</Link></EmptyCard>;
  else if (!loaded) body = <p className="spec-line">Loading…</p>;
  else if (!f) body = <EmptyCard title="Not in the queue">This formulation no longer exists; Hi‑Tech Company may have withdrawn it. <Link to="/queue">Back to the Test Queue</Link></EmptyCard>;
  else body = <FormulationDetail key={f.id} f={f} back={{ to: "/queue", label: "← Test Queue" }} />;

  return (
    <Page narrow>
      <div className="page-head">
        <h1>Conduct Test</h1>
        <p>Test the formulation as Hi‑Tech Company specified, record each result, then send the results back.</p>
      </div>
      {body}
    </Page>
  );
}
