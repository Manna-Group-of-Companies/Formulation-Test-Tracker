// Every read and write goes through the database functions in
// supabase/migrations (supabase.rpc), which check who is asking. Errors
// come back as an Error whose message can be shown as it is; err.signedOut
// is set when the sign-in has ended.

import { supabase } from "./supabase.js";

var onSignedOut = null;
export function setSignedOutHandler(fn) { onSignedOut = fn; }

function toError(e) {
  var err = new Error(e.message || "Something went wrong — try again");
  err.code = e.code;
  // 28000: the database's "sign in first"; PGRST301/303: the sign-in token ran out.
  err.signedOut = e.code === "28000" || e.code === "PGRST301" || e.code === "PGRST303";
  if (!e.code && /failed to fetch|network/i.test(e.message || "")) err.message = "Can't reach the tracker — check the connection.";
  return err;
}

async function rpc(name, args) {
  var res = await supabase.rpc(name, args || {});
  if (res.error) {
    var err = toError(res.error);
    if (err.signedOut && onSignedOut) onSignedOut();
    throw err;
  }
  return res.data;
}

export var api = {
  session: function () { return rpc("ftt_session"); },
  list: function () { return rpc("ftt_list"); },
  submit: function (payload) { return rpc("ftt_submit", { payload: payload }); },
  withdraw: function (id) { return rpc("ftt_withdraw", { formulation_id: id }); },
  labAction: function (id, action, body) { return rpc("ftt_lab_action", { formulation_id: id, action: action, body: body || {} }); },
  recordResult: function (payload) { return rpc("ftt_record_result", { payload: payload }); },
  report: function (id) { return rpc("ftt_report", { formulation_id: id }); },
  listUsers: function () { return rpc("ftt_list_users"); }
};

// Adding, changing and removing accounts: the ftt-admin-users Edge Function.
export async function adminUsers(action, payload) {
  var res = await supabase.functions.invoke("ftt-admin-users", { body: Object.assign({ action: action }, payload) });
  if (res.error) {
    var message = res.error.message;
    try { message = (await res.error.context.json()).error || message; } catch (e) { /* not a JSON reply */ }
    var err = new Error(message);
    err.signedOut = res.error.context && res.error.context.status === 401;
    if (err.signedOut && onSignedOut) onSignedOut();
    throw err;
  }
  return res.data;
}
