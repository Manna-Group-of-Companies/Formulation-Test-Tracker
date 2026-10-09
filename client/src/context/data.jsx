// The latest formulations and results, shared by the signed-in pages.
// Every change in the database sends a "changed" message on the Realtime
// channel ftt-changes (see the migration), and every open page reloads, so
// both sides stay current without refreshing. As a fallback the data also
// reloads when the tab comes back into view and once a minute.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { api } from "../lib/api.js";

var DataContext = createContext(null);

export function DataProvider({ children }) {
  var [data, setData] = useState({ formulations: [], results: [], loaded: false, error: null });
  var busy = useRef(null);
  var again = useRef(false);

  // One load at a time; a change that arrives during a load triggers one more.
  var reload = useCallback(function () {
    if (busy.current) { again.current = true; return busy.current; }
    busy.current = api.list().then(function (d) {
      setData({ formulations: d.formulations, results: d.results, loaded: true, error: null });
    }, function (err) {
      if (!err.signedOut) setData(function (prev) { return Object.assign({}, prev, { loaded: true, error: err }); });
    }).finally(function () {
      busy.current = null;
      if (again.current) { again.current = false; reload(); }
    });
    return busy.current;
  }, []);

  useEffect(function () {
    reload();
    var channel = supabase.channel("ftt-changes")
      .on("broadcast", { event: "changed" }, function () { reload(); })
      .subscribe(function (status) {
        // Catch up on anything missed while the connection was down.
        if (status === "SUBSCRIBED") reload();
      });
    function onVisible() { if (document.visibilityState === "visible") reload(); }
    document.addEventListener("visibilitychange", onVisible);
    var timer = setInterval(reload, 60000);
    return function () {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [reload]);

  return <DataContext.Provider value={Object.assign({ reload: reload }, data)}>{children}</DataContext.Provider>;
}

export function useData() { return useContext(DataContext); }

export function resultsFor(results, formulationId) {
  return results.filter(function (r) { return r.formulationId === formulationId; });
}
