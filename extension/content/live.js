/**
 * Loop de tempo real do copiloto (Fase 3).
 *
 * Cadência (decisão D3 do plano):
 *  - dispara quando o LEAD fecha um turno de fala, OU quando passaram 20s do
 *    último envio com texto novo — o que vier primeiro;
 *  - nunca menos de 8s entre chamadas (debounce);
 *  - last-write-wins: se uma resposta chega depois de outra mais nova já ter
 *    sido pedida, ela é descartada — sugestão velha não sobrepõe nova.
 *
 * Janela: os últimos 30 turnos. O servidor guarda a cobertura em live_state,
 * então a janela curta basta.
 */
(() => {
  "use strict";

  const DEBOUNCE_MS = 8_000;
  const MAX_GAP_MS = 20_000;
  const WINDOW_TURNS = 30;

  let history = [];
  let lastSentAt = 0;
  let lastSentTurnCount = 0;
  let requestSeq = 0;
  let timer = null;

  function ctx() {
    return window.__nexoCopiloto || null;
  }

  function reset() {
    history = [];
    lastSentAt = 0;
    lastSentTurnCount = 0;
    requestSeq++;
    clearTimeout(timer);
  }

  window.addEventListener("nexo-copiloto:meeting-started", reset);
  window.addEventListener("nexo-copiloto:meeting-ended", reset);

  window.addEventListener("nexo-copiloto:turn-buffered", (e) => {
    const c = ctx();
    if (!c || !c.getMeetingId()) return;
    history.push(e.detail);
    if (history.length > 400) history = history.slice(-200);

    if (!e.detail.is_self) {
      // Turno do lead: é o gatilho principal — pede sugestão (com debounce).
      schedule(0);
    } else {
      // Fala do próprio vendedor: só garante o teto de 20s sem envio.
      schedule(MAX_GAP_MS);
    }
  });

  function schedule(preferredDelay) {
    const c = ctx();
    if (!c || !c.getMeetingId()) return;
    const sinceLast = Date.now() - lastSentAt;
    const wait = Math.max(preferredDelay, DEBOUNCE_MS - sinceLast, 0);
    clearTimeout(timer);
    timer = setTimeout(fire, wait);
  }

  async function fire() {
    const c = ctx();
    const meetingId = c && c.getMeetingId();
    if (!meetingId) return;
    if (history.length === 0 || history.length === lastSentTurnCount) return;

    lastSentAt = Date.now();
    lastSentTurnCount = history.length;
    const seq = ++requestSeq;
    const windowTurns = history.slice(-WINDOW_TURNS);

    const res = await c.sw({
      kind: "meeting:live-suggest",
      meeting_id: meetingId,
      turns: windowTurns,
    });

    // Resposta velha (outra chamada saiu depois) ou reunião trocada: descarta.
    if (seq !== requestSeq || !c.getMeetingId()) return;
    if (!res.ok || !res.suggestion) return;

    window.dispatchEvent(
      new CustomEvent("nexo-copiloto:live-update", {
        detail: {
          fase_label: res.suggestion.fase_label,
          sugestao: res.suggestion.sugestao,
          alerta: res.suggestion.alerta,
        },
      }),
    );
  }
})();
