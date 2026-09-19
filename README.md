# @pulso/contracts

Contrato compartilhado entre o painel/API (`pulso-cmms`) e o aplicativo Android (`pulso-mobile`).

Este repositório existe porque os dois produtos passaram a viver separados. Antes da divisão, API e aplicativo liam **o mesmo arquivo**, e a compatibilidade era garantida pelo compilador. Agora ela é garantida por versionamento: a disciplina descrita abaixo substitui essa garantia.

## O que este pacote contém

| Subcaminho | Conteúdo | Quem consome |
|---|---|---|
| `@pulso/contracts` | Papéis, estados, transições permitidas, schemas zod das mutações, cálculo de ocorrência de plano e datas por fuso. | API, painel web, aplicativo |
| `@pulso/contracts/mobile` | Protocolo 1: login mobile, manifesto, envelope de operações, tipos de `pull` e leitura de QR. | API, aplicativo |
| `@pulso/contracts/offline` | Cliente de referência: `OfflineStore` (cache + outbox) e `SyncEngine` (política de reenvio, conflito e bloqueio). | Aplicativo; API apenas em teste |
| `@pulso/contracts/offline/testing` | Adaptador `node:sqlite` que implementa `SqlDatabase` para testes em Node. | Testes dos dois repositórios |

O cliente de sincronização mora aqui, e não no repositório do aplicativo, por dois motivos: ele é a implementação de referência do protocolo — `OfflineStore.apply()` recusa `protocol !== 1` e o `SyncEngine` implementa a política de erro documentada em `docs/API.md` — e o repositório da API precisa dele para o teste de ponta a ponta. npm e pnpm não resolvem subdiretório de repositório git, então um pacote separado exigiria um quarto repositório.

## Consumo

O pacote é distribuído por tag git, sem registry:

```sh
pnpm add github:Leo-501/pulso-contracts#v0.2.0
```

O `prepare` compila `dist/` na instalação, então os consumidores recebem JavaScript e `.d.ts` — não o TypeScript cru. É por isso que o Metro do aplicativo não precisa mais do `resolveRequest` customizado que existia antes da divisão.

### `zod` é peer dependency, de propósito

O filtro de exceções da API faz `error instanceof ZodError`. Se o pacote trouxesse a própria cópia de `zod`, um erro lançado por um schema daqui não seria reconhecido lá, e uma validação que deveria virar `400` viraria `500`. Manter `zod` como peer garante uma única instância no consumidor. **Não promova `zod` a dependency.**

## Disciplina de versionamento

Toda mudança publica uma tag nova. Os dois consumidores apontam para tags, nunca para `main`.

| Tipo de mudança | Efeito |
|---|---|
| Campo novo opcional, rótulo, regra que só restringe o cliente | patch |
| Entidade nova no `pull`, operação nova no envelope, schema novo | minor |
| Alteração de significado de campo existente, remoção, mudança em `protocol` | major, com plano de transição |

Antes de publicar uma tag: `pnpm typecheck && pnpm test`. Depois de publicar, atualize a referência nos dois repositórios **na mesma leva** e rode os testes de lá — em especial `tests/mobile-api.test.ts` no `pulso-cmms`, que é o único teste que exercita servidor e cliente juntos.

A regra que não pode ser quebrada: um aplicativo já instalado no aparelho do técnico continua falando com a API antiga. Mudança no significado de um campo existente sem `protocol` novo corrompe a fila offline de quem não atualizou.

## Desenvolvimento

```sh
pnpm install
pnpm typecheck
pnpm test
```

Os testes cobrem as regras de domínio (`tests/domain.test.ts`) e o store/engine offline com transporte simulado (`tests/offline.test.ts`), incluindo persistência entre reinícios, recusa de snapshot de outro escopo, conflito preservado e bloqueio por sessão revogada.

Durante desenvolvimento simultâneo com um dos consumidores, use um link local em vez de publicar tag a cada tentativa:

```sh
pnpm --dir ../pulso-cmms link ../pulso-contracts
```

Desfaça o link e volte para a tag antes de entregar.
