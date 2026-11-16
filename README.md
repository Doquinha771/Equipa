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


## Licença

Veja `license`.
