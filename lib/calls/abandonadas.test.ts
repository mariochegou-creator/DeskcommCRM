import { describe, expect, it } from "vitest";

import { ABANDONO_MINUTOS, ligacaoAbandonada } from "./abandonadas";

const AGORA = new Date("2026-08-25T18:00:00.000Z");
const minutosAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000).toISOString();

describe("ligacaoAbandonada — a gravação cujo áudio nunca subiu", () => {
  it("é abandonada quando está em pending, sem áudio, e calada há tempo demais", () => {
    // O caso real: a ligação de 25/08 às 15:29, com transcrição ao vivo e
    // nenhum `storage_path`.
    expect(
      ligacaoAbandonada(
        { status: "pending", storage_path: null, updated_at: minutosAtras(ABANDONO_MINUTOS + 1) },
        AGORA,
      ),
    ).toBe(true);
  });

  it("NÃO é abandonada enquanto a ligação ainda dá sinal de vida", () => {
    // Cada bloco ao vivo toca a linha; uma ligação em andamento nunca fica
    // calada por muito tempo.
    expect(
      ligacaoAbandonada(
        { status: "pending", storage_path: null, updated_at: minutosAtras(2) },
        AGORA,
      ),
    ).toBe(false);
  });

  it("NÃO é abandonada quando o áudio chegou — mesmo que o status ainda não tenha virado", () => {
    expect(
      ligacaoAbandonada(
        { status: "pending", storage_path: "org/contato/ligacao.webm", updated_at: minutosAtras(90) },
        AGORA,
      ),
    ).toBe(false);
  });

  it("não mexe em ligação que já saiu de pending", () => {
    for (const status of ["transcribing", "done", "failed", "done_unformatted"]) {
      expect(
        ligacaoAbandonada({ status, storage_path: null, updated_at: minutosAtras(600) }, AGORA),
      ).toBe(false);
    }
  });

  it("linha sem updated_at fica quieta em vez de virar falha por engano", () => {
    expect(
      ligacaoAbandonada({ status: "pending", storage_path: null, updated_at: null }, AGORA),
    ).toBe(false);
  });
});
