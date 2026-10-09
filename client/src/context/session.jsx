// Who is signed in. Supabase Auth keeps the sign-in in this browser and
// renews it; the profile (name, side, administrator) comes from the
// database. If the sign-in ends while a page is open, the page goes to the
// login page, which brings it back afterwards.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { supabase } from "../lib/supabase.js";
import { api, setSignedOutHandler } from "../lib/api.js";
import { signOut as authSignOut } from "../lib/auth.js";

var SessionContext = createContext(null);

export function SessionProvider({ children }) {
  var [user, setUser] = useState(null);
  var [ready, setReady] = useState(false);
  var navigate = useNavigate();
  var location = useLocation();

  // Load the profile for the current sign-in (null when signed out).
  var refresh = useCallback(async function () {
    var { data } = await supabase.auth.getSession();
    if (!data.session) { setUser(null); return null; }
    try {
      var me = await api.session();
      setUser(me);
      return me;
    } catch (err) {
      if (err.signedOut) { await authSignOut(); setUser(null); return null; }
      throw err;
    }
  }, []);

  useEffect(function () {
    refresh().catch(function () { setUser(null); }).finally(function () { setReady(true); });
    var { data } = supabase.auth.onAuthStateChange(function (event) {
      if (event === "SIGNED_OUT") setUser(null);
    });
    return function () { data.subscription.unsubscribe(); };
  }, [refresh]);

  // A call answered "sign in first": the sign-in has run out.
  useEffect(function () {
    setSignedOutHandler(function () {
      authSignOut().finally(function () {
        setUser(null);
        var here = location.pathname + location.search;
        navigate("/login?expired=1&next=" + encodeURIComponent(here), { replace: true });
      });
    });
  }, [navigate, location]);

  var signOut = useCallback(async function () {
    await authSignOut().catch(function () {});
    setUser(null);
    navigate("/login?signedout=1", { replace: true });
  }, [navigate]);

  return <SessionContext.Provider value={{ user: user, ready: ready, refresh: refresh, signOut: signOut }}>{children}</SessionContext.Provider>;
}

export function useSession() { return useContext(SessionContext); }
