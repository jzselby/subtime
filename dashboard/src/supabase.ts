import { createClient } from '@supabase/supabase-js';

/**
 * Unlike the main app, this site has nothing to fall back to without these —
 * it's a thin reader with no local data of its own, so a missing URL/key is
 * a deploy-time misconfiguration, not a runtime condition to route around.
 */
export const configured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
);

export const supabase = configured
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null;
