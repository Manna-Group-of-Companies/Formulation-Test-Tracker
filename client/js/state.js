// ---------- shared state: who's signed in, and the latest data fetched from the server ----------

export var state = { user: null, formulations: [], results: [] };

export function resultsForFormulation(id) {
  return state.results.filter(function (r) { return r.formulationId === id; });
}
