/**
 * Overlay do copiloto — o pop-up flutuante sobre o Meet.
 *
 * Shadow DOM fechado: o CSS do Meet não vaza para dentro nem o nosso para
 * fora. Fonte GRANDE de propósito (o texto é para ser lido num relance, no
 * meio de uma conversa). Três áreas: fase atual, sugestão, status/saúde.
 *
 * Toda a rede passa pelo service worker (chrome.runtime.sendMessage) — o
 * content script não guarda token nem URL.
 */
(() => {
  "use strict";

  // ---------- estado ----------
  let meetingId = null;
  let meetingType = null; // 'r1' | 'r2'
  let pendingTurns = [];
  let flushTimer = null;
  let health = { captionsFound: false, lastCaptionAgoMs: null };
  let lastSuggestionAt = 0;

  const FLUSH_MS = 10_000;

  function meetCode() {
    const m = /^\/([a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4})/i.exec(location.pathname);
    return m ? m[1] : null;
  }

  // ---------- UI ----------
  const host = document.createElement("div");
  host.id = "nexo-copiloto-host";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .panel {
        position: fixed;
        top: 80px;
        right: 16px;
        z-index: 2147483000;
        width: 340px;
        background: #0b1b2b;
        color: #f2f6fa;
        border: 1px solid #2ec5d3;
        border-radius: 14px;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        box-shadow: 0 8px 30px rgba(0,0,0,.45);
        user-select: none;
      }
      .bar {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 12px; cursor: grab;
        border-bottom: 1px solid rgba(255,255,255,.12);
      }
      .bar .title { font-size: 13px; font-weight: 700; letter-spacing: .3px; flex: 1; }
      .dot { width: 10px; height: 10px; border-radius: 50%; background: #6b7a89; }
      .dot.ok { background: #2ee59d; }
      .dot.warn { background: #ffb84d; }
      .dot.bad { background: #ff5d5d; }
      .body { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
      .phase {
        display: inline-flex; align-self: flex-start;
        padding: 4px 12px; border-radius: 999px;
        font-size: 14px; font-weight: 800; letter-spacing: .5px;
        background: #123047; color: #7fe3ee;
      }
      .suggestion {
        font-size: 23px; line-height: 1.3; font-weight: 700;
        min-height: 60px;
      }
      .suggestion.flash { animation: flash .6s ease 1; }
      @keyframes flash { 0% { color: #7fe3ee; } 100% { color: #f2f6fa; } }
      .alert {
        font-size: 15px; font-weight: 700; color: #ffb84d;
        border: 1px solid rgba(255,184,77,.5); border-radius: 10px;
        padding: 8px 10px;
      }
      .status { font-size: 12px; color: #9db2c4; }
      .warnbox {
        font-size: 16px; font-weight: 700; color: #ffb84d; text-align: center;
        padding: 10px;
      }
      .row { display: flex; gap: 8px; }
      button {
        all: unset; cursor: pointer; text-align: center;
        flex: 1; padding: 12px 8px; border-radius: 10px;
        font-size: 15px; font-weight: 800;
        background: #2ec5d3; color: #06121f;
      }
      button.secondary { background: #123047; color: #cfe7f2; }
      button.danger { background: #7a2030; color: #ffd7dc; }
      button:disabled { opacity: .5; cursor: default; }
      .hidden { display: none !important; }
    </style>
    <div class="panel" part="panel">
      <div class="bar" id="dragbar">
        <span class="dot" id="healthdot"></span>
        <span class="title">Copiloto Nexo</span>
        <span class="status" id="clock"></span>
      </div>
      <div class="body">
        <div id="warn" class="warnbox hidden"></div>
        <div id="idle" class="row">
          <button id="start-r1">Iniciar R1</button>
          <button id="start-r2" class="secondary">Iniciar R2</button>
        </div>
        <div id="live" class="hidden">
          <span class="phase" id="phase">—</span>
          <div class="suggestion" id="suggestion">Aguardando a conversa…</div>
          <div class="alert hidden" id="alert"></div>
          <div class="status" id="status"></div>
          <div class="row" style="margin-top:10px">
            <button id="finish" class="danger">Encerrar reunião</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(host);

  const $ = (id) => shadow.getElementById(id);

  // Arrastável pela barra.
  (() => {
    const panel = shadow.querySelector(".panel");
    const bar = $("dragbar");
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    bar.addEventListener("pointerdown", (e) => {
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const r = panel.getBoundingClientRect();
      ox = r.left; oy = r.top;
      bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      panel.style.left = `${ox + e.clientX - sx}px`;
      panel.style.top = `${oy + e.clientY - sy}px`;
      panel.style.right = "auto";
    });
    bar.addEventListener("pointerup", () => { dragging = false; });
  })();

  function setWarn(msg) {
    const el = $("warn");
    if (!msg) {
      el.classList.add("hidden");
      el.textContent = "";
    } else {
      el.classList.remove("hidden");
      el.textContent = msg;
    }
  }

  function setPhase(label) {
    $("phase").textContent = label || "—";
  }

  function setSuggestion(text) {
    const el = $("suggestion");
    el.textContent = text;
    el.classList.remove("flash");
    void el.offsetWidth; // reinicia a animação
    el.classList.add("flash");
  }

  function setAlert(msg) {
    const el = $("alert");
    if (!msg) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.classList.remove("hidden");
    el.textContent = `⚠ ${msg}`;
    clearTimeout(setAlert._t);
    setAlert._t = setTimeout(() => el.classList.add("hidden"), 15_000);
  }

  function setStatus(msg) {
    $("status").textContent = msg || "";
  }

  function setHealthDot(cls) {
    $("healthdot").className = `dot ${cls}`;
  }

  function showLive(on) {
    $("idle").classList.toggle("hidden", on);
    $("live").classList.toggle("hidden", !on);
  }

  // ---------- rede (via service worker) ----------
  function sw(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(res || { ok: false, error: "sem resposta" });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  async function startMeeting(type) {
    if (!health.captionsFound) {
      setWarn("Ligue as legendas (CC) em português antes de iniciar — sem elas o copiloto não ouve nada.");
      return;
    }
    $("start-r1").disabled = true;
    $("start-r2").disabled = true;
    const res = await sw({ kind: "meeting:start", meeting_type: type, meet_code: meetCode() });
    $("start-r1").disabled = false;
    $("start-r2").disabled = false;
    if (!res.ok) {
      setWarn(`Não conectou no CRM: ${res.error}. Confira o token nas opções da extensão.`);
      return;
    }
    setWarn(null);
    meetingId = res.meeting.id;
    meetingType = type;
    pendingTurns = [];
    showLive(true);
    setPhase(type === "r1" ? "R1 · Abertura" : "R2 · Abertura");
    setSuggestion(res.resumed ? "Reunião retomada." : "Pode começar. Eu acompanho por aqui.");
    window.dispatchEvent(new Event("nexo-copiloto:meeting-started"));
    flushTimer = setInterval(flushTurns, FLUSH_MS);
  }

  async function finishMeeting() {
    $("finish").disabled = true;
    clearInterval(flushTimer);
    window.dispatchEvent(new Event("nexo-copiloto:meeting-ended"));
    // Um último flush leva o que sobrou (inclusive o turno fechado no ended).
    await new Promise((r) => setTimeout(r, 150));
    await flushTurns();
    const res = await sw({ kind: "meeting:finish", meeting_id: meetingId });
    $("finish").disabled = false;
    if (!res.ok) {
      setStatus(`Falha ao encerrar: ${res.error} — tento de novo em 10s.`);
      flushTimer = setInterval(async () => {
        const retry = await sw({ kind: "meeting:finish", meeting_id: meetingId });
        if (retry.ok) {
          clearInterval(flushTimer);
          endLocalMeeting();
        }
      }, 10_000);
      return;
    }
    endLocalMeeting();
  }

  function endLocalMeeting() {
    meetingId = null;
    meetingType = null;
    showLive(false);
    setSuggestion("Aguardando a conversa…");
    setAlert(null);
    setStatus("Reunião enviada para o CRM. A análise chega em ~1 minuto na Sala de Reuniões.");
  }

  async function flushTurns() {
    if (!meetingId || pendingTurns.length === 0) return;
    const batch = pendingTurns.slice(0, 200);
    const res = await sw({ kind: "meeting:turns", meeting_id: meetingId, turns: batch });
    if (res.ok) {
      // Remove só o que foi enviado; o que chegou durante o envio fica.
      pendingTurns = pendingTurns.filter((t) => !batch.some((b) => b.i === t.i));
    }
  }

  // ---------- eventos vindos do captador ----------
  window.addEventListener("nexo-copiloto:turn", (e) => {
    if (!meetingId) return;
    pendingTurns.push(e.detail);
    // Fase 3 pluga aqui: turno do LEAD dispara pedido de sugestão.
    window.dispatchEvent(new CustomEvent("nexo-copiloto:turn-buffered", { detail: e.detail }));
  });

  window.addEventListener("nexo-copiloto:health", (e) => {
    health = e.detail;
    if (!meetingId) {
      setHealthDot(health.captionsFound ? "ok" : "warn");
      if (health.captionsFound) setWarn(null);
      return;
    }
    // Em reunião: verde = legendas chegando; amarelo = 30s sem texto; vermelho = região sumiu.
    if (!health.captionsFound) {
      setHealthDot("bad");
      setStatus("Não acho as legendas — confira se o CC está ligado.");
    } else if (health.lastCaptionAgoMs !== null && health.lastCaptionAgoMs > 30_000) {
      setHealthDot("warn");
      setStatus("30s sem legenda nova. Silêncio, ou o CC caiu?");
    } else {
      setHealthDot("ok");
      setStatus(`${pendingTurns.length} fala(s) na fila de envio.`);
    }
  });

  // A Fase 3 escuta este canal para atualizar fase/sugestão/alerta.
  window.addEventListener("nexo-copiloto:live-update", (e) => {
    const { fase_label, sugestao, alerta } = e.detail || {};
    if (fase_label) setPhase(fase_label);
    if (sugestao && Date.now() - lastSuggestionAt > 1000) {
      lastSuggestionAt = Date.now();
      setSuggestion(sugestao);
    }
    if (alerta) setAlert(alerta);
  });

  // Expõe o contexto da reunião para o módulo de tempo real (Fase 3).
  window.__nexoCopiloto = {
    getMeetingId: () => meetingId,
    getMeetingType: () => meetingType,
    sw,
  };

  // ---------- botões ----------
  $("start-r1").addEventListener("click", () => startMeeting("r1"));
  $("start-r2").addEventListener("click", () => startMeeting("r2"));
  $("finish").addEventListener("click", finishMeeting);

  // Relógio da barra.
  setInterval(() => {
    if (!meetingId) {
      $("clock").textContent = "";
      return;
    }
    const started = window.__nexoCopilotoStartedAt || (window.__nexoCopilotoStartedAt = Date.now());
    const s = Math.floor((Date.now() - started) / 1000);
    $("clock").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);
  window.addEventListener("nexo-copiloto:meeting-started", () => {
    window.__nexoCopilotoStartedAt = Date.now();
  });
})();
