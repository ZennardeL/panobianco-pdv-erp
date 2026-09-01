-- ==========================================================================
-- PANOBIANCO PDV & ERP — SCHEMA POSTGRESQL PARA SUPABASE (v3.0.0)
-- Banco: PostgreSQL (Supabase) com Realtime & Transações ACID Atômicas
-- Multi-tenancy nativo com tenant_id
-- ==========================================================================

-- 1. EXTENSÕES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABELA DE TENANTS (Multi-unidades / SaaS)
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY DEFAULT 'default',
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Inserir tenant padrão
INSERT INTO tenants (id, name) 
VALUES ('default', 'Panobianco Unidade Piloto')
ON CONFLICT (id) DO NOTHING;

-- 3. TABELA DE COLABORADORES / USUÁRIOS
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'OPERADOR')),
    title TEXT,
    avatar TEXT DEFAULT '👤',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unq_users_tenant_code UNIQUE (tenant_id, code)
);

-- 4. TABELA DE CATÁLOGO DE PRODUTOS
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    cost NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    stock INTEGER NOT NULL DEFAULT 0,
    min_stock INTEGER NOT NULL DEFAULT 5,
    icon TEXT DEFAULT '📦',
    image_path TEXT DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. TABELA DE TURNOS / FECHAMENTO DE CAIXA
CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE,
    shift_code TEXT NOT NULL,
    operator_id TEXT NOT NULL REFERENCES users(id),
    operator_name TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    total_sales INTEGER DEFAULT 0,
    total_revenue NUMERIC(10,2) DEFAULT 0.00,
    system_cash NUMERIC(10,2) DEFAULT 0.00,
    counted_cash NUMERIC(10,2),
    diff NUMERIC(10,2),
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. TABELA DE VENDAS
CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    operator_id TEXT NOT NULL REFERENCES users(id),
    operator_name TEXT NOT NULL,
    operator_code TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    total NUMERIC(10,2) NOT NULL,
    cost NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    profit NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    status TEXT NOT NULL DEFAULT 'CONCLUIDA' CHECK (status IN ('CONCLUIDA', 'CANCELADA')),
    cancel_reason TEXT,
    cancelled_by TEXT,
    shift_id TEXT REFERENCES shifts(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. TABELA DE ITENS DA VENDA
CREATE TABLE IF NOT EXISTS sale_items (
    id BIGSERIAL PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    unit_price NUMERIC(10,2) NOT NULL,
    unit_cost NUMERIC(10,2) NOT NULL DEFAULT 0.00
);

-- 8. TABELA DE AUDITORIA (Imutável)
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    operator_id TEXT NOT NULL,
    operator_name TEXT NOT NULL,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. TABELA DE CONTADORES ATÔMICOS (Sequencial V01, V02...)
CREATE TABLE IF NOT EXISTS counters (
    tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, key)
);

-- Inicializar contador de vendas e turnos
INSERT INTO counters (tenant_id, key, value) 
VALUES ('default', 'sale_counter', 0), ('default', 'shift_counter', 0)
ON CONFLICT (tenant_id, key) DO NOTHING;

-- 10. ÍNDICES DE PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_users_tenant_code ON users(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_products_tenant_category ON products(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_products_tenant_active ON products(tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_sales_tenant_created ON sales(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_tenant_status ON sales(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales(shift_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_shifts_tenant_status ON shifts(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_log(tenant_id, created_at DESC);

-- ==========================================================================
-- FUNÇÕES RPC ATÔMICAS (Prevenção Total de Concorrência & Furo de Estoque)
-- ==========================================================================

-- FUNÇÃO 1: PROCESSAR VENDA ATOMICAMENTE
CREATE OR REPLACE FUNCTION process_sale(
    p_tenant_id TEXT,
    p_operator_id TEXT,
    p_operator_name TEXT,
    p_operator_code TEXT,
    p_payment_method TEXT,
    p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_seq INTEGER;
    v_sale_id TEXT;
    v_total NUMERIC(10,2) := 0.00;
    v_total_cost NUMERIC(10,2) := 0.00;
    v_item JSONB;
    v_prod_id TEXT;
    v_qty INTEGER;
    v_price NUMERIC(10,2);
    v_cost NUMERIC(10,2);
    v_prod_name TEXT;
    v_current_stock INTEGER;
    v_active_shift_id TEXT;
    v_item_count INTEGER := 0;
BEGIN
    -- 1. Lock exclusivo no contador do tenant para garantir sequência estrita sem colisões
    SELECT value + 1 INTO v_seq
    FROM counters
    WHERE tenant_id = p_tenant_id AND key = 'sale_counter'
    FOR UPDATE;

    IF v_seq IS NULL THEN
        INSERT INTO counters (tenant_id, key, value) VALUES (p_tenant_id, 'sale_counter', 1);
        v_seq := 1;
    ELSE
        UPDATE counters SET value = v_seq WHERE tenant_id = p_tenant_id AND key = 'sale_counter';
    END IF;

    -- Formatar código de venda (ex: V01, V02, V10, V100...)
    v_sale_id := 'V' || LPAD(v_seq::TEXT, 2, '0');

    -- 2. Buscar turno aberto atual
    SELECT id INTO v_active_shift_id
    FROM shifts
    WHERE tenant_id = p_tenant_id AND status = 'OPEN'
    ORDER BY created_at DESC
    LIMIT 1;

    -- 3. Validar e decrementar estoque de cada item com lock atômico de linha
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_prod_id := v_item->>'productId';
        v_qty := (v_item->>'qty')::INTEGER;

        -- Bloquear o registro do produto para evitar race conditions
        SELECT stock, price, cost, name INTO v_current_stock, v_price, v_cost, v_prod_name
        FROM products
        WHERE id = v_prod_id AND tenant_id = p_tenant_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Produto não encontrado: %', v_prod_id;
        END IF;

        IF v_current_stock < v_qty THEN
            RAISE EXCEPTION 'Estoque insuficiente para o produto % (Disponível: %, Solicitado: %)', v_prod_name, v_current_stock, v_qty;
        END IF;

        -- Decrementar estoque
        UPDATE products 
        SET stock = stock - v_qty, updated_at = NOW()
        WHERE id = v_prod_id AND tenant_id = p_tenant_id;

        -- Acumular totais
        v_total := v_total + (v_price * v_qty);
        v_total_cost := v_total_cost + (v_cost * v_qty);
        v_item_count := v_item_count + v_qty;
    END LOOP;

    -- 4. Inserir cabeçalho da venda
    INSERT INTO sales (
        id, tenant_id, seq, operator_id, operator_name, operator_code,
        payment_method, total, cost, profit, status, shift_id, created_at
    ) VALUES (
        v_sale_id, p_tenant_id, v_seq, p_operator_id, p_operator_name, p_operator_code,
        p_payment_method, v_total, v_total_cost, (v_total - v_total_cost), 'CONCLUIDA', v_active_shift_id, NOW()
    );

    -- 5. Inserir itens da venda
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_prod_id := v_item->>'productId';
        v_qty := (v_item->>'qty')::INTEGER;

        SELECT price, cost, name INTO v_price, v_cost, v_prod_name
        FROM products
        WHERE id = v_prod_id AND tenant_id = p_tenant_id;

        INSERT INTO sale_items (
            sale_id, tenant_id, product_id, product_name, qty, unit_price, unit_cost
        ) VALUES (
            v_sale_id, p_tenant_id, v_prod_id, v_prod_name, v_qty, v_price, v_cost
        );
    END LOOP;

    -- 6. Gravar log de auditoria
    INSERT INTO audit_log (
        tenant_id, action, entity_type, entity_id, operator_id, operator_name, details
    ) VALUES (
        p_tenant_id, 'VENDA', 'sale', v_sale_id, p_operator_id, p_operator_name,
        'Total: R$ ' || TO_CHAR(v_total, 'FM999990.00') || ' | Pagto: ' || UPPER(p_payment_method) || ' | Itens: ' || v_item_count
    );

    -- Retornar os dados da venda gerada
    RETURN jsonb_build_object(
        'success', TRUE,
        'sale', jsonb_build_object(
            'id', v_sale_id,
            'seq', v_seq,
            'total', v_total,
            'cost', v_total_cost,
            'profit', (v_total - v_total_cost),
            'paymentMethod', p_payment_method,
            'operatorName', p_operator_name,
            'operatorCode', p_operator_code,
            'status', 'CONCLUIDA',
            'createdAt', NOW()
        )
    );
END;
$$;


-- FUNÇÃO 2: CANCELAR VENDA ATOMICAMENTE (Devolução ao Estoque + Auditoria)
CREATE OR REPLACE FUNCTION cancel_sale(
    p_tenant_id TEXT,
    p_sale_id TEXT,
    p_operator_id TEXT,
    p_operator_name TEXT,
    p_reason TEXT,
    p_is_admin BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sale RECORD;
    v_item RECORD;
BEGIN
    -- 1. Buscar a venda com lock
    SELECT * INTO v_sale
    FROM sales
    WHERE id = p_sale_id AND tenant_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Venda não encontrada.');
    END IF;

    IF v_sale.status = 'CANCELADA' THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Esta venda já está cancelada.');
    END IF;

    -- Validar permissão: se não for admin, só pode cancelar se for o próprio operador
    IF NOT p_is_admin AND v_sale.operator_id <> p_operator_id THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Você só pode cancelar suas próprias vendas.');
    END IF;

    -- 2. Devolver estoque de todos os itens
    FOR v_item IN SELECT product_id, qty FROM sale_items WHERE sale_id = p_sale_id AND tenant_id = p_tenant_id
    LOOP
        UPDATE products
        SET stock = stock + v_item.qty, updated_at = NOW()
        WHERE id = v_item.product_id AND tenant_id = p_tenant_id;
    END LOOP;

    -- 3. Atualizar status da venda
    UPDATE sales
    SET status = 'CANCELADA',
        cancel_reason = p_reason,
        cancelled_by = p_operator_name
    WHERE id = p_sale_id AND tenant_id = p_tenant_id;

    -- 4. Registrar no log de auditoria
    INSERT INTO audit_log (
        tenant_id, action, entity_type, entity_id, operator_id, operator_name, details
    ) VALUES (
        p_tenant_id, 'CANCELAMENTO', 'sale', p_sale_id, p_operator_id, p_operator_name,
        'Cancelado por ' || p_operator_name || ': ' || p_reason
    );

    RETURN jsonb_build_object('success', TRUE, 'saleId', p_sale_id);
END;
$$;


-- ==========================================================================
-- HABILITAR REALTIME NO SUPABASE
-- ==========================================================================
-- Habilita broadcasting via WebSocket para mudanças instantâneas nas telas
ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE sales;
ALTER PUBLICATION supabase_realtime ADD TABLE shifts;
ALTER PUBLICATION supabase_realtime ADD TABLE audit_log;
ALTER PUBLICATION supabase_realtime ADD TABLE users;

-- ==========================================================================
-- CONFIGURAÇÃO DO BUCKET DE FOTOS (Supabase Storage)
-- ==========================================================================
-- Criar bucket público para fotos de produtos
INSERT INTO storage.buckets (id, name, public) 
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- Políticas de acesso público para o bucket de fotos
CREATE POLICY "Public Read Access" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'product-images');

CREATE POLICY "Authenticated/Anon Upload Access" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "Authenticated/Anon Update Access" 
ON storage.objects FOR UPDATE 
USING (bucket_id = 'product-images');
