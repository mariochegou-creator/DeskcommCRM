---
title: HANDOFF — CRM no Android
date: 2026-08-22
status: em execução (bloco 1 e 2 feitos, sem prova visual)
---

# CRM no Android — o que quebra, na ordem de conserto

O alvo é o celular do dono usando o CRM de verdade: Pixel/Android, Chrome,
360–412px de largura. Não é "responsivo em geral" — é **o Painel, o Inbox, as
Tarefas e o Funil funcionando com o polegar**.

A régua já existia e nunca foi cumprida:
`docs/design-system/screen-flow/07-responsive-strategy.md`. Este handoff é a
mesma régua virada em fila de trabalho, com arquivo e linha.

## Como medir (antes de dizer "melhorou")

| Referência | Largura | Onde |
|---|---|---|
| Pixel 7 Chrome | 412px | referência Android (a do dono) |
| celular pequeno | 360px | piso — nada pode quebrar aqui |
| tablet | 768px | `md:` liga aqui |

Três coisas que só aparecem no aparelho e nunca no DevTools:
1. a barra do Chrome que some ao rolar (por isso `dvh`, nunca `vh`);
2. o teclado virtual cobrindo o composer;
3. o alvo de toque — o dedo tem ~9mm, o mínimo é 44×44px.

---

## Bloco 1 — base (feito)

Muda um lugar, conserta tudo.

- [x] **Modal com fundo falso.** `components/ui/dialog.tsx` — todo modal era
      `w-full max-w-lg` sem teto de altura: formulário alto (novo lead, agendar
      reunião, editar) crescia para fora da tela e o botão de salvar ficava num
      lugar sem rolagem. Agora `max-h-[85dvh] overflow-y-auto`,
      `w-[calc(100%-2rem)]` e `p-4 sm:p-6`. Atinge as 51 telas com `DialogContent`.
      Quem sobrescrever padding tem de sobrescrever os dois (ver `ImageMedia.tsx`).
- [x] **Formulário de duas colunas em 360px.** `grid-cols-2` virou
      `grid-cols-1 sm:grid-cols-2` em `NewLeadDialog`, `EditLeadDialog`,
      `LeadFieldsForm`, `settings/profile/_form`, `settings/tenant/_form`.

## Bloco 2 — Inbox (feito)

A tela onde ele passa o dia, e a que estava pior.

- [x] **Mestre/detalhe.** `components/inbox/InboxLayout.tsx` — no celular o
      grid caía para 1 coluna e empilhava lista **e** conversa dentro de uma
      altura fixa: a conversa nascia fora da tela, sem rolagem que a
      alcançasse. Agora é uma de cada vez (`selectedId` decide) com botão
      "‹ Conversas" que também aparece quando a conversa não carrega.
- [x] **Altura real.** Era `h-[calc(100vh-3.5rem)]` dentro de um `<main>` com
      `p-4 pb-20`: o composer nascia embaixo da barra de navegação. Agora
      desconta o respiro do main (`9.5rem` no celular, `6.5rem` no desktop) e
      usa `dvh`. Isso também conserta o desktop, que sobrava 48px.

## Bloco 3 — Funil (parcial)

- [x] **Swipe com parada.** `StageColumn` vira `w-[85vw]` no celular com
      `snap-start`; o trilho do `KanbanBoard` ganhou `snap-x snap-mandatory`.
      A fresta da próxima coluna é o que avisa que dá para deslizar.
- [ ] **"Mover para etapa" no menu do card.** Hoje só se move arrastando —
      e a régua (§Kanban) diz que no celular o arrasto não é o caminho.
      **Desenho já decidido:** a lógica mora em `KanbanBoard.handleDragEnd`
      (posição = topo da coluna, `midpoint`, e o dialog de agendar quando a
      etapa é de reunião). Extrair `moverLead(lead, destStageId)` e entregá-la
      ao `KanbanCardActions` por contexto — **não** chamar `useBoard` dentro do
      card: são N assinaturas de realtime, uma por card.
      Cuidado: pular o `handleDragEnd` significa pular o `AgendarReuniaoDialog`
      e produzir card em "R1 marcada" sem hora — exatamente a reunião que
      ninguém confirma.
- [ ] **Contador e nome da etapa fixos** ao deslizar (hoje some com o scroll).

## Bloco 4 — tabelas

- [x] **Contatos** — Email, Tags e Última atividade saem abaixo de `md`/`lg`.
      Sobram Nome, Telefone e Status: é com isso que se reconhece e se liga.
      (`components/contacts/ContactsTable.tsx`; mesmo padrão que `LeadsClient`.)
- [ ] **Métricas** (6 colunas), **Equipe** (6), **Auditoria** (7) — rolam na
      horizontal, ninguém lê. Mesma receita: esconder coluna secundária, ou
      virar cartão empilhado como manda a régua.

## Bloco 5 — alvo de toque

- [ ] Varrer `h-7`/`h-8`/`h-9` em botão de ícone das telas de trabalho e subir
      para 44px **só no celular** (`max-md:h-11 max-md:w-11`) — mexer no
      desktop mudaria a densidade que o redesign definiu.

## Bloco 6 — Painel

- [ ] `DashboardClient.tsx` tem dois `grid-cols-3` sem breakpoint (três colunas
      em 360px = 100px cada). **Não toquei: outra sessão estava editando esse
      arquivo.** Conferir `git status` antes.

---

## Ainda não provado

Nada aqui passou pela Doutrina de QA Visual (`CLAUDE.md`): as mudanças são de
layout, `pnpm typecheck` passa e `pnpm lint` só repete o erro que já existia em
`app/app/demo-nexo/Botoes.tsx`. **Falta abrir no aparelho** — Inbox (abrir uma
conversa e voltar), um modal alto e o funil deslizando — antes de chamar de
pronto.
