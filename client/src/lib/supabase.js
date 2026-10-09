// The one Supabase client the pages share. The URL and the publishable key
// are public by design (they come from .env.production); what each person
// may see or change is decided in the database (supabase/migrations).

import { createClient } from "@supabase/supabase-js";

var url = import.meta.env.VITE_SUPABASE_URL;
var key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not set (see client/.env.example).");

export var supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "ftt-auth" }
});
