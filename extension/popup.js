const root = document.getElementById("content");

async function getSession() {
  const { session } = await chrome.storage.local.get("session");
  return session || null;
}

function renderLogin(msg) {
  root.innerHTML = `
    ${msg ? `<div class="status err">${msg}</div>` : ""}
    <label>Email</label>
    <input id="email" type="email" autocomplete="email" />
    <label>Senha</label>
    <input id="password" type="password" autocomplete="current-password" />
    <button id="login">Entrar</button>
    <div class="muted">Use o mesmo login do painel.</div>
  `;
  document.getElementById("login").onclick = doLogin;
}

function renderLogged(session) {
  root.innerHTML = `
    <div class="status ok">Conectado como <b>${session.user.email}</b></div>
    <div class="muted">A navegação está sendo registrada em segundo plano.</div>
    <button class="secondary" id="logout" style="margin-top:14px">Sair</button>
  `;
  document.getElementById("logout").onclick = async () => {
    await chrome.storage.local.remove("session");
    chrome.runtime.sendMessage({ type: "LOGGED_OUT" });
    renderLogin();
  };
}

async function doLogin() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!email || !password) return renderLogin("Preencha email e senha");
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return renderLogin(data.error_description || data.msg || "Falha no login");
    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user: data.user,
    };
    await chrome.storage.local.set({ session });
    chrome.runtime.sendMessage({ type: "LOGGED_IN" });
    renderLogged(session);
  } catch (e) {
    renderLogin("Erro de conexão");
  }
}

(async () => {
  const s = await getSession();
  if (s) renderLogged(s); else renderLogin();
})();
