/**
 * Service worker da extensão — a ÚNICA camada que fala com o CRM.
 *
 * O token e a URL moram em chrome.storage.local (tela de opções) e nunca
 * chegam ao content script. Retry com backoff simples; se o CRM estiver fora,
 * os turnos ficam no buffer do overlay e re-tentam no próximo flush.
 */
"use strict";

async function getConfig() {
  const { crmUrl, apiToken } = await chrome.storage.local.get(["crmUrl", "apiToken"]);
  return {
    crmUrl: (crmUrl || "").replace(/\/+$/, ""),
    apiToken: apiToken || "",
  };
}

async function api(path, { method = "GET", body } = {}) {
  const { crmUrl, apiToken } = await getConfig();
  if (!crmUrl || !apiToken) {
    return { ok: false, error: "Configure a URL do CRM e o token nas opções da extensão." };
  }
  try {
    const res = await fetch(`${crmUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = json?.error?.message || `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: msg };
    }
    return { ok: true, data: json?.data };
  } catch (e) {
    return { ok: false, error: `sem conexão (${String(e?.message || e)})` };
  }
}

/** Uma tentativa + um retry curto — bom para cliques; o flush já re-tenta sozinho. */
async function apiWithRetry(path, opts) {
  const first = await api(path, opts);
  if (first.ok || first.status === 401 || first.status === 403 || first.status === 422) {
    return first;
  }
  await new Promise((r) => setTimeout(r, 1500));
  return api(path, opts);
}

const handlers = {
  async "config:test"() {
    const res = await api("/api/v1/meetings?limit=1");
    return res.ok ? { ok: true } : res;
  },

  async "meeting:start"(msg) {
    const res = await apiWithRetry("/api/v1/meetings", {
      method: "POST",
      body: {
        meeting_type: msg.meeting_type,
        meet_code: msg.meet_code || null,
      },
    });
    if (!res.ok) return res;
    return { ok: true, meeting: res.data.meeting, resumed: res.data.resumed };
  },

  async "meeting:turns"(msg) {
    if (!msg.meeting_id || !Array.isArray(msg.turns) || msg.turns.length === 0) {
      return { ok: false, error: "lote vazio" };
    }
    const res = await api(`/api/v1/meetings/${msg.meeting_id}/transcript`, {
      method: "POST",
      body: { turns: msg.turns },
    });
    // 409 (outro lote entrou primeiro) conta como falha recuperável: o overlay
    // mantém os turnos e o próximo flush reenvia — a rota é idempotente por `i`.
    return res;
  },

  async "meeting:finish"(msg) {
    if (!msg.meeting_id) return { ok: false, error: "sem meeting_id" };
    const res = await apiWithRetry(`/api/v1/meetings/${msg.meeting_id}/finish`, {
      method: "POST",
      body: {},
    });
    if (!res.ok) return res;
    return { ok: true, meeting: res.data.meeting };
  },

  // Fase 3: o overlay pede a sugestão para a janela atual de turnos.
  async "meeting:live-suggest"(msg) {
    if (!msg.meeting_id) return { ok: false, error: "sem meeting_id" };
    const res = await api(`/api/v1/meetings/${msg.meeting_id}/live-suggest`, {
      method: "POST",
      body: { turns: msg.turns },
    });
    if (!res.ok) return res;
    return { ok: true, ...res.data };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.kind];
  if (!handler) {
    sendResponse({ ok: false, error: `mensagem desconhecida: ${msg?.kind}` });
    return false;
  }
  handler(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
  return true; // resposta assíncrona
});
