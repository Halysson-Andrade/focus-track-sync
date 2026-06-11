const root = document.getElementById("content");

async function getSession() {
  const { session } = await chrome.storage.local.get("session");
  return session || null;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "style") node.setAttribute("style", v);
    else node[k] = v;
  }
  for (const c of children) {
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function renderLogin(msg) {
  root.replaceChildren();
  if (msg) root.appendChild(el("div", { class: "status err", textContent: String(msg) }));
  root.appendChild(el("label", { textContent: "Email" }));
  root.appendChild(el("input", { id: "email", type: "email", autocomplete: "email" }));
  root.appendChild(el("label", { textContent: "Senha" }));
  root.appendChild(el("input", { id: "password", type: "password", autocomplete: "current-password" }));
  root.appendChild(el("button", { id: "login", textContent: "Entrar" }));
  root.appendChild(el("div", { class: "muted", textContent: "Use o mesmo login do painel." }));
  document.getElementById("login").onclick = doLogin;
}

function renderLogged(session) {
  root.replaceChildren();
  const status = el("div", { class: "status ok" }, [
    "Conectado como ",
    el("b", { textContent: String(session?.user?.email ?? "") }),
  ]);
  root.appendChild(status);
  root.appendChild(el("div", { class: "muted", textContent: "A navegação está sendo registrada em segundo plano." }));
  root.appendChild(el("button", { class: "secondary", id: "logout", style: "margin-top:14px", textContent: "Sair" }));
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
