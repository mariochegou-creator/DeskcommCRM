/**
 * Minimal WAHA REST client used during onboarding (and elsewhere). Returns
 * `null` from `getWahaClient()` when env is not configured so callers can
 * gracefully render a "Docker is not up" banner instead of crashing.
 *
 * WAHA Plus auth: `X-Api-Key` header. The current devlikeapro/waha-plus
 * image expects the SHA512 HEX HASH directly in the header (matches what's
 * stored in container env). Plaintext-then-hash is NOT used in this version.
 * So WAHA_API_KEY in .env.local IS the hex hash.
 */
import { extrairChatIdDoGrupo, participantesQueFaltaram } from "./grupo";

export class WahaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  /**
   * Idempotent: ensures session exists, then starts it.
   * WAHA Plus split the API:
   *   POST /api/sessions               → create (422 if exists)
   *   POST /api/sessions/{name}/start  → start (422 if already starting/working)
   */
  async startSession(name: string): Promise<{ qr?: string; status: string }> {
    // 1) Create session (ignore 422/409 = already exists)
    const createRes = await fetch(`${this.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "X-Api-Key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ name, config: {} }),
    });
    if (!createRes.ok && createRes.status !== 422 && createRes.status !== 409) {
      const body = await createRes.text().catch(() => "");
      throw new Error(`waha_create_${createRes.status}: ${body.slice(0, 200)}`);
    }

    // 2) Start session
    const startRes = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(name)}/start`,
      {
        method: "POST",
        headers: { "X-Api-Key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    if (!startRes.ok && startRes.status !== 422 && startRes.status !== 409) {
      const body = await startRes.text().catch(() => "");
      throw new Error(`waha_start_${startRes.status}: ${body.slice(0, 200)}`);
    }
    if (startRes.status === 422 || startRes.status === 409) {
      // Already started — fetch and return current state
      return this.getSessionQr(name);
    }
    return (await startRes.json()) as { qr?: string; status: string };
  }

  /**
   * Stop a session. Idempotent: 404 (unknown) / 422 / 409 (already stopped)
   * are treated as success so callers can compose reconnect = stop + start.
   */
  async stopSession(name: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(name)}/stop`,
      {
        method: "POST",
        headers: { "X-Api-Key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    if (!res.ok && ![404, 422, 409].includes(res.status)) {
      const body = await res.text().catch(() => "");
      throw new Error(`waha_stop_${res.status}: ${body.slice(0, 200)}`);
    }
  }

  /**
   * Apaga a sessão do WAHA de vez — logout (desvincula o aparelho na tela
   * "Aparelhos conectados" do celular) + DELETE (remove a credencial salva).
   *
   * ⚠️ `stopSession` NÃO basta e foi o furo da primeira versão do "remover
   * número": o WAHA guarda a sessão em disco e o container sobe com
   * `restart: unless-stopped`, então a sessão parada **voltava sozinha para
   * WORKING** no próximo restart — número removido do painel, mas ainda
   * plugado no celular do dono.
   *
   * Tolerante por desenho: 404 (já não existe), 422/409 (estado que não
   * permite a operação) e 501 (WAHA Core sem o endpoint) contam como sucesso.
   * Remover do painel não pode falhar por causa do que o WAHA respondeu.
   */
  async deleteSession(name: string): Promise<void> {
    const alvo = `${this.baseUrl}/api/sessions/${encodeURIComponent(name)}`;
    const okish = [404, 422, 409, 501];

    // 1) logout — é o que solta o aparelho do lado do WhatsApp.
    const outRes = await fetch(`${alvo}/logout`, {
      method: "POST",
      headers: { "X-Api-Key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (outRes && !outRes.ok && !okish.includes(outRes.status)) {
      const body = await outRes.text().catch(() => "");
      throw new Error(`waha_logout_${outRes.status}: ${body.slice(0, 200)}`);
    }

    // 2) delete — some com a sessão e com a credencial em disco.
    const delRes = await fetch(alvo, {
      method: "DELETE",
      headers: { "X-Api-Key": this.apiKey },
    });
    if (!delRes.ok && !okish.includes(delRes.status)) {
      const body = await delRes.text().catch(() => "");
      throw new Error(`waha_delete_${delRes.status}: ${body.slice(0, 200)}`);
    }
  }

  /**
   * Todas as sessões do WAHA, com o número de cada uma (`me.id`).
   *
   * É a única fonte confiável de "que número é este canal": quando o mesmo
   * WhatsApp está em duas sessões, a unique do banco deixa `phone_number` vazio
   * numa delas — a coluna mente, o WAHA não.
   */
  async listSessions(): Promise<Array<{ name: string; status: string; me?: { id?: string } | null }>> {
    const res = await fetch(`${this.baseUrl}/api/sessions?all=true`, {
      headers: { "X-Api-Key": this.apiKey },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`waha_${res.status}`);
    return (await res.json()) as Array<{ name: string; status: string; me?: { id?: string } | null }>;
  }

  async getSessionQr(name: string): Promise<{ qr?: string; status: string }> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(name)}`, {
      headers: { "X-Api-Key": this.apiKey },
    });
    if (!res.ok) throw new Error(`waha_${res.status}`);
    return (await res.json()) as { qr?: string; status: string };
  }

  async sendMessage(session: string, chatId: string, text: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/api/sendText`, {
      method: "POST",
      headers: {
        "X-Api-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ session, chatId, text }),
    });
    if (!res.ok) throw new Error(`waha_${res.status}`);
    return res.json();
  }

  /**
   * Cria um grupo do WhatsApp e devolve o `…@g.us` dele.
   *
   * O número da própria sessão entra como DONO automaticamente — não deve ir
   * na lista de participantes (o WhatsApp recusa o convite a si mesmo, e o
   * WAHA devolve isso como participante que falhou, poluindo o diagnóstico).
   *
   * `faltaram` é a parte que não pode ser engolida: quem tem "só quem eu
   * conheço" no controle de privacidade de grupos NÃO entra, e o grupo é
   * criado assim mesmo. Sem essa lista de volta, o CRM diria "grupo criado com
   * o David" e o David não estaria lá.
   */
  async createGroup(
    session: string,
    name: string,
    participants: string[],
  ): Promise<{ chatId: string; faltaram: string[] }> {
    const res = await fetch(`${this.baseUrl}/api/${encodeURIComponent(session)}/groups`, {
      method: "POST",
      headers: { "X-Api-Key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ name, participants: participants.map((id) => ({ id })) }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`waha_group_${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as unknown;
    const chatId = extrairChatIdDoGrupo(json);
    if (!chatId) {
      // O grupo pode ter sido criado do lado do WhatsApp; o que não dá é seguir
      // sem o endereço — ver o cabeçalho de lib/waha/grupo.ts.
      throw new Error(`waha_group_sem_id: ${JSON.stringify(json).slice(0, 200)}`);
    }
    return { chatId, faltaram: participantesQueFaltaram(json) };
  }

  /**
   * A foto de perfil que o próprio WhatsApp mostra para este contato.
   *
   * `null` é resposta normal, não erro: contato sem foto, ou com privacidade
   * "só meus contatos" — a sessão da assistente quase nunca está na agenda do
   * lead. Quem chama decide o que fazer sem foto (em geral, nada).
   */
  async getProfilePictureUrl(session: string, contactId: string): Promise<string | null> {
    const res = await fetch(
      `${this.baseUrl}/api/contacts/profile-picture?contactId=${encodeURIComponent(contactId)}&session=${encodeURIComponent(session)}`,
      { headers: { "X-Api-Key": this.apiKey }, cache: "no-store" },
    );
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { profilePictureURL?: string | null } | null;
    const url = json?.profilePictureURL;
    return typeof url === "string" && url.length > 0 ? url : null;
  }

  /**
   * Troca a foto do grupo. A URL é baixada pelo PRÓPRIO WAHA (campo `file.url`),
   * então serve a URL do CDN do WhatsApp direto — nada passa pelo Next.
   *
   * 501 = o motor não implementa. Vira erro normal e quem chama trata como
   * enfeite que falhou, nunca como grupo quebrado.
   */
  async setGroupPicture(session: string, groupId: string, url: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/${encodeURIComponent(session)}/groups/${encodeURIComponent(groupId)}/picture`,
      {
        method: "PUT",
        headers: { "X-Api-Key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ file: { url } }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`waha_group_picture_${res.status}: ${body.slice(0, 200)}`);
    }
  }

  async sendMedia(
    session: string,
    chatId: string,
    plan: { endpoint: string; payload: Record<string, unknown> },
  ): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/api/${plan.endpoint}`, {
      method: "POST",
      headers: { "X-Api-Key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ session, chatId, ...plan.payload }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`waha_${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }
}

/**
 * Traduz erros crus do WAHA (fetch failed, ECONNREFUSED, timeout) numa
 * mensagem clara para o usuário. Usado quando o container não está no ar.
 */
export function wahaFriendlyError(msg: string): string {
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|und_err|network|timeout|socket|EAI_AGAIN/i.test(msg)) {
    return "O serviço do WhatsApp (WAHA) não está respondendo. Confirme que o container está no ar e tente de novo.";
  }
  return `Falha na comunicação com o WhatsApp (WAHA): ${msg}`;
}

/**
 * Returns a configured client or null. Null means the WAHA Docker isn't up
 * or the env is using the dev placeholder; the UI must render a banner
 * prompting the user to start it.
 */
export function getWahaClient(): WahaClient | null {
  const url = process.env.WAHA_API_BASE_URL;
  const key = process.env.WAHA_API_KEY;
  if (!url || !key || key === "dev_plaintext_change_me") return null;
  return new WahaClient(url, key);
}
