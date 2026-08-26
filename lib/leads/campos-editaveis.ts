/**
 * Site e Instagram do negócio, para o formulário do dossiê editar.
 *
 * ELES NÃO SÃO COLUNAS. Moram em `crm_leads.custom_fields`, sob a chave que a
 * lista de prospecção usou — e as listas não concordam entre si: a importação
 * genérica grava o cabeçalho do CSV como veio (`Site`, `Instagram` — 196 e 58
 * leads nesta base) e o importador do Kaptar grava minúsculo (`site`,
 * `instagram`). Um formulário que escrevesse numa chave fixa criaria a SEGUNDA
 * chave no mesmo lead, e o dossiê passaria a mostrar `Site` e `site` lado a
 * lado com valores diferentes — sem nada dizendo qual vale.
 *
 * Daí este módulo: a chave de escrita é a que o lead JÁ TEM; a chave padrão só
 * entra quando não há nenhuma. Puro, sem I/O — o formulário roda no navegador.
 */

const SITE_RE = /^(site|website)$/i;
const INSTAGRAM_RE = /^instagram$/i;
const TEM_SITE_RE = /^tem[_ ]?site$/i;
const TEM_INSTAGRAM_RE = /^tem[_ ]?instagram$/i;

/** A convenção majoritária desta base — usada só quando o lead não tem nenhuma. */
const CHAVE_SITE_PADRAO = "Site";
const CHAVE_INSTAGRAM_PADRAO = "Instagram";

type Campos = Record<string, unknown>;

function comoObjeto(customFields: unknown): Campos {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) return {};
  return customFields as Campos;
}

/** A chave que este lead usa para o campo, ou `null` se ele não tem nenhuma. */
function chaveExistente(customFields: unknown, re: RegExp): string | null {
  for (const chave of Object.keys(comoObjeto(customFields))) {
    if (re.test(chave)) return chave;
  }
  return null;
}

/** O valor guardado, como texto. `""` quando não existe — é o que o input espera. */
function valor(customFields: unknown, re: RegExp): string {
  const chave = chaveExistente(customFields, re);
  if (!chave) return "";
  const v = comoObjeto(customFields)[chave];
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

export function siteDoLead(customFields: unknown): string {
  return valor(customFields, SITE_RE);
}

export function instagramDoLead(customFields: unknown): string {
  return valor(customFields, INSTAGRAM_RE);
}

/**
 * `instagram.com/fulano` e `@fulano` viram endereço clicável.
 *
 * Sem isto, o que o SDR copia do Maps ou digita de cabeça entra como texto
 * solto: `LeadExtrasList` só transforma em link o que casa com `^https?://`, e
 * o campo que ele acabou de preencher para poder CLICAR depois não seria
 * clicável. Texto que não parece endereço nenhum (o `não tem (conferido nos
 * resultados da web)` que a varredura grava em 97 leads) passa intacto — a
 * anotação é resposta legítima do campo.
 */
export function normalizarLink(bruto: string, tipo: "site" | "instagram"): string {
  const v = bruto.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;

  if (tipo === "instagram" && /^@[A-Za-z0-9._]+$/.test(v)) {
    return `https://www.instagram.com/${v.slice(1)}`;
  }
  // Domínio digitado sem o protocolo (`nexoialocal.com.br`, `instagram.com/x`).
  // O ponto seguido de letra é o que separa domínio de frase: "não tem" não casa.
  if (/^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)+(\/\S*)?$/.test(v)) {
    return `https://${v}`;
  }
  return v;
}

/**
 * O patch de `custom_fields` para o PATCH do lead — só as chaves que mudaram de
 * verdade, na chave que o lead já usa.
 *
 * `null` remove (limpar o campo apaga a chave em vez de gravar `""` — ver o
 * handler). O par `Tem site` / `Tem Instagram` é ATUALIZADO JUNTO, e só quando
 * o lead já o tem: sem isso o dossiê mostraria `Tem site: Não` logo acima do
 * endereço que a pessoa acabou de cadastrar, e é o "Não" que a leitura rápida
 * pega. Nunca é criado do zero — lead que não tinha a coluna não passa a ter.
 */
export function patchDosLinks(
  customFields: unknown,
  entrada: { site: string; instagram: string },
): Record<string, string | boolean | null> {
  const patch: Record<string, string | boolean | null> = {};

  const aplicar = (
    re: RegExp,
    chavePadrao: string,
    temRe: RegExp,
    tipo: "site" | "instagram",
    bruto: string,
  ) => {
    const novo = normalizarLink(bruto, tipo);
    if (novo === valor(customFields, re)) return;

    patch[chaveExistente(customFields, re) ?? chavePadrao] = novo || null;

    const chaveTem = chaveExistente(customFields, temRe);
    if (!chaveTem) return;
    // Presença é ter ENDEREÇO, não ter o campo preenchido: `não tem (conferido
    // nos resultados da web)` é conteúdo do campo e continua valendo "Não".
    const tem = /^https?:\/\//i.test(novo);
    patch[chaveTem] =
      typeof comoObjeto(customFields)[chaveTem] === "boolean" ? tem : tem ? "Sim" : "Não";
  };

  aplicar(SITE_RE, CHAVE_SITE_PADRAO, TEM_SITE_RE, "site", entrada.site);
  aplicar(INSTAGRAM_RE, CHAVE_INSTAGRAM_PADRAO, TEM_INSTAGRAM_RE, "instagram", entrada.instagram);

  return patch;
}
