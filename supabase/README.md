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
