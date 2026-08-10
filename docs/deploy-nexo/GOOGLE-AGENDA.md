# Ligar o Google Agenda no CRM

Quando isto estiver ligado, marcar uma reunião no Kanban cria o evento na sua
agenda sozinho.

**Enquanto não estiver ligado, nada quebra:** a reunião é marcada, a confirmação
sai no WhatsApp, os lembretes saem — e a tela mostra um botão **"Adicionar na
minha agenda"** que faz o evento em um clique.

São 4 valores para descobrir. Faz uma vez só.

---

## Parte 1 — criar o acesso no Google (10 min)

1. Abra <https://console.cloud.google.com/> com a conta do Google **cuja agenda
   você quer usar**.
2. No topo, **Selecionar projeto → Novo projeto**. Nome: `CRM Nexo`. Criar.
3. Busque **"Google Calendar API"** na barra de pesquisa → **Ativar**.
4. Menu → **APIs e serviços → Tela de permissão OAuth**:
   - Tipo: **Externo** → Criar
   - Nome do app: `CRM Nexo`, e-mail de suporte: o seu
   - Salvar e continuar até o fim
   - **Depois volte nessa tela e clique em `PUBLICAR APP`** (botão "Publicar" →
     confirmar). Isto é o passo que mais gente pula, e ele importa: app deixado
     em "Teste" faz o Google **derrubar o acesso a cada 7 dias**, e aí os
     eventos param de entrar na agenda sem aviso.
5. Menu → **APIs e serviços → Credenciais → Criar credenciais → ID do cliente
   OAuth**:
   - Tipo: **Aplicativo da Web**
   - Em **URIs de redirecionamento autorizados**, adicione exatamente:
     `https://developers.google.com/oauthplayground`
   - Criar. O Google mostra **ID do cliente** e **Chave secreta do cliente** —
     guarde os dois.

## Parte 2 — pegar o token (5 min)

6. Abra <https://developers.google.com/oauthplayground/>
7. Clique na **engrenagem** (canto superior direito) → marque
   **"Use your own OAuth credentials"** → cole o **ID do cliente** e a **Chave
   secreta** da Parte 1.
8. Na caixa da esquerda ("Input your own scopes"), cole:
   `https://www.googleapis.com/auth/calendar.events`
9. **Authorize APIs** → escolha a sua conta → se aparecer "app não verificado",
   clique em **Avançado → Acessar CRM Nexo**.
10. Clique em **Exchange authorization code for tokens**.
11. Copie o valor de **Refresh token** (começa com `1//`).

## Parte 3 — colar no CRM

### Na sua máquina (para testar em `localhost`)

Abra `C:\Users\mario\deskcomm-teste\.env.local` e acrescente no fim:

```
GOOGLE_CALENDAR_CLIENT_ID=cole_aqui
GOOGLE_CALENDAR_CLIENT_SECRET=cole_aqui
GOOGLE_CALENDAR_REFRESH_TOKEN=cole_aqui
GOOGLE_CALENDAR_ID=
```

Depois reinicie o `pnpm dev`.

### Na VPS (para valer)

```bash
nano /opt/deskcomm/.env          # acrescente as 4 linhas acima
docker compose -f docker-compose.prod.yml --env-file .env up -d app
```

`GOOGLE_CALENDAR_ID` vazio = agenda principal da conta. Para jogar numa agenda
separada, abra a agenda desejada no Google → **Configurações → Integrar agenda →
ID da agenda** e cole aquele valor.

---

## Como saber se funcionou

Marque uma reunião de teste em qualquer card. A janelinha, depois de salvar,
diz uma das duas coisas:

- **"Evento criado no Google Agenda."** → está ligado.
- **"Google Agenda ainda não conectado."** → os valores não chegaram no app
  (reinicie o container) ou o Google recusou.

Se um dia voltar a aparecer a segunda mensagem sem você ter mexido em nada, o
acesso caiu — o caminho é refazer a Parte 2 (e conferir se o app está mesmo
**publicado**, passo 4).
