/**
 * O toque do copiloto: duas notas curtas, geradas na hora.
 *
 * ⚠️ SEM ARQUIVO DE ÁUDIO de propósito. Um mp3 seria mais um asset para servir,
 * versionar e carregar antes de tocar — para 200 milissegundos de bip. O
 * oscilador do navegador faz o mesmo som sem baixar nada e sem atrasar o aviso.
 *
 * ⚠️ NAVEGADOR BLOQUEIA SOM ANTES DO PRIMEIRO CLIQUE na página, e isso não é
 * defeito a contornar: é a regra. Quando o contexto vem suspenso a função sai
 * calada em vez de insistir — o aviso visual já está na tela, e o pior desfecho
 * aceitável é o som não sair, nunca um erro no console a cada notificação.
 */

type ComWebkit = typeof globalThis & { webkitAudioContext?: typeof AudioContext };

let contexto: AudioContext | null = null;

function pegarContexto(): AudioContext | null {
  if (contexto) return contexto;
  const Ctor = window.AudioContext ?? (window as ComWebkit).webkitAudioContext;
  if (!Ctor) return null;
  try {
    contexto = new Ctor();
    return contexto;
  } catch {
    return null;
  }
}

function nota(ctx: AudioContext, hz: number, comeca: number, dura: number, volume: number): void {
  const osc = ctx.createOscillator();
  const ganho = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = hz;
  // Sobe e desce em rampa: onda que começa e termina no talo estala no alto-falante.
  ganho.gain.setValueAtTime(0.0001, comeca);
  ganho.gain.exponentialRampToValueAtTime(volume, comeca + 0.012);
  ganho.gain.exponentialRampToValueAtTime(0.0001, comeca + dura);
  osc.connect(ganho).connect(ctx.destination);
  osc.start(comeca);
  osc.stop(comeca + dura + 0.02);
}

/**
 * Duas notas subindo — o desenho de "chegou algo", não de "deu erro". Curto:
 * som de aviso que dura mais que meio segundo vira som que se desliga.
 */
export function tocarAviso(): void {
  const ctx = pegarContexto();
  if (!ctx || ctx.state === "suspended") return;
  const agora = ctx.currentTime;
  nota(ctx, 880, agora, 0.09, 0.05);
  nota(ctx, 1174.7, agora + 0.1, 0.13, 0.045);
}
