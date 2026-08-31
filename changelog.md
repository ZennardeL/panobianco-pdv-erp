# Changelog — Panobianco PDV & ERP

Todas as alterações relevantes do projeto serão documentadas aqui.

---

## [2.3.0] — 2026-08-28

### Dashboard Financeiro Avançado

**Motivação:** O dashboard exibia apenas 4 métricas básicas com lucro estimado a 45% fixo. Para a visão de EBITDA e operação do Luan, precisava de CMV real, ticket médio, taxa de cancelamento e performance por operador.

### Adicionado
- **KPI: CMV (Custo de Mercadoria Vendida)** — calculado a partir do custo real de cada item vendido
- **KPI: Ticket Médio** — faturamento / número de vendas
- **KPI: Total de Vendas** — contagem de vendas ativas
- **KPI: Taxa de Cancelamento** — canceladas / total (com destaque visual)
- **Card: Ranking de Operadores** — classificação por faturamento com ticket médio individual e contagem de vendas
- **Card: Top 5 Produtos por Lucro** — classificação por lucro bruto real (receita - CMV) com margem percentual
- **Distribuição por pagamento** agora exibe percentual entre parênteses

### Alterado
- **Lucro** agora é calculado com custo real (`receita - CMV`) em vez de estimativa fixa de 45%
- Layout expandido: 8 KPIs em 2 linhas + 4 cards de análise

---

## [2.2.0] — 2026-08-28

### UI de Auditoria Completa

**Motivação:** O `audit_log` criado na Etapa 1 estava acumulando dados (logins, vendas, cancelamentos, reposições) mas não tinha interface para visualização. O admin precisava acessar via SQL para ver os logs.

### Adicionado
- **Endpoint `GET /api/audit`** — retorna logs de auditoria com filtros por ação, operador, data e busca textual (🔒 ADMIN only)
- **Sub-abas na seção de Auditoria**: "🧾 Vendas" (existente) e "📋 Todos os Eventos" (novo)
- **Tabela de eventos** com colunas: Data, Ação, Tipo, ID, Operador, Detalhes
- **Badges coloridos** por tipo de ação (Login=verde, Venda=azul, Cancelamento=vermelho, etc.)
- **Filtros avançados**: dropdown de tipo de ação (populado dinamicamente), intervalo de datas, busca textual
- **Funções no `db.js`**: `getAuditLogs()` (com filtros SQL dinâmicos) e `getAuditActionTypes()`

---

## [2.1.0] — 2026-08-20

### Segurança: Autenticação por Token de Sessão

**Motivação:** Todos os endpoints da API estavam abertos. Qualquer pessoa na rede local podia cancelar vendas, alterar estoque ou criar usuários diretamente via requisição HTTP, sem estar logada. A segregação de perfis (ADMIN/OPERADOR) existia apenas no JavaScript do navegador.

### Adicionado
- **Tabela `sessions`** no SQLite — tokens de sessão com expiração de 12h
- **Middleware `requireAuth`** — valida token em todos os endpoints protegidos → 401 se inválido
- **Middleware `requireAdmin`** — exige perfil ADMIN para cancelar vendas, criar/editar produtos e gerenciar equipe → 403 se OPERADOR
- **Endpoint `POST /api/auth/logout`** — invalida o token no servidor
- **Limpeza automática** de sessões expiradas a cada 1 hora
- **`authFetch()`** no frontend — helper que envia o token e trata 401/403 automaticamente
- **Recuperação de sessão** — ao recarregar a página, o sistema tenta recuperar a sessão do `sessionStorage`

### Alterado
- **`sessionStorage`** substitui memória para armazenar token e dados do usuário (limpo ao fechar navegador)
- **Audit logs** agora usam o operador **real da sessão autenticada**, não o enviado pelo frontend no body
- **Header CORS** atualizado para permitir `Authorization`
- **Logout** agora invalida o token no servidor (antes apenas limpava `currentUser` no frontend)

### Segurança
- `POST /api/sale/cancel` → 🔒 ADMIN only
- `POST /api/product` → 🔒 ADMIN only
- `POST /api/users` → 🔒 ADMIN only
- `POST /api/auth/login` → Aberto (público)
- `POST /api/auth/logout` → Aberto (público)
- Todos os demais endpoints → Token obrigatório

---

## [2.0.0] — 2026-08-20

### Migração: JSON flat-file → SQLite

**Motivação:** O `database.json` original sofria de escrita concorrente (corrupção de dados quando duas máquinas operavam simultaneamente), payload inflado pelo polling (fotos base64 transferidas a cada 2.5s) e ausência de transações atômicas. Com a projeção de 300-500 produtos, a arquitetura não era sustentável.

### Adicionado
- **SQLite como banco de dados** via `better-sqlite3` (WAL mode, transações atômicas)
- **Módulo `db.js`** — camada de acesso a dados com queries preparadas
- **Schema SQL normalizado** (`schema.sql`) com:
  - Tabelas: `tenants`, `users`, `products`, `sales`, `sale_items`, `shifts`, `audit_log`, `counters`
  - Campo `tenant_id` em todas as tabelas (valor fixo `'default'` — preparação para SaaS)
  - Índices de performance para todas as consultas frequentes
  - Foreign keys e constraints de integridade
- **Tabela `sale_items`** — itens de venda normalizados (antes embutidos como array dentro da venda)
- **Tabela `audit_log`** — log de toda ação relevante (login, venda, cancelamento, reposição, edição de produto, cadastro de usuário)
- **Endpoint `POST /api/users`** — CRUD de colaboradores agora funciona no servidor (antes existia apenas no frontend local)
- **Backup automático** — cópia do banco a cada 30 minutos + ao fechar turno. Retenção: últimos 48 backups
- **Graceful shutdown** — ao encerrar o processo, cria backup e fecha o banco corretamente
- **Script de migração** (`migrate-from-json.js`) — one-shot, idempotente, valida contagem de registros
- **Cache de imagens** — header `Cache-Control` de 1 hora para fotos de produtos
- **Proteção contra directory traversal** no servidor de arquivos estáticos
- **`package.json`** e `.gitignore`

### Alterado
- **`server.js`** — reescrito para usar SQLite. Todos os endpoints agora usam queries SQL com transações atômicas
- **Fotos de produtos** — armazenadas como arquivos JPEG em `uploads/products/` (antes: base64 inline no JSON). Frontend referencia por URL relativa
- **Validação de entrada** — endpoints agora retornam erros 400 específicos para payloads inválidos

### Removido
- Leitura/escrita síncrona do `database.json` completo a cada operação
- Campo `pin` dos usuários (removido na migração)

### Corrigido
- **[C1] Escrita concorrente** — SQLite com WAL mode + transações eliminam race conditions entre múltiplas máquinas
- **[C2] Payload inflado** — fotos não são mais incluídas no polling. Servidas como arquivos estáticos
- **[M1] Endpoint `/api/users` ausente** — implementado no servidor
- **[M4] Encoding de "Letícia"** — corrigido na migração

---

## [1.0.0] — 2026-08-18

### Release inicial

- PDV com código sequencial de venda (V01, V02...)
- Estoque com alertas de nível crítico
- Fechamento de caixa cego com conferência de divergência
- Conferência de vias EVO (filipetas para grampo)
- Upload de fotos de produtos (compressão client-side)
- Login individual por código de funcionário
- Segregação de perfis (ADMIN / OPERADOR)
- Gestão de equipe (CRUD de colaboradores)
- Dashboard com faturamento, lucro, margem e top 5 produtos
- Auditoria com filtro e exportação CSV
- Cancelamento auditado com justificativa obrigatória
- Backup manual (download JSON)
- Sincronização multi-máquinas via polling (2.5s)
- Script `iniciar_servidor_24h.bat` para o PC da recepção
