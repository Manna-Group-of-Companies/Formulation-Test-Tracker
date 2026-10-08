// ---------- Conduct Test page (Manna lab): test.html?id=<formulation id> ----------
//
// One formulation from the Test Queue on a page of its own: Hi-Tech
// Company's composition notes, each requested test with its limits, and the
// lab's controls — start, put on hold, record each result, release. It is
// the same component as the board's detail panel (views/detail.js), and it
// keeps itself current while the other side makes changes.

import { fetchAll } from "./api.js";
import { state } from "./state.js";
import { connectEvents } from "./live.js";
import { toast } from "./toast.js";
import { startPage } from "./page.js";
import { setupDetail, openDetail, refreshDetail } from "./views/detail.js";

var id = new URLSearchParams(location.search).get("id") || "";
var opened = false;

function loadAll() {
  return fetchAll().then(function () {
    if (opened) refreshDetail(); else { opened = true; openDetail(id); }
    var f = state.formulations.find(function (x) { return x.id === id; });
    if (f) document.title = f.name + " — Conduct Test";
  });
}

startPage("test.html?id=" + encodeURIComponent(id)).then(function (user) {
  if (user.role !== "lab") { document.getElementById("not-lab").hidden = false; return; }
  setupDetail({
    box: document.getElementById("conduct"),
    refresh: loadAll,
    backHref: "queue.html",
    backLabel: "← Test Queue",
    onMissing: function () { document.getElementById("not-found").hidden = false; }
  });
  return loadAll().then(function () { connectEvents(loadAll); });
}).catch(function () {
  toast("Could not reach the server — is it running?");
});
