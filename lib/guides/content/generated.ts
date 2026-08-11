// GERADO POR scripts/build-guides.mjs — NÃO EDITAR À MÃO.
// Fonte da verdade: docs/guias/*.md. Editou o guia? rode `node scripts/build-guides.mjs`.

export interface RawGuide {
  slug: string;
  title: string;
  description: string;
  audience: string;
  minutes: number;
  sourceFile: string;
  source: string;
}

export const RAW_GUIDES: RawGuide[] = [
  {
    slug: "crm-completo",
    title: "Guia completo do CRM",
    description: "Do zero à operação com IA: a ideia, cada tela passo a passo, a rotina do dia a dia e os problemas comuns.",
    audience: "Todo o time",
    minutes: 45,
    sourceFile: "docs/guias/crm-completo.md",
    source: `# Guia completo do CRM — do zero à operação com IA

> Guia de uso do DeskcommCRM (base do Nexo IA): o que é, como pensar, e o passo a passo de cada tela.
> Escrito a partir do código real do produto — rotas, permissões, botões e regras conferidos no repositório.


# Parte I — Entender

## 1. A ideia em uma página

A maioria dos CRMs é um **arquivo**: você registra o que já aconteceu. Este é um **sistema operacional de vendas**: ele participa do que está acontecendo.

A diferença prática está em três frases:

**a) O WhatsApp é o produto, não um anexo.** A conversa não é "um canal integrado" — é onde o negócio acontece. Por isso o Inbox é a primeira tela da barra lateral, e cada mensagem já nasce ligada a um contato, a uma conversa e (quando existe) a um negócio no funil.

**b) A IA é operadora, não enfeite.** Um agente publicado atende sozinho no WhatsApp, consulta a base de conhecimento da sua empresa, qualifica, move o cartão no funil, agenda retomadas e — quando trava — abre um caso para um humano resolver. Ele é dono de negócio com o mesmo status de uma pessoa do time: o cartão mostra "dono: IA" do mesmo jeito que mostraria "dono: Marina".

**c) Nada morre em silêncio.** Esta é a regra de projeto mais importante do produto e explica metade das telas. Um negócio que esfriou vira **estado** (Radar), não um adjetivo que aparece só se alguém abrir a tela certa. Uma promessa com prazo que vence vira **item de caixa** com dono e ação nomeada. Uma pontuação de probabilidade só é gravada se vier com o **motivo em português e a evidência clicável** — número sem porquê não entra no banco. Quando a IA afirma algo na linha do tempo, existe o registro da execução que sustenta a afirmação.

O resultado é um sistema em que **cada coisa esquecida reaparece em algum lugar com um responsável**, em vez de virar um cartão parado que ninguém nota.

### As quatro telas que resumem o produto

| Tela | Pergunta que ela responde |
|---|---|
| **Inbox** | Quem está falando comigo *agora*? |
| **Kanban** | Onde está cada negócio e o que falta para fechar? |
| **Radar** | O que está morrendo sem ninguém ver? |
| **Agentes IA** | Quem trabalha por mim quando eu não estou? |

Todo o resto é apoio a essas quatro.

---

## 2. O vocabulário do sistema

Ler esta tabela poupa metade das dúvidas depois.

| Termo | O que é | Onde vive |
|---|---|---|
| **Organização** | Sua empresa dentro do sistema (o "tenant"). Todo dado é isolado por ela. | \`Configurações › Organização\` |
| **Contato** | A **pessoa** do outro lado. Telefone, e-mail, consentimentos, histórico. | \`Contatos\` |
| **Conversa** | O fio de mensagens de WhatsApp com um contato, num número específico. | \`Inbox\` |
| **Negócio / Lead** | A **oportunidade**. Um contato pode ter vários negócios (a pessoa não é a venda). | \`Kanban\` |
| **Funil (pipeline)** | Um processo de venda com etapas. Você pode ter mais de um. | \`Configurações › Organização › Funis\` |
| **Etapa (stage)** | Coluna do Kanban. Uma pode ser marcada como *ganho*, uma como *perda*. | idem |
| **Vocabulário do funil** | Renomeia os conceitos por nicho: "lead" vira *Paciente*, "ganho" vira *Agendado*. | idem |
| **Número / Sessão** | Um número de WhatsApp conectado. Você pode ter vários. | \`Conexões\` |
| **Agente de IA** | A identidade do assistente (nome, prioridade, se está ativo). | \`Agentes IA\` |
| **Versão do agente** | A configuração congelada. Publicada = imutável. Mudança = versão nova. | dentro do agente |
| **Publicar** | Apontar o agente para uma versão. É o que faz a IA entrar no ar. | idem |
| **Conhecimento (RAG)** | Os textos da sua empresa que a IA consulta antes de responder. | \`Agentes IA › conhecimento\` |
| **Memória da organização** | Documento versionado com o que *toda* IA da casa deve saber. | \`Memória da IA\` |
| **Skill** | Playbook situacional que só carrega quando a situação acontece. | \`Skills da IA\` |
| **Roteador** | Distribui a conversa entre agentes por intenção declarada. | \`Roteadores\` |
| **Follow-up** | Fluxo de retomada: espera, condição, mensagem, fim. | \`Follow-ups\` |
| **Caso** | A IA travou e pediu ajuda humana, com contexto. | \`Agentes IA › Casos\` |
| **Item de caixa** | Um aviso do sistema com dono e ação (número morto, orçamento estourado, promessa vencida). | \`Caixa da IA\` |
| **Papel (role)** | \`viewer\` < \`agent\` < \`manager\` < \`admin\`. Hierárquico. | \`Equipe\` |

**A distinção que mais gera confusão:** *contato* é a pessoa, *negócio* é a venda. Se o mesmo cliente compra três vezes, é **um contato e três negócios**. Se você tratar contato como negócio, o funil deixa de significar algo.

---

## 3. Papéis e o que cada um pode fazer

Os papéis são hierárquicos: \`admin\` pode tudo que \`manager\` pode, e assim por diante.

| Ação | viewer | agent | manager | admin |
|---|:--:|:--:|:--:|:--:|
| Ver Inbox | ✅ | ✅ | ✅ | ✅ |
| Responder / assumir conversa | — | ✅ | ✅ | ✅ |
| Ver contatos | ✅ | ✅ | ✅ | ✅ |
| Criar / editar contato | — | ✅ | ✅ | ✅ |
| Excluir contato | — | — | ✅ | ✅ |
| Ver funil | ✅ | ✅ | ✅ | ✅ |
| Mover cartão | — | ✅ | ✅ | ✅ |
| Criar / editar funis e etapas | — | — | ✅ | ✅ |
| Ver auditoria | — | — | ✅ | ✅ |
| Webhooks e automações | — | — | ✅ | ✅ |
| Ver Agentes IA / Roteadores / Memória / Skills / Evolução | — | — | ✅ | ✅ |
| Criar/editar agente, publicar versão | — | — | — | ✅ |
| Gerenciar credenciais de IA | — | — | — | ✅ |
| Gerenciar roteadores | — | — | — | ✅ |
| Convidar pessoas / trocar papel | — | — | — | ✅ |
| Configurações da organização | — | — | — | ✅ |
| LGPD (anonimizar) | — | — | — | ✅ |
| Instalar/gerenciar skills | — | — | ✅ | ✅ |

**Detalhes que importam na prática:**

- Itens sem permissão **não aparecem na barra lateral** e a rota é bloqueada no servidor — não é só esconder botão.
- Existe um **escopo de visualização** por atendente, configurado por organização, com três modos: \`all\` (vê tudo), \`own_and_unassigned\` (vê o que é seu + a fila — **padrão**) e \`own\` (só o que é seu). Ele restringe **apenas o papel \`agent\`**: \`viewer\`, \`manager\` e \`admin\` continuam vendo a organização inteira. Vale para conversas *e* para negócios no funil.
- \`viewer\` é leitura pura: serve para sócio, contador, auditor.

---

# Parte II — Ligar

## 4. Primeiro acesso e onboarding

O onboarding tem cinco passos e o sistema lembra onde você parou (a organização só é marcada como "onboarded" no final).

**Passo 1 — Boas-vindas.** Confirme nome de exibição da empresa, fuso horário e idioma. O fuso não é detalhe decorativo: ele define a janela de horário de envio da IA e os relatórios.

**Passo 2 — Conectar WhatsApp.** Detalhado na seção 5. Pode ser pulado e feito depois em \`Conexões\`.

**Passo 3 — Conectar Nuvemshop** (opcional; só faz sentido para e-commerce). Autorização OAuth na loja; a partir daí pedidos e produtos entram no CRM.

**Passo 4 — Configurar IA.** Cria o primeiro agente. Também pode ser feito depois com muito mais controle em \`Agentes IA\` — recomendo fazer *depois*, com calma, seguindo a Parte IV deste guia.

**Passo 5 — Convidar o time.** Envia convites por e-mail. Requer serviço de e-mail configurado no servidor (\`RESEND_API_KEY\`); sem ele a tela avisa e você adiciona as pessoas depois em \`Equipe\`.

> **Se você é quem instalou o sistema:** antes do onboarding, confirme que a rotina de minuto (\`/api/v1/cron/event-log-drain\`) está ativa. Sem ela, os eventos empilham e **nenhuma automação roda** — e o sintoma é silencioso: tudo parece salvo, nada dispara. No kit de instalação da HostGator isso é configurado automaticamente.

---

## 5. Conectar o WhatsApp (\`Conexões\`)

Esta é a tela com o **pontinho de saúde** ao lado do nome na barra lateral. Verde = número trabalhando.

### Conectar

1. Vá em \`Conexões\` e crie uma sessão (um número).
2. O sistema mostra um **QR Code**. Abra o WhatsApp no celular → *Aparelhos conectados* → *Conectar aparelho* → escaneie.
3. O status passa por \`STARTING\` → \`SCAN_QR_CODE\` → **\`WORKING\`**.
4. Se cair para \`FAILED\` ou \`STOPPED\`, você recebe um item na Caixa da IA do tipo "reescanear QR".

Estados possíveis: \`STARTING\`, \`SCAN_QR_CODE\`, \`WORKING\`, \`STOPPED\`, \`FAILED\`.

### Proteção de envio (anti-banimento)

No painel de proteção de cada número você configura:

| Controle | O que faz | Recomendação inicial |
|---|---|---|
| **Ritmo entre envios (segundos)** | Intervalo mínimo entre duas mensagens do número | 8–15 s |
| **Variação aleatória máxima** | Jitter somado ao ritmo, para o padrão não ficar robótico | 5–10 s |
| **Janela de envio (horário local)** | Faixa de horas em que o número pode enviar | 8h–20h |
| **Enviar aos domingos** | Domingo é evitado por padrão | desligado |
| **Teto diário de envios** | Limite absoluto por dia | comece baixo |
| **Aquecimento automático de número novo** | Sobe o teto por degraus conforme a idade do número | ligado |
| **Fuso horário da janela** | Em que fuso a janela é avaliada | o da sua operação |

**Por que isso existe:** número novo disparando muito é o retrato do que o WhatsApp bane. O aquecimento e a janela não são burocracia — são o que mantém o número vivo. Um número em aquecimento ou fora da janela **retém** os envios em vez de disparar; nada é perdido, apenas adiado.

**Multi-número:** você pode conectar vários. Cada agente de IA é publicado **para um número específico**, e o Inbox tem filtro por número.

---

## 6. Modo demonstração

Existe uma tela \`Demonstração\` que **preenche o CRM com dados fictícios** — funil, conversas de WhatsApp, pontuação justificada, dono humano e dono IA, radar de risco — para você avaliar o produto cheio antes de ligar o número real. Tem botões para **preencher de novo** e **limpar**.

Use assim: preencha, percorra as seções 7 a 9 deste guia clicando em tudo, e só depois limpe e conecte o número de verdade. Aprender a operar num CRM vazio é a forma mais difícil de aprender.

---

# Parte III — Operar

## 7. Inbox — atender

A tela é dividida em três: **lista de conversas** (esquerda), **conversa** (centro), **painel do CRM** (direita).

### 7.1 Filtrar e achar

Filtros disponíveis no topo da lista:

- **Abas de estado:** \`Todas\`, \`Minhas\`, \`Fila\`, \`Em atendimento\`, \`IA atendendo\`, \`Fechadas\`.
- **Busca:** por conversa e por mensagem (\`Buscar mensagens…\`).
- **Filtro por número de WhatsApp** — essencial se você tem vários números.
- **Filtro por tag.**

Estados de conversa: \`Aberta\`, \`Em atendimento\`, \`IA atendendo\`, \`Fechada\`, \`Arquivada\`.

\`Fila\` é o que ninguém assumiu ainda. Se o roteamento automático estiver ligado, a fila se esvazia sozinha; se não, ela é a sua lista de trabalho.

### 7.2 Assumir e responder

1. Abra a conversa da fila.
2. Clique em **assumir** (ou tecle \`a\`). Você passa a ser o responsável e a conversa vai para \`Em atendimento\`.
3. Escreva no campo de resposta e envie (\`Enter\`).

**Atalhos de teclado** (funcionam com o foco fora do campo de texto):

| Tecla | Ação |
|---|---|
| \`j\` | Próxima conversa |
| \`k\` | Conversa anterior |
| \`r\` | Focar a resposta |
| \`a\` | Assumir conversa |
| \`e\` | Fechar conversa |

Aprender \`j\` \`k\` \`a\` \`r\` muda a velocidade de atendimento mais do que qualquer outra coisa nesta tela.

### 7.3 O que o campo de resposta oferece

- **Anexar** — imagem, vídeo, documento; com pré-visualização antes de enviar.
- **Gravar áudio** — direto no navegador.
- **Emoji.**
- **Templates** — insere uma mensagem pronta (seção 11).
- **Sugerir resposta** — a IA escreve um rascunho para você revisar e enviar. Você continua sendo o autor: nada sai sem o seu envio.

Mídia recebida é renderizada na conversa: imagem, vídeo, áudio com player, documento, sticker. Se o arquivo já expirou pela política de retenção, aparece um aviso no lugar (a retenção de mídia é configurável em \`Configurações › Organização\`).

### 7.4 Ações sobre a conversa

- **Tags** — classifique a conversa (*dúvida*, *reclamação*, *troca*, *devolução*, *elogio*, *orçamento*, *pós-venda*, *urgente* são o vocabulário inicial; a organização pode ter o seu). Tag é o que faz o relatório e a automação conseguirem falar sobre o assunto.
- **Tarefa / Lembrete** (o relógio) — abre as duas coisas no mesmo lugar. Em cima, **adiar a conversa**: some da lista agora e volta depois (\`1 hora\`, \`3 horas\`, \`24 horas\`); quando o prazo vence, **o sistema não deixa a conversa desaparecer** — vira um item de caixa, a regra "nada morre em silêncio" aplicada ao esquecimento honesto. Embaixo, **criar tarefa**: o que fazer (ligar, mandar mensagem, anotar, preparar reunião), quando, **para quem** e a informação junto — o recado que o SDR deixa para o closer. Com reunião marcada no negócio, os atalhos de prazo viram \`1 dia antes\`, \`5h antes\`, \`2h antes\`, \`30 min antes\`. A tarefa aparece na aba **Tarefas**, no Painel e no número vermelho do menu — para quem vai fazer **e** para quem pediu.
- **Transferir** — passe para outra pessoa do time. Só é aceito quem é membro ativo com papel \`agent\` ou acima, e a transferência é **auditada** (quem, para quem, quando, por quê: assumir / transferir / liberar / roteamento / handoff).
- **Liberar** — devolve para a fila.
- **Notas internas** — comentário que o cliente nunca vê. É onde vai o "ele já reclamou disso em março".
- **Fechar** (\`e\`) — encerra o atendimento. Pede confirmação.
- **Marcar conversa como útil para a IA** — sinaliza que este atendimento é bom material de aprendizado; ele entra na fila de revisão para virar conhecimento (seção 15).

### 7.5 O painel do CRM (direita)

Sem sair da conversa você vê e edita o contexto: dados do contato, negócios ligados, pedidos (se houver integração), histórico. É o que evita a dança de abrir três telas para responder uma pergunta simples.

### 7.6 Convivência com a IA

Quando um agente está publicado para aquele número, ele responde e a conversa aparece como \`IA atendendo\`. Três coisas que você precisa saber:

1. **Você pode intervir a qualquer momento.** Assumir a conversa silencia o bot naquele fio.
2. **A IA sabe sair.** Palavras de handoff configuradas (por padrão "falar com humano", "atendente", "pessoa real") e a ferramenta de handoff fazem ela passar para um humano — e isso fica registrado.
3. **Existe travamento explícito.** Um contato pode ser marcado como "só humano", e uma etapa do funil pode ser marcada como "requer humano".

---

## 8. Kanban — conduzir o negócio

O Kanban é o funil. Colunas são etapas; cartões são negócios.

### 8.1 Preparar o funil antes de usar

Faça isso uma vez, em \`Configurações › Organização › Funis\` (papel \`manager\`+):

1. **Nomeie as etapas com o seu processo real.** O funil que vem pronto é de e-commerce (*Carrinho abandonado → Aguardando pagamento → Pago → Em separação → Enviado → Entregue → Pós-venda → Cancelado*). Se você é clínica, isso não serve: renomeie.
2. **Marque a etapa de ganho e a de perda.** Uma de cada por funil. É o que faz o sistema saber que o negócio fechou ou morreu — e o que alimenta qualquer métrica de conversão.
3. **Ajuste o vocabulário.** Troque *lead*, *negócio*, *ganho*, *perda*, *etapa* pelas palavras do seu nicho. A tela inteira passa a falar a sua língua.
4. **Defina os motivos de perda.** Além dos canônicos, você lista os seus. Perder sem motivo registrado é perder duas vezes.
5. **Mapeie as etapas para o funil da IA** (campo "para onde o card vai em cada passo"). Isso conecta o funil interno do agente (*novo, contatado, qualificando, qualificado, negociando, ganho, perdido*) às **suas** etapas. Sem esse mapeamento, o agente avança internamente e **o cartão não se move** — e o quadro mostra um negócio parado numa etapa que já não é verdade. É o ajuste mais esquecido e o que mais frustra quem liga a IA.
6. **Campos personalizados**, se precisar.

### 8.2 O dia a dia no quadro

- **Criar negócio:** botão de novo lead. Título, contato, valor, dono, previsão de fechamento.
- **Mover:** arraste o cartão. Se a etapa de destino é a de ganho, o negócio é marcado como ganho e a data de fechamento é carimbada automaticamente. Se é a de perda, o sistema **exige o motivo** — e recusa um motivo que não está na lista.
- **Reabrir:** mover de volta para uma etapa normal reabre o negócio.
- **Filtros:** por dono, etapa, tag, período.
- **Ações em lote:** selecione vários cartões e atribua/mova de uma vez (\`manager\`+).

### 8.3 O que cada cartão te conta

| Elemento | Leitura |
|---|---|
| **Dono** | Pode ser uma pessoa **ou um agente de IA** — com nome e versão. Nunca os dois. |
| **Pontuação** | Probabilidade de fechar (0–100). Passe o mouse: aparecem as **parcelas do cálculo** em português; clique: vai para a **evidência** (a atividade, a mensagem, o registro que sustenta cada parcela). |
| **Tempo na etapa** | Há quanto tempo o cartão entrou nesta coluna. |
| **Tempo sem resposta** | Diferente do de cima: é o silêncio. |
| **Borda de risco** | Aparece quando o negócio esfria (seção 9). |
| **Próxima ação** | A proposta do agente para o próximo passo, com botão de aprovar. |
| **Proposta de reativação** | Quando o negócio esfriou e a IA sugere retomar — **com prazo**. |

**Sobre a pontuação, porque é a parte mais incomum do produto:** ela não vem de uma chamada de modelo que devolve um número. É uma **fórmula sobre sinais que já existem**, e o banco **recusa** gravar pontuação sem motivo legível e sem pelo menos uma parcela ancorada num registro real. A consequência é a que interessa: você pode **discordar** do número olhando de onde ele veio. Quando não há sinal suficiente, o campo fica vazio — nunca zero. Vazio é honesto; zero seria mentira.

### 8.4 O dossiê do negócio

Clique no cartão. Você abre:

- **Dados** do negócio (editáveis).
- **Linha do tempo** — tudo que aconteceu, com **quem agiu**: pessoa do time, IA, o sistema, uma automação, ou o próprio cliente. Quando a linha é da IA, ela vem com o **motivo** e a **evidência**.
- **Próxima ação** — aprovar ou descartar a proposta do agente. Aprovar é o que autoriza a execução.
- **Pontuação** com as parcelas.
- **Vínculos** — pedidos, conversas, mensagens ligados a este negócio.

Uma observação de projeto que vale conhecer: **constatar o silêncio não é quebrar o silêncio.** Só interação de verdade (a IA falou com o cliente, alguém registrou trabalho, alguém editou, alguém moveu, alguém aprovou a próxima ação) reinicia o relógio de silêncio. O sistema registrar "este negócio esfriou" **não** conta como atividade — senão ele apagaria o próprio alerta que acabou de criar.

---

## 9. Radar de risco

\`Radar\` responde a pergunta que nenhum Kanban responde: **o que está morrendo sem ninguém ver?**

Cada negócio aberto tem um estado de risco, calculado a partir do silêncio e da janela esperada da etapa:

| Estado | Significado |
|---|---|
| **Em dia** | Dentro do prazo esperado da etapa. |
| **Em voo** | Esfriou, **mas** o assistente já agendou um retorno. Há próximo passo garantido. |
| **Em risco** | Esfriou e não há próximo passo. |
| **Crítico** | Esfriou muito além da janela. |

Três coisas que fazem esta tela funcionar diferente de um relatório:

1. **É estado, não cálculo de leitura.** O risco existe mesmo que ninguém abra a tela; a borda aparece no cartão do Kanban sozinha, sem recarregar.
2. **A janela usada na decisão fica gravada junto.** Se você mudar a duração esperada da etapa depois, os estados antigos continuam explicáveis — não são reescritos retroativamente.
3. **A proposta de reativação tem prazo obrigatório.** Não existe, no banco, proposta sem data de vencimento. Se ninguém decidir, ela **não** fica pendente para sempre: sai do cartão e vira item de caixa. O motivo é sutil e importante — cartão parado com proposta pendente em cima *simula atendimento*, e simular atendimento adia a intervenção humana em vez de provocá-la.

**Como usar:** abra o Radar uma vez por dia. Para cada item em risco ou crítico, faça uma de três coisas — retome (aceite a reativação), transfira, ou perca com motivo. A pior resposta é nenhuma.

---

## 10. Contatos

A ficha da pessoa: nome, telefone (formato internacional), e-mail, CPF (guardado criptografado), aniversário, tags, origem, consentimentos (marketing, transacional, perfilamento), último contato.

O que a tela permite:

- **Bloquear** um contato (com motivo) — nada é enviado para ele.
- **Marcar como "só humano"** — a IA não atende esta pessoa.
- **Ver o histórico completo:** conversas, negócios, pedidos, atividades.
- **Unificação automática:** o sistema evita que a mesma pessoa vire cinco contatos. A identidade é o telefone (ou o identificador do WhatsApp), e duplicatas antigas são mescladas.
- **Anonimizar** (via LGPD, seção 26) — irreversível.

---

## 11. Templates de mensagem

\`Templates\` guarda as mensagens que você repete. Cada template tem **título**, **corpo** e **atalho**.

Dois escopos:

- **Pessoal** — só quem criou usa (papel \`agent\`+).
- **Da equipe** — todo mundo usa (papel \`manager\`+ para criar).

No Inbox, o menu de templates no campo de resposta insere o texto para você editar antes de enviar. Template não é automação: é digitação poupada.

---

# Parte IV — Delegar para a IA

## 12. Como a IA funciona aqui

Antes de clicar em nada, o modelo mental — ele economiza horas.

**1. Identidade × versão.** O **agente** é a identidade (nome, prioridade, ativo/inativo). A **versão** é a configuração (prompt, modelo, ferramentas, orçamentos, número). Uma versão publicada é **imutável no banco**: editar cria uma versão nova; voltar atrás é apontar para a versão anterior. Não existe "alguém mexeu no prompt em produção e ninguém sabe".

**2. Publicar é o interruptor.** Salvar não põe nada no ar. Publicar aponta o agente para a versão, e é aí que ele começa a atender. A publicação **recusa** subir se: falta credencial, a credencial não foi validada, o provedor da credencial não bate com o da versão, o modelo não existe no catálogo, ou **o número de WhatsApp não está \`WORKING\`**. Erros que você vai ver na tela e agora sabe traduzir: \`credential_not_validated\`, \`channel_session_offline\`, \`model_not_found\`.

**3. Orçamento é teto real.** Cada versão tem limite de passos, de tokens e de **custo em centavos**. A organização tem orçamento mensal com ação ao atingir 100%: \`estrangular\` ou \`desligar\`. Estourar gera item de caixa. Não existe surpresa na fatura por design.

**4. O agente não improvisa preço.** Existe tabela de promessas versionada (preço mínimo, desconto máximo, parcelas máximas) e a mensagem passa por uma **cadeia de verificações antes de sair**. Cada tentativa deixa rastro do que foi verificado e do que vetou — e esse rastro é gravado **fora** da transação, então sobrevive mesmo quando o envio é abortado.

**5. Camadas de conhecimento.** São quatro, e confundi-las é o erro mais comum:

| Camada | Para que serve | Quando é lida |
|---|---|---|
| **Prompt do sistema** | Quem o agente é, tom, regras duras | sempre |
| **Memória da organização** | O que *toda* IA da casa deve saber | sempre |
| **Conhecimento (RAG)** | Seus textos: FAQ, políticas, catálogo | quando a mensagem exige busca |
| **Skills** | Playbook de uma situação específica | só quando a situação dispara |

Colocar tudo no prompt é o que faz um agente ficar caro, lento e confuso.

---

## 13. Passo 1 — Credenciais de IA

\`Agentes IA › Credenciais\` (\`admin\` para escrever).

1. Escolha o provedor: **Anthropic**, **OpenAI** ou **Google**.
2. Dê um rótulo ("Anthropic produção").
3. Cole a chave. Ela é **criptografada** e a tela só mostra os 4 últimos dígitos depois — não há como recuperar a chave pela interface.
4. **Valide.** A validação é obrigatória: uma credencial não validada **não publica** agente.

O catálogo de modelos já vem semeado, com janela de contexto e preço por milhão de tokens de cada um — é o que permite ao sistema calcular custo de verdade em vez de estimar.

---

## 14. Passo 2 — Criar, configurar, testar e publicar um agente

\`Agentes IA › novo\`. O editor tem cinco abas: **Configuração**, **Teste**, **Execuções**, **Histórico**, **Propostas**.

### Aba Configuração

**Identidade**
- **Nome** e **Descrição** (interna).
- **Prioridade (0–1000)** — desempata quando mais de um agente poderia atender.

**Modelo**
- **Provedor** e **modelo** (a lista vem do catálogo).
- **Credencial** (a que você validou no passo 1).
- **Número/Sessão** — em qual WhatsApp este agente atende. **Selecione um número que esteja \`WORKING\`**, senão a publicação recusa.

**Prompt do sistema** — quem o agente é. O que funciona, na prática:
- Diga **quem ele é e para quem fala** ("você atende clientes de uma clínica odontológica em Belo Horizonte").
- Dê **o tom** em uma frase, não em um parágrafo.
- Escreva as **regras duras** como proibições explícitas ("nunca prometa prazo de entrega", "nunca dê desconto").
- Diga **quando passar para humano**.
- Não coloque catálogo, tabela de preço ou FAQ aqui — isso é conhecimento (seção 15).

**Limites**
- **Max steps (1–25)** — quantas ações num turno. 6–10 costuma bastar.
- **Orçamento de tokens** e **custo máximo (centavos)** por execução.
- **Histórico (mensagens)** e **histórico (tokens)** — quanto da conversa entra no contexto.

**Ferramentas** — o que o agente pode fazer no CRM (consultar, mover cartão, etc.). Ligue o mínimo necessário: cada ferramenta é uma coisa que ele pode errar.

**Gatilhos** — quando ele age: eventos (mensagem recebida), filtros (ignorar grupos, ignorar a si mesmo, regex de palavra-chave, horário comercial) e concorrência (padrão: **uma execução por conversa** — isso é o que evita duas respostas simultâneas para o mesmo cliente).

**Handoff**
- **Palavras-chave** que passam para humano (padrão: "falar com humano", "atendente", "pessoa real").
- **Ferramenta de handoff** ligada — o agente pede ajuda por decisão própria, não só por palavra-chave.

**Casos** — ligue se quiser que o agente abra caso formal quando travar (seção 20).

**Follow-up** — ligue e escolha quais fluxos este agente pode usar (seção 19).

**Multimídia** — se o agente interpreta imagem/áudio recebidos, e se extrai quadros de vídeo.

**Dividir mensagens** — quebra respostas longas em várias mensagens, com tamanho máximo por mensagem. Deixa a conversa mais humana; use com o ritmo de envio da seção 5 configurado.

### Aba Teste

Antes de publicar, converse com o agente ali mesmo. Teste, no mínimo:

1. Uma pergunta que **só a sua base de conhecimento responde** (valida o RAG).
2. Uma pergunta de **preço/desconto** (valida os limites).
3. Uma frase de **handoff** ("quero falar com uma pessoa").
4. Uma pergunta **fora de escopo** (valida se ele sabe não saber).

### Publicar

Botão de publicar → diálogo de confirmação → o agente entra no ar. A versão anterior passa a "superada" (não apagada: continua no histórico e pode ser republicada).

### Aba Execuções

Cada turno do agente vira uma execução com: status (\`pendente\`, \`rodando\`, \`concluída\`, \`falhou\`, \`abortada\`, \`handoff\`), tokens de entrada e saída, **custo**, latência, número de passos e as **ferramentas chamadas**. Clique para abrir o rastro completo.

Esta é a aba que você abre quando alguém diz "a IA respondeu errado". Não é achismo: está tudo lá.

### Aba Histórico

Todas as versões, com **diferença entre versões** e opção de reverter (que clona e publica). É o seu "ctrl+z" de configuração.

### Aba Propostas

Melhorias que o sistema **propõe** a partir da operação real — e que só entram se um humano aprovar. Nada é aplicado automaticamente (seção 21).

---

## 15. Passo 3 — Conhecimento (RAG)

Sem conhecimento, o agente é eloquente e ignorante.

### Tipos de fonte

| Fonte | O que é |
|---|---|
| **FAQ** | Perguntas e respostas que você cadastra (com tags e idioma) |
| **Política** | Documentos enviados (PDF, Markdown, texto) — trocas, devoluções, garantia |
| **Catálogo** | Seus produtos (via Nuvemshop, quando integrada) |
| **Conversas** | Atendimentos reais marcados como úteis |

### Como publicar conhecimento

1. Vá em conhecimento, dentro do agente.
2. Adicione ou envie as fontes.
3. O sistema **indexa** (quebra em pedaços e gera representações vetoriais). A fonte passa por \`construindo\` → \`pronta\` (ou \`falhou\`, com o erro visível).
4. O conjunto indexado forma uma **versão da base**. Você **ativa** a versão — só uma fica ativa por agente.

Duas propriedades que valem entender:

- **Versionamento com troca atômica:** você não edita a base que está no ar. Você constrói a nova, verifica, e ativa. Se der errado, volta para a anterior.
- **Citações:** a resposta guarda de onde veio. Na conversa, o botão de citação mostra o trecho usado. Isso é o que torna possível corrigir a *fonte* em vez de brigar com o modelo.

### O ciclo de aprendizado

Este é o mecanismo que faz o agente melhorar com o tempo:

\`\`\`
atendimento humano bom → marcado como útil no Inbox
        → entra em revisão → aprovado → indexado
        → o agente passa a responder aquilo sozinho
\`\`\`

E o inverso também informa: cada **handoff** marca um ponto onde o agente ainda não alcança. A tela \`Evolução da IA\` mostra exatamente essas lacunas (seção 21).

### Ajustes finos

- **Top K** — quantos trechos trazer por busca (comece em 5).
- **Limiar de similaridade** — o quão parecido precisa ser para valer (padrão 0,72). Baixar demais faz o agente responder com material irrelevante; subir demais faz ele dizer "não sei" tendo a resposta na base.
- **Limiar de confiança** — abaixo dele, o agente prefere passar para humano.

A tela de conhecimento registra as buscas: quantas acertaram, quantas **quase** acertaram (o melhor candidato ficou logo abaixo do limiar) e quantas não tinham resposta. Essa distinção é a que diz se você deve **ajustar o limiar** ou **escrever conteúdo novo** — duas ações completamente diferentes que, sem esse dado, viram tentativa e erro.

---

## 16. Memória da organização

\`Memória da IA\` (\`manager\` vê, \`admin\` publica).

Duas partes:

1. **Documento da organização** — texto versionado com o que *toda* IA da casa deve saber: quem vocês são, o que não fazem, como falam, políticas gerais. Publicar cria uma versão nova; o histórico fica.
2. **Aprendizados** — entradas curtas (título + corpo) com o que se aprendeu na prática. Podem ser escritas por você (\`manual\`) ou **propostas pelo sistema** a partir da operação (\`flywheel\`) — e proposta do sistema só entra com **aprovação humana**.

**Memória × conhecimento:** memória é *quem somos e como agimos* (sempre carregada, curta). Conhecimento é *fatos consultáveis* (buscado, pode ser enorme). Não coloque seu catálogo na memória.

---

## 17. Skills da IA

\`Skills da IA\` (\`manager\`+). Duas abas: **Catálogo** e **Skills instaladas**.

Uma skill é um **playbook situacional**. O ponto técnico que a torna diferente de "mais texto no prompt": só o **nome e a descrição** ficam no contexto do agente; o corpo carrega **apenas quando a situação dispara** (por palavras-chave declaradas). É o que permite ter dezenas de playbooks sem inflar custo nem confundir o modelo.

Duas skills de fábrica vêm no catálogo:

- **\`objecao-preco\`** — diagnostica o motivo real por trás do "tá caro" (orçamento insuficiente, valor não percebido, comparação com concorrente, tática de negociação, timing disfarçado) e dá o caminho para cada caso. Dispara em "caro", "desconto", "mais barato", "fora do orçamento".
- **\`agendamento\`** — marcar/remarcar horário sem inventar disponibilidade: oferece opções fechadas, coleta os dados obrigatórios, confirma por escrito antes de fechar. Dispara em "agendar", "marcar horário", "remarcar", "desmarcar".

Você instala do catálogo e pode **derivar a sua versão** (fork) para adaptar ao seu negócio. A tela mostra **telemetria de ativação**: quantas vezes cada skill disparou e por qual gatilho — dado que diz quais playbooks valem manter.

---

## 18. Roteadores de intenção

\`Roteadores\` (\`manager\` vê, \`admin\` gerencia).

Um roteador resolve o problema de ter **vários agentes num só número**. Você declara as intenções e a qual agente cada uma pertence:

\`\`\`
Número (11) 9xxxx-xxxx
├── "suporte técnico"  → Agente Suporte
├── "quero comprar"    → Agente Vendas
└── "cadê meu pedido"  → Agente Logística
\`\`\`

Como configurar:

1. Crie o roteador, dê nome e escolha o **número de WhatsApp** (um roteador ativo por número — dois disputando o mesmo número seria ambiguidade).
2. Adicione **membros**: para cada um, o agente, o **nome da intenção**, a **descrição da intenção** e **exemplos de frases**. A descrição é o que o classificador lê — escreva-a para uma pessoa entender, não como palavra-chave.
3. Configure: **modelo classificador** (use um rápido e barato), **confiança mínima** (padrão 0,6) e **aderência** (\`sticky\`).
4. Escolha o **agente de fallback** — quem atende quando nada casa.

**Aderência (sticky)** é a configuração que mais afeta a experiência: com ela ligada, uma vez roteada, a conversa **permanece** com o mesmo agente em vez de ser reclassificada a cada mensagem. Sem ela, o cliente troca de atendente no meio da frase.

Cada decisão é registrada (sem o texto da conversa) com o resultado: \`classificada\`, \`aderente\`, \`reclassificada\`, \`fallback\`, \`sem correspondência\`, \`classificador falhou\`. Muitos \`sem correspondência\` significa que falta uma intenção; muitos \`fallback\` significa que as descrições estão ruins.

---

## 19. Follow-ups

\`Follow-ups\` (\`manager\` vê). Duas partes: **lista de fluxos** e **fila**.

Um fluxo é um grafo que você monta arrastando nós:

| Nó | Função |
|---|---|
| **Gatilho** | O que inicia a inscrição |
| **Aguardar** | Espera um tempo |
| **Condição** | Bifurca conforme o estado |
| **Classificar (IA)** | Deixa o modelo decidir o ramo |
| **Ação** | Faz algo (mandar mensagem, mover cartão, marcar) |
| **Fim** | Encerra, com desfecho |

### Montando

1. Crie o fluxo (nasce como **rascunho**).
2. Arraste os nós, ligue-os, configure cada um no painel lateral.
3. Defina a **política de handoff** — o que acontece se um humano entrar na conversa: \`pausar\`, \`cancelar\` ou \`permitir\`. **Escolha consciente:** \`permitir\` significa que o cliente pode receber mensagem automática enquanto conversa com uma pessoa de verdade.
4. **Publique.** Publicar congela a versão e ativa o fluxo. Status: \`rascunho\`, \`ativo\`, \`desativado\`.
5. Autorize o fluxo no agente (aba Configuração → Follow-up).

### A fila

Mostra cada inscrição viva: contato, fluxo, nó atual e motivo, próximo disparo, status. Estados: \`ativo\`, \`aguardando resposta\`, \`pausado por handoff\`, \`concluído\`, \`cancelado\`, \`morto\`. Desfechos: \`convertido\`, \`respondeu\`, \`esgotado\`, \`optou por sair\`, \`handoff\`.

Você pode cancelar uma inscrição a qualquer momento. Uma inscrição que falha repetidamente é marcada como morta **e vira item de caixa** — não desaparece.

**Regra estrutural:** existe no máximo **uma inscrição viva por contato em toda a organização**. Isso é garantido pelo banco, não pela boa vontade do código. Sem essa regra, dois fluxos disparariam para a mesma pessoa no mesmo dia — que é o retrato de operação amadora.

---

## 20. Casos

\`Agentes IA › Casos\`. Um caso é a IA dizendo, formalmente: *"travei aqui, e é isto que eu já sei"*.

Cada caso traz: título, resumo, **o que está travando**, contexto da conversa, negócio ligado e o agente que abriu.

Estados: \`aguardando humano\`, \`aguardando cliente\`, \`resolvido\`, \`escalado\`, \`cancelado\`.

Suas três respostas possíveis:

| Ação | Quando |
|---|---|
| **Resolvi** | Você respondeu; a IA continua daqui |
| **Preciso de informação do cliente** | A IA volta e pergunta ao cliente |
| **Escalar** | Vai para alguém acima |

A diferença entre caso e handoff: **handoff** transfere a conversa; **caso** mantém a IA no jogo e pede um dado ou uma decisão. É a diferença entre "assume isso" e "me diz uma coisa".

---

## 21. Caixa da IA, Uso e Evolução

### Caixa da IA

A caixa de entrada do **sistema falando com você**. Cada item tem gravidade (\`informação\`, \`atenção\`, \`crítico\`) e estado (\`aberto\`, \`visto\`, \`resolvido\`).

Tipos de item:

| Tipo | Significado |
|---|---|
| Reescanear QR | O número caiu |
| Trabalho morto | Uma tarefa falhou até o limite |
| Evento morto | Um evento não foi processado |
| Orçamento estourado | Limite mensal de IA atingido |
| Handoff | A IA passou para humano |
| Revisão de promoção | Algo espera aprovação |
| Juiz desalinhado | A avaliação automática divergiu |
| Follow-up morto | Uma inscrição falhou até o fim |
| Soneca vencida | Um lembrete de conversa venceu |
| Próxima ação ambígua | A proposta não pôde ser executada com segurança |
| Acervo de risco semeado | Negócios já frios entraram no radar de uma vez |
| Reativação vencida | Uma proposta de retomada expirou sem decisão |

**Todo item tem ação nomeada.** Item de caixa sem ação nomeada é ruído, e o produto trata isso como defeito — "revise os 48 e decida quais encerrar" é trabalho; "48 negócios em risco" é um número.

### Uso

\`Agentes IA › Uso\`: consumo por período, por agente, por tipo de chamada. Tokens de entrada, de saída, **leitura e escrita de cache** (métrica de primeira classe — cache é a maior alavanca de custo), custo, latência.

Ao lado, o **orçamento**: limite mensal, consumido, percentual de alarme (50–99%) e ação ao atingir 100% (\`estrangular\` ou \`desligar\`).

**Custo desconhecido é registrado como desconhecido, nunca como zero.** Se um modelo não está na tabela de preços, o sistema não inventa 0 — porque 0 esconderia gasto real.

### Evolução da IA

\`Evolução da IA\` fecha o ciclo. Mostra a **linha do tempo do aprendizado** e as **lacunas**: onde o agente falhou, onde pediu ajuda, onde a base não tinha resposta.

Como o ciclo funciona:

\`\`\`
operação real
   → avaliação automática em lote (nunca por mensagem, para não pesar no atendimento)
   → propostas de melhoria (prompt, conhecimento, gatilho de retomada, memória)
   → APROVAÇÃO HUMANA
   → nova versão do agente
\`\`\`

O componente que propõe melhorias **nunca aplica nada**. Ele só escreve propostas. Aplicar é sempre decisão humana, registrada (quem aplicou, quando, em qual versão). É o que impede o sistema de se auto-otimizar para longe do que você quer.

---

# Parte V — Automatizar e governar

## 22. Webhooks e automações

\`Webhooks\` (\`manager\`+). Três abas.

### Aba "Receber dados"

Cria uma **fonte de captação**: um endereço público (\`/api/v1/webhooks/in/<token>\`) que recebe leads de landing page, formulário próprio, Zapier, n8n — por POST em JSON ou formulário.

1. Nomeie a fonte.
2. Escolha **funil e etapa de destino**.
3. Configure o **mapeamento de campos** (\`nome\` do formulário → título do negócio, etc.).
4. Opcional: **segredo** (guardado criptografado) e **URL de redirecionamento** para formulários HTML.
5. **Copie o endereço** ou o formulário pronto.
6. **Dispare um lead de teste** pela própria tela e confira em "últimos recebimentos".

### Aba "Automações"

Regras no formato **QUANDO / SE / ENTÃO**:

- **QUANDO** — um evento: lead criado, mudou de etapa, ganhou tag, chegou mensagem no WhatsApp, ganho, perda, atribuição...
- **SE** — condições sobre o evento.
- **ENTÃO** — ações: adicionar tag, mover no funil, atribuir a um atendente, mandar mensagem de WhatsApp, chamar webhook externo.

**Toda regra nasce pausada.** Você revisa e liga. Isso é deliberado: automação criada já rodando é automação que dispara errado para cem clientes antes de alguém notar.

### Aba "Atividade"

Timeline de execuções, com resultado de cada ação e **reenvio manual** quando uma chamada externa falha.

### O detalhe de infraestrutura que você precisa saber

Nenhum gatilho de banco faz chamada de rede. Os eventos entram numa fila (\`event_log\`) e uma **rotina que roda a cada minuto** (\`/api/v1/cron/event-log-drain\`) é quem dispara as automações.

**Sem essa rotina ativa, fontes e automações continuam sendo criadas normalmente e nada roda.** É o modo de falha mais silencioso do sistema — se as automações "não funcionam" e a tela não mostra erro, é aqui que você olha primeiro.

---

## 23. Equipe, disponibilidade e roteamento

\`Equipe\`. Duas seções: **membros** e **atendentes**.

### Membros

Lista com papel, status (\`aceito\`, \`pendente\`), última atividade. Ações de \`admin\`: **convidar**, **trocar papel**, **revogar acesso**. \`manager\` vê a lista inteira (mas não altera).

Convite: e-mail com link (\`/team/accept-invite/<token>\`). Requer serviço de e-mail configurado.

### Atendentes (disponibilidade)

Para cada pessoa:

- **Disponível / Online** — o interruptor que diz "estou atendendo agora".
- **Capacidade** — quantas conversas simultâneas ela aceita.
- **Carga** — quantas ela tem agora.
- **Horário** — janela de trabalho, avaliada no **fuso** dela ("nenhuma janela" = 24/7).

Há **desligamento automático por inatividade**: sem sinal de vida, a pessoa sai de "disponível" — porque fila distribuída para quem foi embora é fila parada.

### Roteamento

O **modo de roteamento** define como conversas novas na fila são distribuídas, com **tentativas máximas** e **backoff** entre elas.

Como funciona por baixo: a *entrada* de uma conversa na fila emite um pedido de roteamento; um processo consome e distribui. A atribuição feita pelo processo **não** re-emite pedido — o que evita laço infinito. Só é aceito como destino quem é **membro ativo com papel \`agent\` ou acima**, validado no banco.

### Escopo de visualização

Configurado por organização, com três modos (\`all\`, \`own_and_unassigned\` — padrão, \`own\`). Restringe **só o papel \`agent\`**, e vale para conversas e negócios.

Escolha assim: equipe pequena e colaborativa → \`all\`. Equipe comissionada onde cada um cuida do seu → \`own_and_unassigned\`. Operação com sigilo entre vendedores → \`own\`.

---

## 24. Desempenho

\`Desempenho\` traz, por período e por atendente:

- **Funil** — quantos negócios abertos em cada etapa.
- **Ganhos e perdas** por pessoa na janela.
- **Conversas atendidas** por pessoa.
- **Tempo médio de primeira resposta humana** — medido do primeiro inbound até a primeira resposta **de uma pessoa** (resposta da IA não conta como primeira resposta humana; se contasse, o número mediria a IA e você acharia que mediu o time).

As métricas respeitam o escopo de visualização: um \`agent\` em modo \`own\` vê os números dele.

---

## 25. Nuvemshop

Para e-commerce. Em \`Integrações › Nuvemshop\`, autorize a loja (OAuth; os tokens ficam criptografados).

O que passa a acontecer:

- **Pedidos** entram no CRM com status, valor, forma de pagamento, situação de entrega, código de rastreio.
- **Produtos** entram e podem ser indexados como conhecimento — o agente passa a responder sobre catálogo, preço e disponibilidade.
- **Pedidos são ligados ao contato** e viram vínculo do negócio.
- Estado da conexão fica visível: \`conectando\`, \`saudável\`, \`token expirado\`, \`escopo faltando\`, \`desconectado\`, \`limitado\`, \`erro\`.

---

## 26. LGPD

\`LGPD\` (só \`admin\`).

Tipos de pedido: **acesso aos dados**, **anonimização** (contato) e **anonimização de loja**. Origem: Nuvemshop, manual, API, suporte. Cada pedido tem **prazo** e é acompanhado até \`concluído\`.

Como a anonimização funciona:

- **Anonimizar, não apagar.** O contato vira "Cliente Anonimizado #xxxxxxxx"; dados pessoais são removidos; **valores, status e datas são preservados** — porque apagar a venda destruiria a contabilidade sem proteger ninguém a mais.
- **É irreversível.** O sistema marca e trava.
- **Cascateia:** contato, conversas, mensagens (corpo redigido), atividades, negócios, pedidos.
- **Mídia** vai para uma fila de exclusão assíncrona.
- Tudo gera **registro de auditoria** com o que foi atingido.

Auditoria é **somente adição**, com retenção de 5 anos. Em \`Configurações › Organização\` você define **e-mail do DPO**, **URL da política de privacidade** e **retenção de mídia em dias**.

---

## 27. Configurações

| Página | O que tem | Papel |
|---|---|---|
| **Organização** | Nome, razão social, CNPJ, fuso, idioma, retenção de mídia, DPO, política de privacidade, motivos de perda extras | \`admin\` |
| **Organização › Funis** | Funis, etapas, vocabulário, campos personalizados, mapeamento para o funil da IA | \`manager\`+ |
| **Organização › WhatsApp** | Preferências dos números | \`admin\` |
| **Perfil** | Seus dados | todos |
| **Segurança** | Senha, **MFA**, códigos de recuperação | todos |
| **Notificações** | O que te avisa e por onde | todos |
| **Tokens de API** | Criar/revogar tokens com escopos; mostrado uma única vez na criação | \`admin\` |
| **Cobrança** | Plano e consumo | \`admin\` |
| **Auditoria** | Registro de tudo: quem, o quê, quando, de onde | \`manager\`+ |

Sobre MFA: ligue para todo \`admin\`. É a diferença entre uma senha vazada e um vazamento de dados.

---

# Parte VI — Rotina

## 28. Rotina recomendada

### Todo dia (15 min)

1. **Inbox › Fila** — zere. Assuma ou distribua.
2. **Radar** — cada item em risco ou crítico recebe uma decisão: retomar, transferir ou perder com motivo.
3. **Caixa da IA** — resolva os itens crítico/atenção. Número caído e orçamento estourado não esperam.
4. **Casos** — responda o que está aguardando humano. Caso parado é cliente parado.

### Toda semana (30 min)

5. **Kanban** — passe pelas etapas. Cartão sem próxima ação é cartão morrendo.
6. **Execuções** do agente — leia 5 ao acaso. Você vai achar coisa que nenhuma métrica mostra.
7. **Evolução da IA** — veja as lacunas; escreva conhecimento para as duas mais frequentes.
8. **Propostas** — aprove ou descarte. Fila de propostas parada é o ciclo de aprendizado desligado.
9. **Desempenho** — tempo de primeira resposta e ganhos por pessoa.

### Todo mês (1 h)

10. **Uso e orçamento** — o custo por conversa está caindo? (Deveria: cache e conhecimento melhoram com o tempo.)
11. **Conhecimento** — buscas que "quase acertaram" viram conteúdo novo ou ajuste de limiar.
12. **Skills** — as que nunca disparam, tire; as que disparam muito, refine.
13. **Auditoria e Equipe** — quem entrou, quem saiu, quem virou admin.
14. **Proteção de envio** — se os números estão saudáveis e aquecidos, suba o teto com calma.

---

## 29. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Não consigo publicar o agente: \`channel_session_offline\` | O número não está \`WORKING\` | \`Conexões\` → reconectar/reescanear |
| \`credential_not_validated\` | A credencial nunca foi validada | \`Credenciais\` → validar |
| \`credential_provider_mismatch\` | A credencial é de um provedor e a versão de outro | Alinhe os dois |
| \`model_not_found\` | Modelo fora do catálogo ou descontinuado | Escolha outro modelo |
| A IA não responde | Agente inativo, sem versão publicada, filtro de gatilho barrando, orçamento estourado, ou conversa assumida por humano | Verifique nessa ordem; a Caixa da IA costuma já ter avisado |
| Automações não rodam e não há erro | A rotina de minuto não está ativa | Verifique o cron de \`event-log-drain\` |
| Convite não chega | Serviço de e-mail não configurado | Configure \`RESEND_API_KEY\` |
| A IA avança mas o cartão não anda | Etapas não mapeadas para o funil da IA | \`Configurações › Organização › Funis\` → mapear |
| A IA responde genérico | Falta conhecimento, ou o limiar está alto | Adicione fontes; veja as buscas que quase acertaram |
| Cliente troca de agente no meio da conversa | Aderência (\`sticky\`) desligada no roteador | Ligue |
| Cliente recebe automação enquanto fala com humano | Política de handoff do fluxo está em \`permitir\` | Mude para \`pausar\` |
| Não vejo conversas dos colegas | Escopo de visualização em \`own\`/\`own_and_unassigned\` e seu papel é \`agent\` | É esperado; um \`admin\` pode mudar |
| Item da barra lateral não aparece | Falta de permissão | Confira o papel em \`Equipe\` |
| Mídia antiga não abre | Retenção de mídia expirou | Ajuste a retenção em \`Organização\` (vale para o futuro) |
| Pontuação vazia no cartão | Sinal insuficiente | Vazio é intencional — nunca é zero |
| O mesmo cliente virou vários contatos | Base antiga antes da unificação | O sistema mescla; confira em \`Contatos\` |

---

## Uma última coisa

Se você for lembrar de três frases deste guia, que sejam estas:

1. **Publicar é o interruptor.** Salvar não põe a IA no ar.
2. **Mapeie as etapas para o funil da IA.** Sem isso, ela trabalha e o quadro mente.
3. **Nada morre em silêncio — mas alguém tem que abrir o Radar e a Caixa.** O sistema garante que o esquecido reapareça; ele não decide por você.
`,
  },
];
