# Vocabulário do Pulso

Um termo, uma palavra, em todo lugar: banco, API, contrato, painel e aplicativo.

A regra que este documento existe para proteger é simples — **não há tradução em
lugar nenhum**. O que se chama `ordens` no PostgreSQL chama-se `ordens` no JSON e
`ordens` no React. Quem escreve uma consulta nova não precisa saber o nome antigo
de nada, porque não existe nome antigo.

## Por que isto foi feito

O schema nasceu em inglês por inércia, enquanto comentários, mensagens de erro e
interface sempre foram em português. Quem lia o código vivia traduzindo: `parts`
virava "peças" na tela, `downtime_events` virava "paradas", `storekeeper` virava
"almoxarife". Duas línguas para as mesmas coisas é imposto cobrado em toda leitura.

Foi feito agora porque nada está em produção. Mais tarde custaria migração de
dados, migração de instalações do aplicativo e coordenação entre produtos.

## Entidades

| Antes | Agora | Chave estrangeira |
|---|---|---|
| `tenants` | `empresas` | `empresa_id` |
| `sites` | `unidades` | `unidade_id` |
| `app_users` | `pessoas` | `pessoa_id` |
| `memberships` | `vinculos` | — |
| `membership_sites` | `vinculo_unidades` | — |
| `sessions` | `sessoes` | — |
| `service_clients` | `clientes_servico` | — |
| `assets` | `ativos` | `ativo_id` |
| `service_requests` | `solicitacoes` | `solicitacao_id` |
| `maintenance_plans` | `planos` | `plano_id` |
| `work_orders` | `ordens` | `ordem_id` |
| `work_order_events` | `eventos_ordem` | — |
| `labor_entries` | `apontamentos` | — |
| `downtime_events` | `paradas` | — |
| `parts` | `pecas` | `peca_id` |
| `stock_movements` | `movimentacoes` | — |
| `audit_logs` | `auditoria` | — |
| `sync_operations` | `operacoes` | — |
| `identity_projection` | `projecao_identidade` | — |
| `schema_migrations` | `migracoes` | — |

`ordem` em vez de `ordem_servico` porque é o que se fala na oficina, e neste
domínio não há outra ordem com que confundir.

`apontamentos` é o termo de manutenção para registro de tempo trabalhado, e diz
mais do que a tradução literal de `labor_entries`.

## Campos

### Comuns

| Antes | Agora |
|---|---|
| `tenant_id` | `empresa_id` |
| `site_id` | `unidade_id` |
| `user_id` | `pessoa_id` |
| `name` | `nome` |
| `code` | `codigo` |
| `active` | `ativo` |
| `created_at` | `criado_em` |
| `updated_at` | `atualizado_em` |
| `started_at` | `iniciado_em` |
| `ended_at` | `encerrado_em` |
| `status` | `situacao` |
| `kind` / `type` | `tipo` |
| `quantity` | `quantidade` |
| `reason` | `motivo` |
| `note` | `observacao` |
| `title` | `titulo` |
| `description` | `descricao` |

### Quem fez o quê

| Antes | Agora |
|---|---|
| `actor_id` | `autor_id` |
| `created_by` | `autor_id` |
| `assigned_to` | `responsavel_id` |
| `requested_by` | `solicitante_id` |
| `restored_by` | `retomado_por` |

`autor_id` unifica `actor_id` e `created_by`, que sempre significaram a mesma
coisa — quem praticou o ato — e diferiam só por descuido.

### Identidade

| Antes | Agora |
|---|---|
| `slug` | `apelido` |
| `password_hash` | `senha_hash` |
| `must_change_password` | `trocar_senha` |
| `role` | `papel` |
| `token_hash` | `token_hash` |
| `expires_at` | `expira_em` |
| `device_id` | `dispositivo_id` |
| `secret_hash` | `segredo_hash` |
| `last_seen_at` | `visto_em` |
| `city` | `cidade` |
| `timezone` | `fuso` |

### Manutenção

| Antes | Agora |
|---|---|
| `location` | `local` |
| `criticality` | `criticidade` |
| `manufacturer` | `fabricante` |
| `model` | `modelo` |
| `qr_token` | `token_qr` |
| `machine_stopped` | `maquina_parada` |
| `observed_at` | `observado_em` |
| `triage_reason` | `motivo_triagem` |
| `frequency` | `frequencia` |
| `interval` | `intervalo` |
| `anchor_date` | `data_base` |
| `lead_days` | `dias_antecedencia` |
| `next_index` | `proximo_indice` |
| `next_due` | `proximo_vencimento` |
| `number` | `numero` |
| `due_date` | `prazo` |
| `version` | `versao` |
| `priority` | `prioridade` |
| `occurrence_date` | `data_ocorrencia` |
| `resolution` | `resolucao` |
| `closed_at` | `encerrado_em` |
| `restored_at` | `retomado_em` |
| `unit` | `unidade_medida` |
| `minimum` | `minimo` |
| `operation_id` | `operacao_id` |
| `fingerprint` | `assinatura` |
| `result` | `resultado` |
| `action` | `acao` |
| `detail` | `detalhe` |
| `entity_id` | `entidade_id` |

**`unit` virou `unidade_medida`, e não `unidade`.** Unidade já é a filial da
empresa. Deixar as duas com o mesmo nome seria trocar um problema de idioma por
um de ambiguidade, que é pior.

## Valores

| Conceito | Antes | Agora |
|---|---|---|
| Papel | `admin`, `manager`, `technician`, `operator`, `storekeeper`, `viewer` | `administrador`, `gestor`, `tecnico`, `solicitante`, `almoxarife`, `consulta` |
| Criticidade e prioridade | `critical`, `high`, `medium`, `low` | `critica`, `alta`, `media`, `baixa` |
| Situação da ordem | `open`, `planned`, `in_progress`, `paused`, `review`, `closed`, `cancelled` | `aberta`, `planejada`, `em_execucao`, `pausada`, `validacao`, `concluida`, `cancelada` |
| Tipo de ordem | `corrective`, `preventive` | `corretiva`, `preventiva` |
| Situação da solicitação | `new`, `approved`, `rejected` | `nova`, `aprovada`, `rejeitada` |
| Frequência | `weekly`, `monthly` | `semanal`, `mensal` |
| Tipo de movimentação | `receipt`, `issue`, `return`, `adjustment` | `entrada`, `saida`, `devolucao`, `ajuste` |
| Tipo de sessão | `web`, `mobile` | `painel`, `aplicativo` |

`operator` virou `solicitante` porque é assim que a interface sempre o chamou. O
nome interno estava em desacordo com o que a pessoa lia na tela.

## Papéis de banco

| Antes | Agora |
|---|---|
| `cmms_app` | `app_cmms` |
| `identity_app` | `app_identidade` |

## As exceções, e por que existem

**`checklist`** fica. É palavra incorporada ao português técnico de manutenção, e
`lista_de_verificacao` seria mais longa sem ser mais clara — como traduzir
"software".

**`id`, `email`, `token`, `hash`, `qr`, `jsonb`, `uuid`** ficam. São termos
universais ou tipos do próprio PostgreSQL.

**`un`, `L`, `kg`, `m`** ficam. São símbolos do Sistema Internacional, não
palavras em inglês.

**`web`** some como valor, mas sobrevive em `WEB_ORIGIN`, que é configuração de
infraestrutura e não vocabulário de domínio.

## Como usar este documento

Ao acrescentar campo ou tabela, escolha o termo que a pessoa que opera a fábrica
usaria, não a tradução do termo em inglês que você tinha em mente. `apontamentos`
não é tradução de `labor_entries`; é a palavra que já existia no ofício.

E ao encontrar um nome em inglês em qualquer lugar, é defeito — não estilo antigo
tolerado.
