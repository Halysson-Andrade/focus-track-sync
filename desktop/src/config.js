// Backend (Lovable Cloud)
module.exports = {
  SUPABASE_URL: "https://gvwpnafampeylylnqenu.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2d3BuYWZhbXBleWx5bG5xZW51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMTE3MDMsImV4cCI6MjA5NjY4NzcwM30.xZPYBkNO5cVJhXliJZbzXLBD2Ad1S3wCU_nCTTI7DeE",
  POLL_INTERVAL_MS: 5000, // verifica app ativo a cada 5s (local, sem write no banco)
  IDLE_THRESHOLD_S: 180, // 3 min sem mouse/teclado = ocioso (idle granular)
  INACTIVITY_LIMIT_MS: 600000, // 10 min sem atividade = status macro INATIVO
  FLUSH_INTERVAL_MS: 300000, // heartbeat da linha aberta no banco (5 min — antes 60s).
  // O total final é calculado no `close` a partir de inicio/fim, então
  // espaçar o heartbeat não muda o resultado — só reduz writes ~5×.
  MACRO_POLL_MS: 120000, // lê o status da sessão macro a cada 2 min (antes 30s)
  WHITELIST_REFRESH_MS: 300000, // recarrega a whitelist a cada 5 min
  MIN_DURATION_S: 3, // descarta sessão de app < 3s (ruído de troca rápida)

};
