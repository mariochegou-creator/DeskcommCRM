-- 0110 — @menção na nota interna: o aviso que a nota nunca teve.
--
-- A nota interna (0063) é o lugar onde o time fala entre si dentro da conversa,
-- e o pedido que faltava é o mais simples que existe: "olha isso aqui". Hoje
-- escrever "@david" numa nota grava TEXTO — o David nunca fica sabendo, e a
-- tela de Configurações → Notificações lista a categoria "Você foi mencionado"
-- com a chave desligada desde sempre. Duas peças prometendo a mesma coisa e
-- nenhuma entregando.
--
-- POR QUE NÃO REUSAR `crm_tasks` (0101): tarefa tem DONO, PRAZO e cobrança —
-- aparece em /app/tarefas, vira número vermelho quando VENCE e fica pendurada
-- até alguém resolver. Menção não é trabalho devido, é um toque no ombro: some
-- assim que a pessoa olha. Gravar menção como tarefa faria a lista de tarefas
-- mentir sobre o que está devido, que é exatamente o número que precisa ser
-- verdadeiro para continuar sendo olhado.
--
-- UMA COLUNA, NÃO DUAS, E NENHUMA TABELA: `mentions` é *quem ainda não viu*.
-- Marcar como visto REMOVE o id do array (`array_remove`), e é a mesma doutrina
-- da 0101 — o aviso É a linha, não existe em outro lugar. Um `read_by` ao lado
-- seria segunda fonte para "o David já viu?", com o risco clássico das duas
-- discordarem e o aviso continuar aceso depois de lido. O registro de que
-- alguém FOI mencionado não se perde: está no corpo da nota, escrito ("@David"),
-- que é onde um humano procura.
--
-- SEM FK (array não aceita): id de quem saiu da organização simplesmente para
-- de ser lido — a consulta filtra por `auth.uid()`, e ninguém mais enxerga
-- aquele id. Lixo invisível, não vazamento.
--
-- FORA da cascata LGPD, de propósito: a coluna guarda id de USUÁRIO DO CRM
-- (operador), nunca do titular. O conteúdo da nota, esse sim sobre o titular,
-- continua coberto onde já estava.
--
-- Índice GIN porque a única leitura é `mentions @> [uid]` — o sino do topo
-- pergunta isso a cada 60s por operador com a aba aberta.
--
-- FORA do realtime: a tela lê por React Query com refetch, mesma escolha da
-- 0101. Publicar sem consumidor é o que o teste da 0078 impede.

alter table conversation_notes
  add column if not exists mentions uuid[] not null default '{}';

create index if not exists idx_conversation_notes_mentions
  on conversation_notes using gin (mentions);

comment on column conversation_notes.mentions is
  'Usuários citados com @ que AINDA NÃO viram o aviso. Ver a menção remove o id (array_remove). Vazio = ninguém pendente.';
