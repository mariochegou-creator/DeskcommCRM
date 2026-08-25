-- 0109 — a gaveta de salvos passa a guardar FOTO, não só áudio
--
-- Motivo: o vendedor manda o MESMO print o dia inteiro — o resultado da
-- pesquisa do Google mostrando que o lead não aparece na primeira página.
-- Procurar o arquivo no computador a cada conversa é o custo. A gaveta que já
-- existe pro áudio (0095) resolve igual: guarda uma vez, reenvia sempre.
--
-- Por que NÃO tem coluna `kind`: o media_mime já diz o que a linha é
-- (audio/% x image/%). Uma coluna a mais seria um segundo lugar pra mesma
-- verdade — e um lugar a mais pra elas divergirem.
--
-- Por que NÃO tem tabela nova: RLS, trigger de carimbo, unique de
-- storage_path e a rota de attach (que COPIA o objeto pra pasta da conversa,
-- mantendo isMediaPathOwnedBy intacto) já estão prontos e valem igual pros
-- dois. Tabela nova seria a mesma doutrina escrita duas vezes.
--
-- ⚠️ O nome `saved_audios` fica: renomear tabela + rotas + hooks seria churn
-- sem ganho pra quem usa. Na tela o botão chama "Áudios e fotos salvos".

alter table public.saved_audios drop constraint if exists saved_audios_mime_audio_check;
alter table public.saved_audios drop constraint if exists saved_audios_mime_check;
alter table public.saved_audios add constraint saved_audios_mime_check
  check (media_mime like 'audio/%' or media_mime like 'image/%');

comment on table public.saved_audios is
  'Salvos reenviáveis do composer: áudio (PTT) e foto. O tipo sai do media_mime, não de coluna. Binário no bucket whatsapp-media sob {org}/library/; o envio copia pra pasta da conversa. owner_user_id null = compartilhado da org, espelhando message_templates (0060).';

-- duration_seconds já era nullable (0095): foto simplesmente não preenche.
comment on column public.saved_audios.duration_seconds is
  'Segundos do áudio, medidos no browser. Null em foto — e em áudio salvo antes de a UI medir.';
