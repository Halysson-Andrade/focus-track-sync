// Backend (Lovable Cloud)
module.exports = {
  SUPABASE_URL: "https://gvwpnafampeylylnqenu.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2d3BuYWZhbXBleWx5bG5xZW51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMTE3MDMsImV4cCI6MjA5NjY4NzcwM30.xZPYBkNO5cVJhXliJZbzXLBD2Ad1S3wCU_nCTTI7DeE",
  POLL_INTERVAL_MS: 5000,        // verifica app ativo a cada 5s
  IDLE_THRESHOLD_S: 60,          // 60s sem mouse/teclado = inativo
  FLUSH_INTERVAL_MS: 60000,      // atualiza linha aberta no banco a cada 60s
};
