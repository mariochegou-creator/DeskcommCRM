"use client";
/**
 * As ações de contato: falar por WhatsApp, ligar, subir o áudio de uma ligação
 * feita por fora.
 *
 * Vive num componente só, usado na ficha do contato E no dossiê do negócio,
 * porque a decisão "como falo com esta pessoa agora" é a mesma nos dois lugares.
 * Duplicar os botões é como um dos dois fica para trás — e o que fica para trás
 * é sempre o do kanban, onde o SDR de fato trabalha.
 *
 * MOBILE x DESKTOP não é detalhe de layout, são fluxos diferentes: no celular o
 * botão disca (`tel:`), porque o telefone é o próprio aparelho; no computador
 * ele abre o gravador, porque a chamada acontece noutro aparelho e o computador
 * só testemunha.
 */
import { useRef, useState } from "react";

import { CallRecorderDialog } from "@/components/calls/CallRecorderDialog";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { uploadCallAudio, useStartCall } from "@/hooks/calls/useCalls";
import {
  CALL_AUDIO_ACCEPT,
  MAX_CALL_AUDIO_BYTES,
  isAllowedCallMime,
} from "@/lib/calls/storage";
import { toE164BR, toWhatsAppNumber } from "@/lib/calls/phone";
import { ChatCircle, Phone, UploadSimple, CircleNotch } from "@/lib/ui/icons";

interface Props {
  contactId: string;
  contactName: string;
  phoneNumber: string | null | undefined;
  company?: string | null;
  /** De onde partiu — só vai para o payload da atividade. */
  origin?: "contact" | "deal";
  /** Contato anonimizado (LGPD) não recebe ligação nem áudio novo. */
  disabled?: boolean;
}

/**
 * Toque grosso é celular. `pointer: coarse` acerta o caso real (telefone e
 * tablet) sem depender de largura de janela — uma janela estreita no desktop
 * não vira um aparelho que disca.
 */
function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

export function ContactActions({
  contactId,
  contactName,
  phoneNumber,
  company,
  origin = "contact",
  disabled = false,
}: Props) {
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const startCall = useStartCall(contactId);

  const phone = toE164BR(phoneNumber);
  const whatsapp = toWhatsAppNumber(phoneNumber);

  const handleLigar = () => {
    if (!phone) return;
    if (isMobile()) {
      // No celular a gravação pelo navegador não sobrevive à troca de app: o
      // discador vai para frente e o `MediaRecorder` é suspenso. Discar é o que
      // ele consegue fazer bem — e a atividade fica registrada do mesmo jeito.
      startCall.mutate(origin);
      window.location.href = `tel:${phone}`;
      return;
    }
    setRecorderOpen(true);
  };

  const handleArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite reescolher o mesmo arquivo depois de um erro
    if (!file) return;

    // As mesmas duas checagens do servidor, aqui só para dar resposta imediata.
    // A rota valida de novo — validação de cliente é cortesia, nunca a defesa.
    if (!isAllowedCallMime(file.type)) {
      showApiError(new Error("Formato de áudio não suportado."));
      return;
    }
    if (file.size > MAX_CALL_AUDIO_BYTES) {
      showApiError(
        new Error(`Áudio acima de ${Math.floor(MAX_CALL_AUDIO_BYTES / 1024 / 1024)} MB.`),
      );
      return;
    }

    setEnviando(true);
    try {
      const r = await startCall.mutateAsync(origin);
      await uploadCallAudio({ callId: r.data.call_id, blob: file, filename: file.name });
    } catch (err) {
      showApiError(err);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={!whatsapp || disabled}
        title={whatsapp ? undefined : "Contato sem telefone utilizável"}
        onClick={() => {
          if (whatsapp) window.open(`https://wa.me/${whatsapp}`, "_blank", "noopener,noreferrer");
        }}
      >
        <ChatCircle size={16} weight="bold" aria-hidden />
        <span>WhatsApp</span>
      </Button>

      <Button
        variant="outline"
        size="sm"
        disabled={!phone || disabled || startCall.isPending}
        title={phone ? undefined : "Contato sem telefone utilizável"}
        onClick={handleLigar}
      >
        <Phone size={16} weight="bold" aria-hidden />
        <span>Ligar</span>
      </Button>

      <Button
        variant="outline"
        size="sm"
        disabled={disabled || enviando}
        onClick={() => fileRef.current?.click()}
      >
        {enviando ? (
          <CircleNotch size={16} className="animate-spin" aria-hidden />
        ) : (
          <UploadSimple size={16} weight="bold" aria-hidden />
        )}
        <span>{enviando ? "Enviando…" : "Subir áudio da ligação"}</span>
      </Button>

      <input
        ref={fileRef}
        type="file"
        accept={CALL_AUDIO_ACCEPT}
        className="hidden"
        onChange={(e) => void handleArquivo(e)}
      />

      {phone && (
        <CallRecorderDialog
          open={recorderOpen}
          onOpenChange={setRecorderOpen}
          contactId={contactId}
          contactName={contactName}
          company={company}
          phoneE164={phone}
          origin={origin}
        />
      )}
    </div>
  );
}
