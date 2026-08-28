"use client";
import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import { PaperPlaneTilt } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import { AttachMenu } from "@/components/inbox/composer/AttachMenu";
import { AttachmentPreviewDialog } from "@/components/inbox/composer/AttachmentPreviewDialog";
import { AudioRecorder } from "@/components/inbox/composer/AudioRecorder";
import { DraftReplyButton } from "@/components/inbox/composer/DraftReplyButton";
import { EmojiButton } from "@/components/inbox/composer/EmojiButton";
import { SavedAudioMenu } from "@/components/inbox/composer/SavedAudioMenu";
import { filtrarMembros, MencaoMenu } from "@/components/inbox/composer/MencaoMenu";
import { resolveSlash, TemplateMenu } from "@/components/inbox/composer/TemplateMenu";
import { useAssignableMembers, type AssignableMember } from "@/hooks/inbox/useAssignableMembers";
import { useCreateNote } from "@/hooks/inbox/useCreateNote";
import { useMessageTemplates, type MessageTemplate } from "@/hooks/inbox/useMessageTemplates";
import { useSendMessage } from "@/hooks/inbox/useSendMessage";
import { useUploadMedia } from "@/hooks/inbox/useUploadMedia";
import { interpolateTemplate } from "@/lib/inbox/template-vars";
import { acharMencionados, resolveArroba } from "@/lib/notes/mencoes";
import { cn } from "@/lib/utils";

export interface ComposerHandle {
  focus: () => void;
}

interface Props {
  conversationId: string;
  disabled?: boolean;
  /**
   * Por que não dá para escrever: contato bloqueado/anonimizado, conversa
   * fechada. Preenchido → o composer sai do ar e o texto aparece no lugar dele.
   *
   * Desligar os botões calado é o que vira "não está clicando" — a barra fica
   * inteira na tela, com aparência normal, e nada responde.
   */
  lockedReason?: string | null;
  /** Nome do contato da conversa, para interpolar {{nome}}/{{primeiro_nome}} do template escolhido. */
  contactName?: string | null;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { conversationId, disabled, lockedReason, contactName },
  ref,
) {
  const [text, setText] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const send = useSendMessage();
  const upload = useUploadMedia();
  const createNote = useCreateNote();
  const templates = useMessageTemplates();
  const slash = resolveSlash(text);
  const menuOpen = mode === "reply" && slash.open && !menuDismissed;

  // 0110 — o menu de @. Só em nota, e a lista só é buscada nesse modo: quem
  // nunca abre nota não paga a consulta.
  const [arroba, setArroba] = useState({ open: false, query: "", inicio: -1 });
  const membros = useAssignableMembers(mode === "note");
  const arrobaOpen = mode === "note" && arroba.open;
  const membrosFiltrados = filtrarMembros(membros.data ?? [], arroba.query);

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
  }));

  const isDisabled =
    disabled || !!lockedReason || send.isPending || upload.isPending || createNote.isPending;

  function autoresize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }

  function handleSubmit() {
    const body = text.trim();
    if (!body || isDisabled) return;
    if (mode === "note") {
      // O nome é resolvido para id AQUI porque a tela é quem tem a lista aberta.
      // Vale tanto pro que foi escolhido no menu quanto pro que foi digitado à
      // mão — "@david" batido direto marca o David do mesmo jeito.
      createNote.mutate(
        {
          conversation_id: conversationId,
          body,
          mentions: acharMencionados(body, membros.data ?? []),
        },
        {
          onSuccess: () => {
            setText("");
            setArroba({ open: false, query: "", inicio: -1 });
            requestAnimationFrame(() => autoresize());
          },
        },
      );
      return;
    }
    send.mutate(
      { conversation_id: conversationId, body, type: "text" },
      {
        onSuccess: () => {
          setText("");
          requestAnimationFrame(() => autoresize());
        },
      },
    );
  }

  function applyTemplate(t: MessageTemplate) {
    const filled = interpolateTemplate(t.body, { name: contactName ?? null });
    setText(filled);
    setMenuDismissed(true);
    const ta = taRef.current;
    if (!ta) return;
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = filled.length;
      autoresize();
    });
  }

  /** Troca o `@dav` que estava sendo digitado pelo nome inteiro + espaço. */
  function aplicarMencao(m: AssignableMember) {
    const ta = taRef.current;
    const cursor = ta?.selectionStart ?? text.length;
    const inicio = arroba.inicio;
    if (inicio < 0 || !m.full_name) return;
    const inserido = `@${m.full_name} `;
    const next = text.slice(0, inicio) + inserido + text.slice(cursor);
    setText(next);
    setArroba({ open: false, query: "", inicio: -1 });
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = inicio + inserido.length;
      autoresize();
    });
  }

  function applyDraft(draft: string) {
    // O rascunho é uma resposta COMPLETA sugerida — substitui o conteúdo, nunca
    // concatena (inserir no cursor grudaria dois textos completos, gerando uma
    // mensagem sem sentido). O vendedor edita/envia a partir daqui.
    setText(draft);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      autoresize();
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape" && menuOpen) {
      setMenuDismissed(true);
      return;
    }
    if (e.key === "Escape" && arrobaOpen) {
      setArroba({ open: false, query: "", inicio: -1 });
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Com o menu de @ aberto, Enter ESCOLHE o primeiro da lista em vez de
      // enviar. Sem isso a nota sairia com "@dav" pela metade — e o `/` pode se
      // dar ao luxo de só ignorar o Enter porque um comando ocupa o texto
      // inteiro; o `@` fica no meio de uma frase que a pessoa quer terminar.
      if (arrobaOpen) {
        const primeiro = membrosFiltrados[0];
        if (primeiro) aplicarMencao(primeiro);
        return;
      }
      if (menuOpen) return; // deixa o Enter pro menu; não envia /query como mensagem
      handleSubmit();
    }
  }

  if (lockedReason) {
    return (
      <div className="border-t border-border bg-muted/40 px-4 py-3 text-center text-xs text-muted-foreground">
        {lockedReason}
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "relative border-t border-border bg-background px-3 py-2",
          mode === "note" && "border-warning/40 bg-warning-bg",
        )}
      >
        <MencaoMenu
          open={arrobaOpen}
          query={arroba.query}
          membros={membros.data ?? []}
          onPick={aplicarMencao}
        />
        <TemplateMenu
          open={menuOpen}
          query={slash.query}
          templates={templates.data ?? []}
          onPick={applyTemplate}
          onClose={() => setMenuDismissed(true)}
        />
        <div className="mb-1.5 flex gap-1">
          <button
            type="button"
            onClick={() => setMode("reply")}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              mode === "reply"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            Responder
          </button>
          <button
            type="button"
            onClick={() => setMode("note")}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              mode === "note"
                ? "bg-warning text-warning-fg"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            Nota interna
          </button>
        </div>
        <div className="flex items-end gap-2">
          {mode === "reply" && <AttachMenu disabled={isDisabled} onPick={setPendingFile} />}
          {mode === "reply" && (
            <DraftReplyButton conversationId={conversationId} disabled={isDisabled} onDraft={applyDraft} />
          )}
          {mode === "reply" && (
            <SavedAudioMenu
              conversationId={conversationId}
              disabled={isDisabled}
              caption={text}
              onSent={() => {
                setText("");
                requestAnimationFrame(() => autoresize());
              }}
            />
          )}
          <EmojiButton
            disabled={isDisabled}
            onPick={(emoji) => {
              const ta = taRef.current;
              if (!ta) {
                setText((t) => t + emoji);
                return;
              }
              const start = ta.selectionStart ?? text.length;
              const end = ta.selectionEnd ?? text.length;
              const next = text.slice(0, start) + emoji + text.slice(end);
              setText(next);
              requestAnimationFrame(() => {
                ta.focus();
                ta.selectionStart = ta.selectionEnd = start + emoji.length;
                autoresize();
              });
            }}
          />
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (!resolveSlash(e.target.value).open) setMenuDismissed(false);
              // O `@` vale em qualquer ponto do texto, então o estado do menu
              // sai da POSIÇÃO DO CURSOR, não do começo da string.
              setArroba(resolveArroba(e.target.value, e.target.selectionStart ?? 0));
              autoresize();
            }}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={
              mode === "note"
                ? "Escreva uma nota interna… (só o time vê)"
                : "Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)"
            }
            className={cn(
              "min-h-9 max-h-40 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm",
              "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
            )}
            disabled={isDisabled}
            aria-label="Mensagem"
          />
          {text.trim() || mode === "note" ? (
            <Button
              type="button"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={handleSubmit}
              disabled={isDisabled || !text.trim()}
              aria-label="Enviar"
            >
              <PaperPlaneTilt size={16} weight="fill" aria-hidden />
            </Button>
          ) : (
            <AudioRecorder conversationId={conversationId} disabled={isDisabled} />
          )}
        </div>
      </div>
      <AttachmentPreviewDialog
        file={pendingFile}
        sending={upload.isPending || send.isPending}
        onCancel={() => setPendingFile(null)}
        onSend={async (caption) => {
          if (!pendingFile) return;
          try {
            const uploaded = await upload.mutateAsync({ conversationId, file: pendingFile });
            send.mutate(
              {
                conversation_id: conversationId,
                type: uploaded.kind,
                body: caption || undefined,
                media_storage_path: uploaded.storage_path,
                media_mime: uploaded.media_mime,
                media_size_bytes: uploaded.media_size_bytes,
              },
              { onSuccess: () => setPendingFile(null) },
            );
          } catch {
            // toast já disparado pelo onError de useUploadMedia; dialog fica aberto p/ retry
            return;
          }
        }}
      />
    </>
  );
});
