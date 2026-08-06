# Publicar no crm.nexoialocal.com.br

O caminho curto, do seu localhost até o ar, com garantia de que é **a mesma
versão**. Para o passo a passo longo (homologação em subdomínio, rollback
detalhado, primeira instalação), veja
`NexoIAos/deploy/crm-deskcomm/PUBLICAR-REDESIGN.md` na pasta da Nexo.

- **VPS:** `145.223.94.63` · **Domínio:** `crm.nexoialocal.com.br`
- **Código:** branch `nexo-ia` de `github.com/mariochegou-creator/DeskcommCRM`

---

## A regra

O código viaja em três saltos, e **cada um só carrega o que o anterior já tem**:

```
sua máquina  ──commit+push──>  GitHub  ──build na VPS──>  no ar
```

Mudança sem commit não está no GitHub. Commit sem push não chega na VPS. Por
isso a pergunta "o que estou vendo no localhost é o que está no ar?" tem um
comando:

```bash
pnpm versao
```

Ele lê os três lugares e diz onde a corrente arrebentou. Rode antes e depois de
publicar. Não muda nada — só lê.

---

## 1. Ver na sua máquina

```bash
cd C:\Users\mario\deskcomm-teste
pnpm dev
```

Abre em <http://localhost:3000>. É o mesmo banco do domínio — o que você editar
aqui altera a produção. Só o **código** é diferente.

> **A cadência anti-vácuo não roda sozinha no localhost.** Quem a dispara é um
> relógio que só existe na VPS. Para vê-la trabalhar aqui, chame o relógio à mão:
>
> ```bash
> curl -H "Authorization: Bearer $INTERNAL_CRON_SECRET" \
>   http://localhost:3000/api/v1/cron/followup-flow-worker
> ```

---

## 2. Congelar o que você viu

```bash
git add -A
git commit -m "descreva o que mudou"
git push nexo nexo-ia
```

Rode `pnpm versao` de novo: `sua máquina` e `GitHub` têm que mostrar o **mesmo
commit**, e a sua máquina tem que estar sem arquivo solto.

---

## 3. Publicar

```bash
ssh root@145.223.94.63
cd /opt/deskcomm-nexo            # confirme com `docker compose ps` se o caminho mudou
```

**Ponto de retorno** (a imagem de hoje é o botão de desfazer):

```bash
docker inspect --format '{{.Config.Image}}' $(docker compose -f docker-compose.prod.yml ps -q app) \
  | tee ~/ROLLBACK-imagem.txt
```

**Trazer o código e carimbar a imagem com o commit:**

```bash
git fetch nexo nexo-ia && git checkout nexo-ia && git pull
git log --oneline -1                      # tem que bater com o `pnpm versao` da sua máquina

export APP_GIT_SHA=$(git rev-parse --short=7 HEAD)
export APP_IMAGE=deskcomm-nexo:$APP_GIT_SHA
```

O `APP_GIT_SHA` é o que faz a imagem saber quem ela é. Sem ele, o domínio volta
a não conseguir se identificar e o `pnpm versao` perde o terceiro elo.

A tag da imagem é o próprio commit, de propósito: `:latest` reaproveitado
sobrescreve o histórico e some com o rollback. Assim cada versão publicada
continua existindo no disco.

**Construir** (15 a 25 min, precisa de ~4 GB de RAM):

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.build.yml build app
```

**Subir:**

```bash
grep -q '^APP_IMAGE=' .env \
  && sed -i "s|^APP_IMAGE=.*|APP_IMAGE=$APP_IMAGE|" .env \
  || echo "APP_IMAGE=$APP_IMAGE" >> .env

grep -q '^APP_PULL_POLICY=' .env \
  && sed -i 's|^APP_PULL_POLICY=.*|APP_PULL_POLICY=never|' .env \
  || echo 'APP_PULL_POLICY=never' >> .env

docker compose -f docker-compose.prod.yml --env-file .env up -d app
```

`APP_PULL_POLICY=never` é o detalhe que mais dá dor de cabeça: o padrão do
compose é `always`, e com ele o próximo `up -d` baixaria a imagem genérica do
autor original por cima e apagaria tudo sem avisar.

---

## 4. Conferir

Da sua máquina:

```bash
pnpm versao
```

Os três têm que mostrar o mesmo commit. Se `no ar` continuar diferente, o
container subiu com a imagem velha — confira o `APP_IMAGE` no `.env` da VPS.

---

## Rollback

```bash
cat ~/ROLLBACK-imagem.txt
sed -i 's|^APP_IMAGE=.*|APP_IMAGE=<A-IMAGEM-DE-ANTES>|' .env
docker compose -f docker-compose.prod.yml --env-file .env up -d app
```

Volta em segundos: a imagem antiga continua no disco. Não rode
`docker image prune` até ter certeza da nova.

---

## Quando o banco muda junto

Migration e dado de configuração (fluxos, templates, agentes) **não** viajam na
imagem — eles moram no Supabase, que é o mesmo para o localhost e para o
domínio. Duas consequências:

1. Um script de seed rodado da sua máquina **já alterou a produção**, antes de
   qualquer deploy.
2. Se esse dado depende de código novo, ele fica gravado e **inerte** até a
   imagem subir — pior, pode ser ignorado em silêncio se o código antigo não
   entender o formato novo.

Por isso a ordem correta é **publicar o código primeiro, rodar o seed depois**.
