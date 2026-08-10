# Copiloto de Reunião — Nexo IA (extensão Chrome)

Pop-up flutuante no Google Meet que acompanha a reunião de venda (R1/R2),
mostra a fase do SPIN, sugere a próxima pergunta em texto curto e, ao
encerrar, manda a transcrição inteira para a aba **Sala de Reuniões** do CRM.

## Como instalar (uma vez por computador)

1. Abra o Chrome e digite na barra de endereço: `chrome://extensions`
2. Ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha esta pasta (`extension/`).
4. Clique na extensão → **Opções**:
   - **Endereço do CRM**: `http://localhost:3000` (ou a URL da VPS)
   - **Token**: no CRM, vá em **Configurações → API Tokens**, crie um token
     com o escopo `meetings:write`, copie e cole.
5. Clique **Salvar e testar conexão** → deve aparecer "✓ Conectado!".

## Como usar numa reunião

1. Entre no Google Meet normalmente.
2. **Ligue as legendas (botão CC), em português.** Sem legendas o copiloto
   não ouve nada — o painel avisa se estiverem desligadas.
3. No painel flutuante, clique **Iniciar R1** (diagnóstico) ou **Iniciar R2**
   (proposta).
4. Converse. O painel mostra a fase e a próxima pergunta.
5. Ao terminar, clique **Encerrar reunião**. Em ~1 minuto a análise completa
   aparece na aba **Sala de Reuniões** do CRM.

## A bolinha de saúde (canto do painel)

- 🟢 verde — legendas chegando, tudo gravando
- 🟡 amarelo — 30 segundos sem legenda nova (silêncio, ou o CC caiu)
- 🔴 vermelho — não estou achando as legendas (religue o CC)

## Se o Google mudar o Meet e a captura parar

Os seletores de DOM ficam TODOS no objeto `CONFIG` no topo de
`content/meet-captions.js`. É o único lugar a mexer.
