/**
 * Captura das legendas do Google Meet (content script).
 *
 * O Meet desenha as legendas num container próprio; este script observa esse
 * container com MutationObserver, agrega o texto por falante e fecha um "turno"
 * quando o texto para de crescer por SILENCE_MS. Cada turno fechado é entregue
 * ao overlay (window event), que decide o que fazer.
 *
 * ⚠️ OS SELETORES MORAM AQUI EM CIMA, num objeto só. O Google muda o DOM do
 * Meet sem avisar — quando a captura parar, é AQUI que se mexe, e o overlay
 * mostra o estado de saúde para o problema aparecer na hora, não depois da
 * reunião. Há uma heurística de reserva (região aria-live) para sobreviver a
 * renomes de classe.
 */
(() => {
  "use strict";

  const CONFIG = {
    // Container das legendas (2024-2026: div[role="region"] com aria-label de
    // legendas; a classe muda, o papel ARIA é mais estável).
    captionRegionSelectors: [
      'div[role="region"][aria-label*="legenda" i]',
      'div[role="region"][aria-label*="caption" i]',
      "div[jscontroller][jsname][class*=caption i]",
    ],
    // Dentro da região: cada bloco de fala tem o nome do falante e o texto.
    // O Meet reusa os blocos enquanto a pessoa fala (o texto cresce no lugar).
    speakerNameSelectors: ["div[class*=NWpY1d]", "div[class*=name i]", "span[class*=name i]"],
    // Nomes que significam "sou eu" (conta local) nas línguas que o Mario usa.
    selfNames: ["você", "voce", "you"],
    // Silêncio que fecha um turno (ms sem o texto do falante crescer).
    silenceMs: 2000,
    // Reobserva o DOM a cada tanto (o Meet recria a região ao ligar/desligar CC).
    rescanMs: 3000,
  };

  /** Estado do turno em construção, um por falante corrente. */
  let currentSpeaker = null;
  let currentText = "";
  let lastGrowthAt = 0;
  let turnIndex = 0;
  let startedAtMs = null; // carimbado quando a reunião inicia (overlay avisa)
  let observer = null;
  let observedRegion = null;
  let lastCaptionSeenAt = 0;

  function now() {
    return Date.now();
  }

  /** Segundos desde o início da reunião (0 se ainda não iniciou). */
  function elapsedSeconds() {
    if (startedAtMs === null) return 0;
    return Math.max(0, (now() - startedAtMs) / 1000);
  }

  function isSelfName(name) {
    const n = (name || "").trim().toLowerCase();
    return CONFIG.selfNames.some((s) => n === s || n.startsWith(s + " "));
  }

  function findCaptionRegion() {
    for (const sel of CONFIG.captionRegionSelectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    // Heurística de reserva: região aria-live com texto que muda — as legendas
    // são o único aria-live com frases longas na tela do Meet.
    const liveRegions = document.querySelectorAll('[aria-live="polite"], [aria-live="assertive"]');
    for (const el of liveRegions) {
      if ((el.textContent || "").trim().length > 30) return el;
    }
    return null;
  }

  /** Extrai [ { speaker, text } ] do estado atual da região de legendas. */
  function readCaptions(region) {
    const results = [];
    // Estratégia: o Meet agrupa "nome + parágrafo(s)". Procura elementos de nome
    // conhecidos; o texto é o restante do bloco pai.
    let nameEls = [];
    for (const sel of CONFIG.speakerNameSelectors) {
      nameEls = region.querySelectorAll(sel);
      if (nameEls.length > 0) break;
    }
    if (nameEls.length > 0) {
      for (const nameEl of nameEls) {
        const block = nameEl.parentElement;
        if (!block) continue;
        const name = (nameEl.textContent || "").trim();
        const text = (block.textContent || "").replace(name, "").trim();
        if (name && text) results.push({ speaker: name, text });
      }
      return results;
    }
    // Sem elemento de nome reconhecível: devolve o texto todo como falante
    // desconhecido — degrada sem parar (melhor turno anônimo que nenhum).
    const raw = (region.textContent || "").trim();
    if (raw) results.push({ speaker: "Desconhecido", text: raw });
    return results;
  }

  function closeTurn() {
    if (!currentSpeaker || !currentText.trim()) return;
    const turn = {
      i: turnIndex++,
      speaker: currentSpeaker,
      is_self: isSelfName(currentSpeaker),
      text: currentText.trim(),
      t: Math.round(elapsedSeconds()),
    };
    currentSpeaker = null;
    currentText = "";
    window.dispatchEvent(new CustomEvent("nexo-copiloto:turn", { detail: turn }));
  }

  function onCaptionsMutated() {
    const region = observedRegion;
    if (!region || !document.contains(region)) return;
    lastCaptionSeenAt = now();

    const captions = readCaptions(region);
    if (captions.length === 0) return;

    // O último bloco é quem está falando agora.
    const active = captions[captions.length - 1];

    if (currentSpeaker !== null && active.speaker !== currentSpeaker) {
      // Trocou o falante: o turno anterior terminou de fato.
      closeTurn();
    }
    if (active.speaker !== currentSpeaker) {
      currentSpeaker = active.speaker;
      currentText = active.text;
      lastGrowthAt = now();
      return;
    }
    if (active.text !== currentText) {
      // O Meet REESCREVE a frase enquanto refina o reconhecimento — o texto
      // atual substitui, não concatena.
      currentText = active.text;
      lastGrowthAt = now();
    }
  }

  function ensureObserver() {
    const region = findCaptionRegion();
    if (region === observedRegion && observer) return;
    if (observer) observer.disconnect();
    observedRegion = region;
    if (!region) return;
    observer = new MutationObserver(onCaptionsMutated);
    observer.observe(region, { childList: true, subtree: true, characterData: true });
    lastCaptionSeenAt = now();
  }

  // Fecha turno por silêncio + mantém o observer vivo + reporta saúde.
  setInterval(() => {
    if (currentSpeaker && now() - lastGrowthAt >= CONFIG.silenceMs) {
      closeTurn();
    }
    ensureObserver();
    window.dispatchEvent(
      new CustomEvent("nexo-copiloto:health", {
        detail: {
          captionsFound: observedRegion !== null,
          lastCaptionAgoMs: lastCaptionSeenAt ? now() - lastCaptionSeenAt : null,
        },
      }),
    );
  }, 1000);

  // O overlay avisa quando a reunião começa/termina (zera o relógio e o índice).
  window.addEventListener("nexo-copiloto:meeting-started", () => {
    startedAtMs = now();
    turnIndex = 0;
    currentSpeaker = null;
    currentText = "";
  });
  window.addEventListener("nexo-copiloto:meeting-ended", () => {
    closeTurn();
    startedAtMs = null;
  });
})();
