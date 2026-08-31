-- ==========================================================================
-- PANOBIANCO PDV & ERP — SCHEMA SQL v2.0.0
-- Banco: SQLite (via better-sqlite3)
-- Projetado para multi-tenancy futuro (tenant_id em todas as tabelas)
-- ==========================================================================

-- Configuração de Tenants (futuro SaaS)
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY DEFAULT 'default',
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Colaboradores / Operadores
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'OPERADOR')),
    title TEXT,
    avatar TEXT DEFAULT '👤',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tenant_id, code)
);

-- Catálogo de Produtos
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    cost REAL NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    min_stock INTEGER NOT NULL DEFAULT 5,
    icon TEXT DEFAULT '📦',
    image_path TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Vendas (cabeçalho)
CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    seq INTEGER NOT NULL,
    operator_id TEXT NOT NULL,
    operator_name TEXT NOT NULL,
    operator_code TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    total REAL NOT NULL,
    cost REAL NOT NULL DEFAULT 0,
    profit REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'CONCLUIDA',
    cancel_reason TEXT,
    cancelled_by TEXT,
    shift_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (operator_id) REFERENCES users(id)
);

-- Itens de Venda (normalizado)
CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    unit_cost REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (sale_id) REFERENCES sales(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Turnos / Fechamento de Caixa
CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    shift_code TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    operator_name TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    total_sales INTEGER DEFAULT 0,
    total_revenue REAL DEFAULT 0,
    system_cash REAL DEFAULT 0,
    counted_cash REAL,
    diff REAL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (operator_id) REFERENCES users(id)
);

-- Log de Auditoria
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    operator_id TEXT NOT NULL,
    operator_name TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Contadores (sale_counter, shift_counter, etc.)
CREATE TABLE IF NOT EXISTS counters (
    tenant_id TEXT NOT NULL DEFAULT 'default',
    key TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, key)
);

-- Sessões de Autenticação
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    user_id TEXT NOT NULL,
    user_code TEXT NOT NULL,
    user_name TEXT NOT NULL,
    user_role TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_users_tenant_code ON users(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_products_tenant_category ON products(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_products_tenant_active ON products(tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_sales_tenant_created ON sales(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_tenant_status ON sales(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_operator ON sales(operator_id);
CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales(shift_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_shifts_tenant_status ON shifts(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_log(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Tenant padrão (primeiro cliente / piloto)
INSERT OR IGNORE INTO tenants (id, name) VALUES ('default', 'Unidade Piloto');
