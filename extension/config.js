// Configuração do backend (Lovable Cloud)
const SUPABASE_URL = "https://gvwpnafampeylylnqenu.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2d3BuYWZhbXBleWx5bG5xZW51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMTE3MDMsImV4cCI6MjA5NjY4NzcwM30.xZPYBkNO5cVJhXliJZbzXLBD2Ad1S3wCU_nCTTI7DeE";

// Idle granular: 3 min sem mouse/teclado conta como ocioso (sincronizado com
// desktop/src/config.js e src/lib/activity-config.ts).
const IDLE_THRESHOLD_S = 180;
