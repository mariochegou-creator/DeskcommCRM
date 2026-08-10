/** Tela de opções: guarda URL + token e testa a conexão na hora. */
"use strict";

const $ = (id) => document.getElementById(id);

async function load() {
  const { crmUrl, apiToken } = await chrome.storage.local.get(["crmUrl", "apiToken"]);
  if (crmUrl) $("crmUrl").value = crmUrl;
  if (apiToken) $("apiToken").value = apiToken;
}

async function saveAndTest() {
  const crmUrl = $("crmUrl").value.trim().replace(/\/+$/, "");
  const apiToken = $("apiToken").value.trim();
  const result = $("result");

  result.className = "";
  result.textContent = "Salvando…";

  if (!/^https?:\/\//.test(crmUrl)) {
    result.className = "bad";
    result.textContent = "✗ O endereço precisa começar com http:// ou https://";
    return;
  }
  if (!apiToken.startsWith("dsk_")) {
    result.className = "bad";
    result.textContent = "✗ O token deve começar com dsk_ — copie de Configurações → API Tokens.";
    return;
  }

  await chrome.storage.local.set({ crmUrl, apiToken });
  result.textContent = "Testando conexão…";

  const res = await chrome.runtime.sendMessage({ kind: "config:test" });
  if (res && res.ok) {
    result.className = "ok";
    result.textContent = "✓ Conectado! Pode fechar esta aba e abrir o Meet.";
  } else {
    result.className = "bad";
    result.textContent = `✗ Não conectou: ${res?.error || "erro desconhecido"}`;
  }
}

$("save").addEventListener("click", saveAndTest);
void load();
