"use client";
import { TagsEditor } from "@/components/ui/tags-editor";
import {
  useUpdateConversationTags,
  useConversationTagVocabulary,
} from "@/hooks/inbox/useConversationTags";

interface Props {
  conversationId: string;
  orgId: string;
  tags: string[];
}

/** G3-05: aplica/remove tags de atendimento na conversa, com sugestão canônica. */
export function ConversationTagsEditor({ conversationId, orgId, tags }: Props) {
  const mutation = useUpdateConversationTags();
  const { data: vocabulary } = useConversationTagVocabulary(orgId);

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Tags da conversa
      </h3>

      <div className="mt-2">
        {/* Os chips são os MESMOS do bloco do negócio, logo acima na coluna:
            dois controles com o mesmo desenho e comportamentos diferentes
            seriam lidos como duas ideias. Normalização espelha o Zod do PATCH
            (trim + minúsculas); a dedup sai do próprio editor. */}
        <TagsEditor
          tags={tags}
          alvo="à conversa"
          normalizar={(t) => t.toLowerCase()}
          sugestoes={vocabulary ?? []}
          disabled={mutation.isPending}
          onChange={(proximas) =>
            mutation.mutate({ conversation_id: conversationId, tags: proximas })
          }
        />
      </div>
    </section>
  );
}
