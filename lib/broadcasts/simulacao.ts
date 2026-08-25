/**
 * Simulação do gate de spinning para o dry-run do disparador (0108).
 *
 * A pergunta do operador na tela de revisão é "esse texto vai ser vetado?", e a
 * única resposta honesta vem do MOTOR REAL: `decideSpinning` rodando sobre a
 * sequência de mensagens que a campanha geraria, na ordem, com a mesma janela e
 * os mesmos knobs da produção. A primeira versão media o pior par de variantes
 * com um Jaccard próprio — media a coisa errada (ver o rodapé de `spintax.ts`)
 * e era uma segunda implementação do mesmo cálculo, que ia divergir do gate na
 * primeira mudança dele.
 *
 * A simulação expande o template N vezes (N = tamanho do público, com teto),
 * variando `{{nome}}`/`{{negocio}}` como a produção varia — nomes diferentes por
 * destinatário — e pergunta ao gate, envio a envio, se ele deixaria passar.
 * Determinística de propósito (LCG semeado pelo índice do envio, mesma técnica
 * de `amostraDeVariantes`): o operador que reabre a tela vê o mesmo veredito.
 *
 * O que ela NÃO simula: o tráfego real do número (IA + inbox manual entram na
 * mesma janela em produção). Ou seja, o veredito daqui é o piso — se a
 * simulação já veta, a produção veta com certeza.
 */
import {
  decideSpinning,
  hashNormalized,
  normalizeCopy,
  type RecentCopy,
} from "@/lib/agent-engine/spinning/engine";
import {
  SPINNING_DEFAULTS,
  type SpinningKnobs,
} from "@/lib/agent-engine/spinning/defaults";
import { expandirSpintax, type VariaveisDoDestinatario } from "./spintax";

/**
 * Nomes de amostra rodando por envio. Importa que VARIEM: se a simulação usasse
 * o mesmo nome sempre, um template "só {{nome}}" apareceria como texto idêntico
 * por hash — vetado pelo motivo errado. Com nomes distintos ele é vetado pelo
 * motivo certo: uma palavra diferente em vinte não derruba o Jaccard.
 */
const NOMES_DE_AMOSTRA = [
  "Ana",
  "Bruno",
  "Carla",
  "Diego",
  "Elisa",
  "Fábio",
  "Helena",
  "Igor",
  "Júlia",
  "Marcos",
  "Patrícia",
  "Renato",
] as const;

const NEGOCIOS_DE_AMOSTRA = [
  "Loja do Bairro",
  "Auto Center Silva",
  "Ótica Central",
  "Padaria Estrela",
  "Studio Fit",
  "Mercado Bom Preço",
  "Clínica Sorriso",
] as const;

export interface SimulacaoDeSpinning {
  /** O gate vetaria algum envio desta sequência. */
  vetaria: boolean;
  /** Em qual envio (1 = o primeiro) o veto cairia; null quando passa. */
  envioDoVeto: number | null;
  /** Quantos envios a simulação percorreu (o público, com teto). */
  enviosSimulados: number;
}

/**
 * Roda o gate de spinning sobre os primeiros `envios` disparos do template.
 *
 * `envios` default = janela + 1: além disso as copies mais velhas já saíram da
 * janela e o comportamento se repete. O chamador passa o tamanho real do
 * público quando ele é menor — para 2 destinatários até texto fixo passa, e a
 * tela deve dizer isso em vez de assustar.
 */
export function simularSpinning(
  template: string,
  opts: { envios?: number; knobs?: SpinningKnobs } = {},
): SimulacaoDeSpinning {
  const knobs = opts.knobs ?? SPINNING_DEFAULTS;
  const envios = Math.max(1, Math.min(opts.envios ?? knobs.windowSize + 1, 500));

  /** Mais recente primeiro — o contrato de `SpinningInput.window`. */
  const janela: RecentCopy[] = [];

  for (let i = 0; i < envios; i += 1) {
    // LCG semeado pelo índice do envio: mesma entrada, mesma sequência.
    let passo = i * 7919 + 17;
    const rng = (): number => {
      passo = (passo * 1103515245 + 12345) % 2147483648;
      return passo / 2147483648;
    };
    const vars: VariaveisDoDestinatario = {
      nome: NOMES_DE_AMOSTRA[i % NOMES_DE_AMOSTRA.length],
      negocio: NEGOCIOS_DE_AMOSTRA[i % NEGOCIOS_DE_AMOSTRA.length],
    };
    const candidata = expandirSpintax(template, vars, rng);

    const decisao = decideSpinning({ candidate: candidata, window: janela, knobs });
    if (!decisao.allow) {
      return { vetaria: true, envioDoVeto: i + 1, enviosSimulados: i + 1 };
    }

    const normalizada = normalizeCopy(candidata);
    janela.unshift({
      normalizedText: normalizada,
      normalizedHash: hashNormalized(normalizada),
    });
    if (janela.length > knobs.windowSize) janela.pop();
  }

  return { vetaria: false, envioDoVeto: null, enviosSimulados: envios };
}
