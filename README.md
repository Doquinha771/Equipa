# Equipa

**Controle dos computadores e carrinhos da escola** — E.E. Amador e Catharina.

O Equipa registra quem retirou cada equipamento, até quando, onde está, em qual
carrinho fica guardado e o histórico de tudo. É um site estático (GitHub Pages)
ligado a um projeto Supabase (PostgreSQL), sem servidor próprio e sem etapa de build.

Versão atual: **1.3.0** (`assets/js/config.js`).

## O que o sistema faz

| Área | Para quê |
|---|---|
| **Início** | Situação agora (disponíveis, em uso, atrasados, manutenção), ações frequentes e retiradas em andamento. |
| **Equipamentos** | Inventário por modelo ou em lista, busca, filtros de situação e de pendências de cadastro (sem carrinho, sem local, sem tipo, sem plataforma, sem série). Seleção por clique, arrasto e botão direito; ficha, edição individual e em grupo, renumeração, exclusão. |
| **Controle** | Painel de comandas (atrasadas, vencendo em 1 h, no prazo, recebidas hoje), visão “Minhas/Todas”, histórico, balcão de retirada e recebimento com conferência (recebido, avaria, não achado). |
| **Carrinhos** | Quadro de carrinhos, página de cada carrinho com as vagas e a ficha do computador de cada vaga, editor (só computadores cadastrados, por modelo ou tipo), mover/tirar vários, conferência pela câmera, exclusão. |
| **Câmera** | Identificar, retirar, receber, conferir carrinho e cadastrar: QR Code, código de barras e leitura de texto (número colado no PC ou etiqueta de baixo) feita no próprio navegador. |
| **Cadastro** | “Do 1 até o 30 + modelo”, um só, pela câmera ou por planilha (CSV, Excel, Word). Herança dos dados do modelo; números existentes nunca duplicam (opção “Substituir dados”). |
| **Etiquetas QR** | Gerador com prévia na tela, três tamanhos, impressão em página própria e PDF. |
| **Planilha** | Cada equipamento com número, modelo, carrinho, onde está agora, com quem e prazo; uma aba por carrinho para conferência. |
| **Manutenção** | Pendências por tempo parado, abrir pela própria tela, concluir com resolução. |
| **Relatórios** | Indicadores agregados no PostgreSQL, períodos rápidos e exportação CSV. |
| **Usuários** | Contas pendentes em destaque, aprovação, cargos, remoção de acesso e banimento (Edge Function). |
| **Auditoria** | Eventos paginados no servidor, filtros por tipo e ação, destaque para exclusões e bloqueios. |
| **Configurações** | Fichas de modelo, campos personalizados dos equipamentos e lista de locais da escola. |

Perfis: **Aluno**, **Professor** e **Administrador**. Gestão (manutenção, relatórios,
usuários, auditoria, configurações, cadastro e exclusões) é só da administração —
e o banco confirma isso em cada operação.

## Estrutura

```text
index.html                 Página única; carrega os scripts na ordem abaixo
assets/css/equipa.css      Sistema visual (tokens de cor, componentes, temas claro/escuro, celular)
assets/js/
  config.js                URL e chave pública do Supabase, versão
  boot-guard.js            Mostra erro se o app não iniciar
  supabase.js              Cliente Supabase mínimo (Auth, REST, RPC, Edge Functions), sem dependências
  core/ui.js               Utilitários, ícones, janelas, avisos, confirmação, arrasto, menu do botão direito
  core/legal.js            Termos de Uso e Política de Privacidade
  core/core.js             Tema, estado, mensagens de erro, QR
  core/data.js             Dados compartilhados com cache curto (equipamentos, retiradas, modelos)
  core/auth.js             Login, cadastro, senha, aceite legal, conta pendente
  core/shell.js            Menu lateral, barra inferior, navegação, avisos
  views/*.js               Uma tela por arquivo (home, devices, control, counter, returns,
                           carts, export, maintenance, reports, users, audit, settings)
  tools/register.js        Cadastro (vários, um, planilha, herança, substituir)
  tools/labels.js          Gerador de etiquetas QR
  tools/camera.js          Câmera (QR, código de barras, leitura de texto)
  app.js                   Inicialização (último script)
supabase/
  migrations/              Histórico de migrations
  functions/equipa-admin-users  Edge Function de administração de contas
  *.sql                    Consultas de diagnóstico e capacidade (somente leitura) e instalação de cron
docs/historico/            Notas de versões antigas, guardadas só como histórico
tests/                     Testes automáticos (node tests/run.mjs)
```

Os scripts são clássicos (sem `import`), compartilham o escopo global e dependem
da ordem do `index.html`: base → núcleo → ferramentas → telas → `app.js`.
O teste `tests/110-structure.mjs` garante que nenhuma função é definida em dois
módulos e que toda tela do menu tem função de desenho.

## Tecnologias

HTML, CSS e JavaScript puros; Supabase (Auth, PostgreSQL com RLS, RPCs, Edge
Function); GitHub Pages. Bibliotecas carregadas sob demanda do jsDelivr com versão
fixa: `qrcodejs`, `jsqr`, `jspdf`, `jszip`, `xlsx`, `tesseract.js` (leitura de texto
pela câmera, roda no navegador; nenhuma imagem vai para o servidor).

## Supabase

- Projeto `oxcfbsrukzfnzkivatsn`. O navegador usa **apenas a chave pública**;
  nenhum segredo fica no site (`tests/static-audit.mjs` verifica).
- Regras de negócio e permissões ficam no banco: RLS em todas as tabelas expostas,
  RPCs `security definer` que conferem o cargo (`EQUIPA_ADMIN_REQUIRED`) e auditoria
  por gatilho. O JavaScript só valida para ajudar.
- No banco em produção, `equipments` e `equipment_models` são **visões** sobre um
  catálogo normalizado (`equipment_units`, `equipment_variants`,
  `equipment_model_catalog`, `equipment_manufacturers`, `equipment_categories`,
  `equipment_locations`). Gravar em `equipments` passa pelo gatilho
  `private.equipments_compat_write`. Parte dessa estrutura foi criada direto no
  banco e não está nas migrations do repositório — veja `supabase/README.md`.
- Edge Function `equipa-admin-users`: configure `EQUIPA_ALLOWED_ORIGINS` com o
  endereço do site publicado.
- Links de e-mail (confirmação e troca de senha): veja `supabase/AUTH-REDIRECT.md`.
- Keepalive: `.github/workflows/equipa-supabase-keepalive.yml` toca o banco a cada
  5 dias para o projeto gratuito não pausar.

## Migrations

Novas migrations devem ser **aditivas** e aplicadas manualmente (SQL Editor ou
`supabase db push`) depois de revisadas — o GitHub Pages não executa nada no banco.
Já aplicadas em produção: `20261116010000_equipa_1_0_carts_models_settings.sql`
(carrinhos, campos personalizados, fichas de modelo, ajustes) e
`20261116020000_equipa_1_3_reports_group_by_fix.sql` (relatórios) e
`20261116030000_equipa_1_4_purge_equipment.sql` (“Excluir” apaga de vez equipamentos
sem histórico de uso; os com histórico só saem do catálogo).
Detalhes e consultas de verificação em `supabase/README.md`.

## Testes

```bash
node tests/run.mjs
```

Verificam: segredos fora do navegador, uso das RPCs paginadas/agregadas, contrato de
retirada com custódia, CSP, ordem dos scripts, estrutura dos módulos, ícones, tema
escuro completo, keepalive. Os testes da interface antiga estão em `tests/legacy/`
(não são executados; ver o README de lá).

Antes de publicar, confira também no navegador: login, retirada e devolução,
cadastro em lote e individual, carrinhos, etiquetas, tema escuro e celular.

## Publicação

1. Rode `node tests/run.mjs`.
2. Se houver migration nova, aplique-a no Supabase antes de publicar o site.
3. Ao mudar arquivos JS/CSS, aumente a versão em `config.js` e nos `?v=` do
   `index.html` (força os navegadores a baixar a versão nova).
4. Faça commit e push para o branch publicado no GitHub Pages.
5. Abra o site, faça login e confira as telas principais.

## Licença

Veja `license`.
