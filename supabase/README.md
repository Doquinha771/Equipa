# Supabase do Equipa

## Situação real do banco (verificada em 16/11/2026)

O banco em produção evoluiu além das migrations deste diretório. Pontos que
diferem do que os arquivos mais antigos sugerem:

- `public.equipments` é uma **visão** (`security_invoker`) sobre `equipment_units`
  + `equipment_variants` + `equipment_model_catalog` + `equipment_manufacturers` +
  `equipment_categories` + `equipment_locations`. Inserir, alterar e apagar passam
  pelo gatilho `INSTEAD OF` `private.equipments_compat_write()`, que cria ou
  reaproveita a variante e o local corretos (editar um equipamento nunca altera os
  outros do mesmo modelo).
- `public.equipment_models` é uma visão **somente leitura** do catálogo. As fichas
  editáveis de modelo ficam em `public.equipa_model_profiles`.
- `equipment_cart_items.equipment_id` é **único**: um computador fica em um carrinho
  só. `equipment_carts.number` é único **inclusive entre carrinhos desativados**.
- Algumas funções (por exemplo `private.save_equipment_cart_internal`,
  `private.resolve_equipment_variant`) foram criadas direto no banco.

Antes de escrever uma migration, confira o banco real com consultas somente de
leitura (exemplos abaixo) em vez de confiar só nos arquivos antigos.

## Migration 1.0 (aplicada)

`migrations/20261116010000_equipa_1_0_carts_models_settings.sql` — aditiva:

- `equipa_save_cart(...)` / `private.save_equipment_cart_v3_internal`: salva carrinho
  com erros claros (`EQUIPA_CART_UNKNOWN_CODES`, `EQUIPA_CART_EQUIPMENT_TAKEN`,
  `EQUIPA_CART_NUMBER_TAKEN`…), reaproveita carrinho desativado com o mesmo número
  e move equipamentos entre carrinhos só quando pedido (`p_move`). A função antiga
  `save_equipment_cart_v2` passa a usar a nova.
- Coluna `specs jsonb` em `equipment_units` (campos personalizados), exposta pela
  visão `equipments` e gravada pelo gatilho de escrita.
- Tabelas `equipa_model_profiles` e `equipa_settings`, com RLS (leitura para contas
  ativas, escrita só administração).

No repositório o arquivo traz a parte de carrinhos e a parte de campos/ajustes; em
produção ela foi aplicada em duas execuções no SQL Editor.

## Correção 1.3 (aplicada em 16/11/2026)

`migrations/20261116020000_equipa_1_3_reports_group_by_fix.sql` — “Relatório
indisponível” (42803). Em `private.reports_internal` o ranking “Mais usados” agrupava
só por `e.id`; com `equipments` sendo visão, o PostgreSQL exige `e.code` no
`GROUP BY`. Corrigido para `group by e.id, e.code`. Validado chamando
`equipa_admin_report_dashboard` e `equipa_admin_reports` como administrador.

## Migration 1.4 — excluir de vez (aplicada em 16/11/2026)

`migrations/20261116030000_equipa_1_4_purge_equipment.sql` — nova RPC
`equipa_purge_equipment(p_ids uuid[])` (só administração, até 500 por vez), usada
por “Excluir” em Equipamentos (botão direito ou seleção):

- **Apaga de vez** quem nunca teve retirada, manutenção nem uso mensal (os registros
  de cadastro/desativação em `equipment_history` vão junto; vagas de carrinho saem
  pela FK em cascata).
- **Só tira do catálogo** quem tem histórico de uso (as retiradas antigas continuam
  válidas).
- **Não mexe** em equipamento emprestado ou com manutenção aberta, e informa.
- Registra cada exclusão em `audit_events` (quem, quais números).
- As travas `equipments_prevent_delete` e `audit_equipments_changes` continuam
  recusando qualquer DELETE feito fora desta função; a liberação é uma configuração
  local da transação (`equipa.allow_purge`).

Sem a migration aplicada, o site cai no comportamento antigo (tirar do catálogo).

Validada em 16/11/2026 no banco real **dentro de uma transação desfeita** (erro
proposital no fim): apagou 1 sem histórico, só arquivou 1 com histórico, e um DELETE
direto continuou bloqueado. Depois disso a função não existia e as 47 unidades
continuavam lá. Aplicada em seguida e conferida: função criada, executável por
`authenticated` e não por `anon`, travas e auditoria atualizadas, 47 unidades intactas.

Para conferir:

```sql
select to_regprocedure('public.equipa_purge_equipment(uuid[])') is not null as purge_ok;
```

## Pontos de atenção

- Alterações em equipamentos (cadastro, edição, desativação, reativação) são
  registradas em `public.equipment_history` (ações 1–4) pela função
  `private.audit_row_change`, e não em `audit_events`. A tela Auditoria mostra
  `audit_events`; o histórico de cada equipamento fica na ficha.
- Equipamentos fora do catálogo voltam por: Equipamentos → ⋯ → “Ver fora do
  catálogo” → editar → marcar “Ativo no catálogo”.

## Como validar (somente leitura)

```sql
select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='equipments' and column_name='specs') as specs_na_visao,
  to_regclass('public.equipa_model_profiles') is not null as fichas,
  to_regclass('public.equipa_settings') is not null as ajustes,
  to_regprocedure('public.equipa_save_cart(bigint,integer,text,text[],text,integer,text,boolean)') is not null as salvar_carrinho;
```

Para conferir se todas as RPCs que o site usa existem, liste os nomes em
`assets/js` (`rpc("...")`) e consulte `pg_proc` no schema `public`.

Última conferência (16/11/2026, versão 1.3.0, somente leitura): as **27 RPCs** e as
**10 tabelas/visões** usadas pelo site existem, todas executáveis/legíveis pelo papel
`authenticated`; RLS ativa em todas as tabelas (inclusive as que ficam por trás das
visões `equipments` e `equipment_models`: `equipment_units`, `equipment_variants`,
`equipment_model_catalog`, `equipment_manufacturers`, `equipment_categories`,
`equipment_locations`, `equipment_cart_items`).

## Arquivos auxiliares

- `AUTH-REDIRECT.md` — links de e-mail caindo em `localhost`.
- `DIAGNOSTICO-RECUPERACAO.sql`, `CALCULO-CAPACIDADE.sql` — consultas de capacidade
  (somente leitura).
- `INSTALL-CRON.sql` — só para instalar o cron de auditoria em outro banco (já ativo
  no projeto atual).
- `functions/equipa-admin-users` — Edge Function de aprovação, remoção e banimento
  de contas. Exige `EQUIPA_ALLOWED_ORIGINS`.
