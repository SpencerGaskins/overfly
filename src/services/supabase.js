import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.warn('[FlightLevel] Supabase env vars missing — FLYREP submission disabled')
}

export const supabase = createClient(supabaseUrl, supabaseKey)
