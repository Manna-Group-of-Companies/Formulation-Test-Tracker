// Formulation Test Tracker — the board's entry point.
//
// Makes sure someone is signed in (otherwise off to the login page), loads
// formulations and their results from the server, wires up the
// board/detail/archive interactions, then re-fetches whenever the server
// signals that something changed — a new formulation, a recorded result,
// or a status change from the other side.

import { fetchAll } from "./api.js";
import { connectEvents } from "./live.js";
import { toast } from "./toast.js";
import { startPage } from "./page.js";
import { render, init } from "./views/formulations.js";

function loadAll() {
  return fetchAll().then(render);
}

init();

startPage("./").then(function () {
  return loadAll().then(function () { connectEvents(loadAll); });
}).catch(function () {
  toast("Could not reach the server — is it running?");
});
