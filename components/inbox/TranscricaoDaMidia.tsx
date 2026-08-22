"use client";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/types/messaging";

/**
 * O que o áudio DIZ, escrito embaixo do play.
 *
 * O texto já existia: o worker de mídia transcreve o áudio e guarda em
 * `media_derived_text`, e é assim que a IA "ouve" o que o cliente mandou. Quem
 * atendia é que não via — o mesmo áudio que o agente entendia continuava sendo,
 * para o humano, um play que ele precisa parar tudo para escutar. Era o dado
 * mais caro do produto sendo lido por uma máquina e escondido de uma pessoa.
 *
 * ⚠️ O RÓTULO É OBRIGATÓRIO, e não é decoração. Sem ele o texto vira uma
 * segunda mensagem: quem lê o histórico depois não tem como saber que aquilo é
 * máquina transcrevendo — e transcrição erra nome próprio, número e valor.
 * Atribuir ao cliente uma frase que ele não disse exatamente assim é pior do que
 * não mostrar nada.
 *
 * ⚠️ «TRANSCREVENDO» E «NÃO DEU» SÃO ESTADOS DIFERENTES E AMBOS APARECEM. O
 * derivado nasce segundos depois da mensagem, num worker separado; sem o estado
 * de espera, o áudio que ainda não voltou é indistinguível do que falhou, e as
 * duas leituras pedem ações opostas — uma é aguardar, a outra é dar o play.
 */
const ROTULO: Record<string, string> = {
  audio: "Transcrição do áudio",
  video: "Transcrição do vídeo",
  image: "Descrição da imagem",
  document: "Texto do arquivo",
};

const AGUARDANDO: Record<string, string> = {
  audio: "Transcrevendo o áudio…",
  video: "Transcrevendo o vídeo…",
  image: "Lendo a imagem…",
  document: "Lendo o arquivo…",
};

export function TranscricaoDaMidia({
  message,
  isOutbound,
}: {
  message: Message;
  isOutbound: boolean;
}) {
  const rotulo = ROTULO[message.type];
  // Tipo sem rótulo (figurinha, contato) não tem derivado que interesse ler.
  if (!rotulo) return null;

  const texto = message.media_derived_text?.trim() ?? "";
  const status = message.media_derived_status;

  // Mensagem antiga, de antes desta coluna existir: `status` nulo e sem texto.
  // Não inventa "transcrevendo…" para um áudio que nunca vai voltar.
  if (!texto && status !== "pending" && status !== "failed") return null;

  const moldura = cn(
    "mt-1.5 border-t pt-1.5 text-[13px] leading-snug",
    isOutbound ? "border-primary-foreground/25" : "border-foreground/12",
  );
  const legenda = cn(
    "mb-0.5 text-[10px] font-semibold uppercase tracking-wide",
    isOutbound ? "text-primary-foreground/65" : "text-muted-foreground",
  );

  if (!texto) {
    return (
      <div className={moldura} data-testid="transcricao-estado">
        <p className={cn(legenda, "mb-0 normal-case tracking-normal")}>
          {status === "failed"
            ? "Não deu para transcrever — dá o play para ouvir."
            : (AGUARDANDO[message.type] ?? "Lendo…")}
        </p>
      </div>
    );
  }

  return (
    <div className={moldura} data-testid="transcricao-da-midia">
      <p className={legenda}>{rotulo}</p>
      <p
        className={cn(
          "whitespace-pre-wrap break-words",
          isOutbound ? "text-primary-foreground/90" : "text-foreground/85",
        )}
      >
        {texto}
      </p>
    </div>
  );
}
