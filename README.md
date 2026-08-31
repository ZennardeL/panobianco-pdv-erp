# 🏋️ Panobianco PDV & Mini-ERP

Sistema de Ponto de Venda (PDV) e Mini-ERP para academias, com foco em controle de vendas, estoque, caixa, auditoria e performance operacional.

> **v2.5.0** — Desenvolvido para a operação real de uma unidade franqueada Panobianco Academias.

---

## ✨ Funcionalidades

### 🧾 PDV (Frente de Caixa)
- Catálogo visual com fotos dos produtos
- Carrinho intuitivo com soma automática
- Código sequencial de venda (V01, V02...) para conferência com maquininha
- Cancelamento imediato pelo operador (erro operacional)
- Suporte a Pix, Cartão Débito/Crédito e Dinheiro

### 📦 Estoque
- Cadastro de produtos com foto, custo, preço de venda e estoque mínimo
- Entrada de mercadoria (reposição)
- Alertas automáticos de estoque crítico e esgotado
- Upload de fotos por qualquer colaborador

### 💰 Caixa & Turno
- Abertura e fechamento de turno
- Conferência de gaveta
- Relatório de vendas por turno

### 🛡️ Auditoria & Segurança
- Log imutável de todas as ações (login, vendas, cancelamentos, reposições, edições)
- Autenticação por token de sessão (12h)
- Controle de acesso por perfil (ADMIN / OPERADOR)
- Filtros por tipo de ação, operador, data e busca textual

### 📊 Dashboard Executivo
- **KPIs Financeiros**: Faturamento, CMV, Lucro Bruto, Margem
- **KPIs Operacionais**: Ticket Médio, Total de Vendas, Cancelamentos
- Ranking de operadores por performance
- Top 5 produtos por volume e por lucro
- Distribuição por meio de pagamento (com %)

---

## 🚀 Quick Start

### Pré-requisitos
- [Node.js](https://nodejs.org/) v18+

### Instalação
```bash
git clone https://github.com/SEU_USUARIO/panobianco-pdv-erp.git
cd panobianco-pdv-erp
npm install
```

### Executar
```bash
node server.js
```

Acesse: **http://localhost:3000**

### Acesso em rede local
Qualquer dispositivo na mesma rede Wi-Fi pode acessar via:
```
http://IP_DO_SERVIDOR:3000
```

---

## 🔐 Login

O acesso é por código de funcionário (ex: `f20729`). Não há senha — o código é único por pessoa.

| Perfil | Acesso |
| :---: | :--- |
| **ADMIN** | Tudo: PDV, Estoque, Caixa, Auditoria, Equipe, Dashboard |
| **OPERADOR** | PDV, Estoque (entrada + foto), Caixa |

---

## 🏗️ Arquitetura

```
Frontend (SPA)  →  Node.js HTTP Server  →  SQLite (better-sqlite3)
                      ↕
                 Filesystem (fotos)
```

- **Backend**: Node.js puro (sem Express), HTTP server nativo
- **Banco**: SQLite com WAL mode para concorrência
- **Frontend**: Single Page Application (HTML/CSS/JS vanilla)
- **Multi-tenant**: Todas as tabelas possuem `tenant_id` (preparado para SaaS)

---

## 📋 Versionamento

| Versão | Data | Descrição |
| :---: | :---: | :--- |
| v2.5.0 | 2026-08-31 | Cancelamento imediato pelo operador |
| v2.4.0 | 2026-08-31 | Git + Alertas de estoque baixo |
| v2.3.0 | 2026-08-28 | Dashboard financeiro avançado |
| v2.2.0 | 2026-08-28 | UI de auditoria completa |
| v2.1.0 | 2026-08-20 | Segurança (token + RBAC) |
| v2.0.0 | 2026-08-18 | Migração para SQLite |
| v1.0.0 | 2026-08-17 | MVP com JSON flat-file |

---

## 📄 Licença

Projeto proprietário. Todos os direitos reservados.
