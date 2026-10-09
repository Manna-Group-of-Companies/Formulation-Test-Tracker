// Signing in with a name and a PIN (4 to 8 digits). The ftt-sign-in Edge
// Function checks the PIN, counts wrong ones (5 for a name means a wait),
// and hands back a Supabase session, which this browser then keeps and
// renews. How a name and PIN become a Supabase Auth account is the Edge
// Function's business; the browser never sees it.

import { supabase } from "./supabase.js";

export var PIN_PATTERN = /^\d{4,8}$/;

export async function signIn(name, pin) {
  var res = await supabase.functions.invoke("ftt-sign-in", { body: { name: name, pin: pin } });
  if (res.error) {
    var message = "Can't reach the tracker — check the connection.";
    var status = res.error.context && res.error.context.status;
    try { message = (await res.error.context.json()).error || message; } catch (e) { /* not a JSON reply */ }
    var err = new Error(message);
    err.status = status;
    throw err;
  }
  var set = await supabase.auth.setSession({ access_token: res.data.access_token, refresh_token: res.data.refresh_token });
  if (set.error) throw new Error(set.error.message);
}

export function signOut() {
  return supabase.auth.signOut();
}

export function randomPin() {
  var a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 10000).padStart(4, "0");
}
