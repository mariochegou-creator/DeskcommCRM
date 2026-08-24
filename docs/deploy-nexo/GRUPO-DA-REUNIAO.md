# O grupo da reunião

Quando você marca a R1, o CRM cria um grupo no WhatsApp com o lead, você e o
David. A confirmação e os lembretes passam a sair **no grupo**, não no privado.

Por quê: no privado, furar a reunião não custa nada — ninguém vê. No grupo, é
uma decisão tomada na frente de três pessoas.

---

## O que acontece quando você marca

1. Você arrasta o card pra coluna de reunião marcada (ou usa "Marcar reunião")
2. Escolhe dia e hora. **A caixinha "Criar grupo no WhatsApp" já vem marcada**
3. Ao salvar:
   - O grupo nasce com o nome **"Nexo IA ✕ [nome do negócio]"**
   - Entram: o lead, você (+5511930582384) e o David (+5577991577662)
   - O dono do grupo é o número por onde o lead foi abordado
   - A assistente manda a mensagem de abertura

A conversa do grupo aparece no **Inbox**, como qualquer outra. As mensagens
mostram quem escreveu.

---

## As 4 falas do Claudio

O assistente se chama **Claudio** e fala **só** nestes quatro momentos. Em todo
o resto, cala a boca.

| Quando | O que diz |
|---|---|
| Ao criar o grupo | Três mensagens: texto com dia/hora e quem conduz → **áudio do Claudio** (gravado uma vez, sai como nota de voz) → a pergunta do "confirmado" por escrito |
| 18h da véspera | Confirma o horário de amanhã, pede "sim" |
| ~1h antes | "É hoje às Xh, o Mario te chama daqui a pouco" |
| Lead pede pra remarcar | "Sem problema, já avisei o Mario, ele te manda dois horários" + cria a tarefa |

**Remarcar não desfaz o grupo.** Ele continua, só muda a hora. A mensagem que
sai é outra ("mudou o horário: agora é…"), não a de abertura.

### O áudio do Claudio

O áudio da abertura é **um só, gravado uma vez** — ele não fala nome, data nem
negócio (isso vai nas mensagens de texto), então nunca fica velho. Mora no
Supabase Storage (`whatsapp-media`, pasta `library/grupo/`) e o caminho fica em
`settings.grupo_da_reuniao.audio_abertura` da organização. Pra trocar a voz:
subir um MP3 novo no mesmo caminho. Pra desligar e voltar ao texto único:
apagar essa configuração. Se o envio do áudio falhar, o texto completo sai no
lugar sozinho — o lead nunca fica sem o pedido de confirmação.

### O que ela NÃO faz

- Não responde pergunta sobre preço, serviço, dúvida técnica
- Não conversa
- Não oferece horários (quem manda os horários é você, pela tarefa que nasce)
- **Não usa IA de verdade.** Todo texto é montado em código. Grupo não gasta
  crédito da Anthropic.

### A trava contra o robô solto

Três coisas independentes impedem a IA de responder no grupo:

1. O dispatcher de IA ignora conversa de grupo por padrão
2. O evento que acorda a IA nem chega a ser criado pra mensagem de grupo
3. Os textos do grupo são fixos, escritos em código

E a resposta de remarcação só dispara se **o próprio lead** escreveu (não você,
não o David), e só **uma vez** por reunião.

---

## Reunião que já estava marcada antes disso

Não precisa remarcar só pra ganhar o grupo — isso mandaria uma confirmação nova
pro lead. Use o menu do card (⋯) → **"Criar grupo no WhatsApp"**.

Nesse caso o grupo é criado **em silêncio**: nenhuma mensagem sai. Você escreve
a primeira.

---

## Quando dá errado

| A tela diz | O que fazer |
|---|---|
| "1 pessoa não entrou no grupo" | O WhatsApp dela só aceita convite de quem já está na agenda. Adicione à mão pelo celular. |
| "Grupo não criado: o contato não tem telefone" | Cadastre o telefone no contato do lead |
| "Grupo não criado: o serviço do WhatsApp não está no ar" | O WAHA caiu. Veja em Conexões. |
| "Grupo não criado: a conexão da assistente está fora do ar" | O chip do Claudio caiu. Reconecte em Conexões e crie o grupo pelo menu do card (⋯). |
| "Grupo não criado: alguém do time está sem número cadastrado" | A frase diz quem. Cada um escolhe o seu em Configurações → Perfil → "Meu número de WhatsApp"; os papéis (closer/SDR) ficam em Configurações. |
| "As mensagens automáticas estão desligadas" | O grupo aparece no celular do cliente na hora — o mesmo interruptor que cala a IA impede criar. Religue em `organizations.settings.ai_dispatch_mode`. |

---

## Quem entra no grupo

**Sempre os 4, pelo CADASTRO do CRM** (regra do Mario, 24/08/2026):

1. **Closer** (Mario) — o número escolhido em Configurações → Perfil → "Meu
   número de WhatsApp"
2. **SDR** (David) — idem, no Perfil dele
3. **Assistente** (Claudio) — o chip que cria o grupo
   (`settings.grupo_da_reuniao.session_name`)
4. **O lead** — o telefone do contato do card

Quem é closer e quem é SDR sai de `organizations.settings.papeis` — os mesmos
papéis das tarefas automáticas. Nenhuma lista de telefone digitada à mão:
trocou de número, é só trocar no Perfil que o próximo grupo já nasce certo.

**Se faltar qualquer um dos 4, o grupo NÃO é criado** — a tela diz quem está
pendurado, a confirmação sai no privado do lead e a reunião fica marcada
normal. Grupo incompleto (sem a assistente, com número velho) era o bug de
24/08/2026: o WhatsApp adicionava o dono antigo do chip sem dar erro nenhum.

⚠️ A lista antiga (`grupo_da_reuniao.participantes` e a do bom-dia) **não vale
mais pro grupo**. O bom-dia e o aviso de 30 min continuam saindo pela lista do
`sixty_day_brief.recipients`, como sempre.

---

## Não quero grupo neste lead

Desmarque a caixinha na hora de marcar. A confirmação e os lembretes voltam
pro privado do lead, exatamente como era antes.

---

## Onde o código mora

- Regras puras: `lib/agendamento/grupo.ts`
- Criação: `lib/agendamento/grupo-criar.ts`
- A resposta de remarcação: `lib/agendamento/grupo-reacao.ts`
- Os textos: `lib/agendamento/mensagens.ts` (as funções com `NoGrupo` no nome)
- Criar grupo no WhatsApp: `WahaClient.createGroup` + `lib/waha/grupo.ts`
- Ler o que chega no grupo: `conversaDoGrupo` em `lib/waha/ingest.ts`

O grupo fica gravado em `crm_leads.custom_fields.grupo` — **sem migration**.
