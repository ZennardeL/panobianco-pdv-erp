/**
 * ==========================================================================
 * PANOBIANCO PDV & ERP — MÓDULO DE ACESSO AO BANCO (SQLite)
 * ==========================================================================
 * 
 * Responsabilidades:
 * - Abrir/criar o banco SQLite
 * - Executar migrations (schema.sql)
 * - Expor funções de acesso a dados (queries preparadas)
 * - Gerenciar backup automático
 * 
 * Decisão arquitetural:
 *   better-sqlite3 é síncrono por design. Isso é intencional:
 *   - Evita race conditions em transações
 *   - Simplifica o código do servidor
 *   - Performance é excelente para o volume esperado (< 500 produtos, < 10.000 vendas/mês)
 *   - Quando migrar para PostgreSQL (SaaS cloud), este módulo será substituído por um equivalente async
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'panobianco.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const BACKUP_DIR = path.join(__dirname, 'backups');
const UPLOADS_DIR = path.join(__dirname, 'uploads', 'products');

// Garantir que os diretórios existam
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

let db;

/**
 * Inicializa o banco de dados e executa o schema.
 */
function initDatabase() {
    db = new Database(DB_PATH, { /* verbose: console.log */ });

    // WAL mode: permite leitores e escritores simultâneos
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    // Executar schema (CREATE IF NOT EXISTS — idempotente)
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    db.exec(schema);

    console.log(`📦 Banco SQLite aberto: ${DB_PATH}`);
    console.log(`📁 Uploads: ${UPLOADS_DIR}`);
    console.log(`💾 Backups: ${BACKUP_DIR}`);

    return db;
}

/**
 * Retorna a instância do banco.
 */
function getDb() {
    if (!db) throw new Error('Banco não inicializado. Chame initDatabase() primeiro.');
    return db;
}

// ==========================================================================
// QUERIES — USERS
// ==========================================================================

function findUserByCode(code, tenantId = 'default') {
    return getDb().prepare(
        'SELECT * FROM users WHERE code = ? AND tenant_id = ? AND active = 1'
    ).get(code.toLowerCase(), tenantId);
}

function getAllUsers(tenantId = 'default') {
    return getDb().prepare(
        'SELECT * FROM users WHERE tenant_id = ? AND active = 1 ORDER BY name'
    ).all(tenantId);
}

function upsertUser(user, tenantId = 'default') {
    const stmt = getDb().prepare(`
        INSERT INTO users (id, tenant_id, code, name, role, title, avatar)
        VALUES (@id, @tenantId, @code, @name, @role, @title, @avatar)
        ON CONFLICT(id) DO UPDATE SET
            code = @code, name = @name, role = @role, title = @title, avatar = @avatar
    `);
    return stmt.run({ ...user, tenantId, id: user.id || user.code });
}

// ==========================================================================
// QUERIES — PRODUCTS
// ==========================================================================

function getAllProducts(tenantId = 'default') {
    return getDb().prepare(
        'SELECT * FROM products WHERE tenant_id = ? AND active = 1 ORDER BY category, name'
    ).all(tenantId);
}

function getProductById(productId, tenantId = 'default') {
    return getDb().prepare(
        'SELECT * FROM products WHERE id = ? AND tenant_id = ?'
    ).get(productId, tenantId);
}

function upsertProduct(product, tenantId = 'default') {
    const stmt = getDb().prepare(`
        INSERT INTO products (id, tenant_id, name, category, cost, price, stock, min_stock, icon, image_path)
        VALUES (@id, @tenantId, @name, @category, @cost, @price, @stock, @minStock, @icon, @imagePath)
        ON CONFLICT(id) DO UPDATE SET
            name = @name, category = @category, cost = @cost, price = @price,
            stock = @stock, min_stock = @minStock, icon = @icon, image_path = @imagePath,
            updated_at = datetime('now')
    `);
    return stmt.run({
        id: product.id || ('prod_' + Date.now()),
        tenantId,
        name: product.name,
        category: product.category,
        cost: product.cost || 0,
        price: product.price || 0,
        stock: product.stock || 0,
        minStock: product.min_stock || product.minStock || 5,
        icon: product.icon || '📦',
        imagePath: product.image_path || product.imagePath || ''
    });
}

function updateProductPhoto(productId, imagePath, tenantId = 'default') {
    return getDb().prepare(
        'UPDATE products SET image_path = ?, updated_at = datetime(\'now\') WHERE id = ? AND tenant_id = ?'
    ).run(imagePath, productId, tenantId);
}

function updateProductStock(productId, delta, tenantId = 'default') {
    return getDb().prepare(
        'UPDATE products SET stock = MAX(0, stock + ?), updated_at = datetime(\'now\') WHERE id = ? AND tenant_id = ?'
    ).run(delta, productId, tenantId);
}

// ==========================================================================
// QUERIES — SALES
// ==========================================================================

function getNextSaleSeq(tenantId = 'default') {
    const row = getDb().prepare(
        'SELECT value FROM counters WHERE tenant_id = ? AND key = ?'
    ).get(tenantId, 'sale_counter');
    return (row ? row.value : 0) + 1;
}

function createSale(saleData, tenantId = 'default') {
    const txn = getDb().transaction(() => {
        // Incrementar contador
        getDb().prepare(`
            INSERT INTO counters (tenant_id, key, value) VALUES (?, 'sale_counter', 1)
            ON CONFLICT(tenant_id, key) DO UPDATE SET value = value + 1
        `).run(tenantId);

        const counterRow = getDb().prepare(
            'SELECT value FROM counters WHERE tenant_id = ? AND key = ?'
        ).get(tenantId, 'sale_counter');
        const seq = counterRow.value;
        const saleCode = `V${seq < 10 ? '0' + seq : seq}`;

        // Buscar shift ativo
        const activeShift = getDb().prepare(
            'SELECT id FROM shifts WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1'
        ).get(tenantId, 'OPEN');

        // Inserir venda
        getDb().prepare(`
            INSERT INTO sales (id, tenant_id, seq, operator_id, operator_name, operator_code,
                               payment_method, total, cost, profit, status, shift_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONCLUIDA', ?)
        `).run(
            saleCode, tenantId, seq,
            saleData.operatorId, saleData.operatorName, saleData.operatorCode,
            saleData.paymentMethod,
            saleData.total, saleData.cost || 0, saleData.profit || 0,
            activeShift ? activeShift.id : null
        );

        // Inserir itens e decrementar estoque
        const insertItem = getDb().prepare(`
            INSERT INTO sale_items (sale_id, tenant_id, product_id, product_name, qty, unit_price, unit_cost)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const decrementStock = getDb().prepare(
            'UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ? AND tenant_id = ?'
        );

        for (const item of saleData.items) {
            insertItem.run(saleCode, tenantId, item.productId, item.name, item.qty, item.price, item.cost || 0);
            decrementStock.run(item.qty, item.productId, tenantId);
        }

        // Retornar a venda criada
        const sale = getDb().prepare('SELECT * FROM sales WHERE id = ? AND tenant_id = ?').get(saleCode, tenantId);
        const items = getDb().prepare('SELECT * FROM sale_items WHERE sale_id = ? AND tenant_id = ?').all(saleCode, tenantId);

        return { ...sale, items };
    });

    return txn();
}

function getSaleById(saleId, tenantId = 'default') {
    return getDb().prepare(
        'SELECT * FROM sales WHERE id = ? AND tenant_id = ?'
    ).get(saleId, tenantId) || null;
}

function cancelSale(saleId, reason, cancelledBy, tenantId = 'default') {
    const txn = getDb().transaction(() => {
        const sale = getDb().prepare(
            'SELECT * FROM sales WHERE id = ? AND tenant_id = ? AND status != ?'
        ).get(saleId, tenantId, 'CANCELADA');

        if (!sale) return null;

        // Marcar como cancelada
        getDb().prepare(
            'UPDATE sales SET status = ?, cancel_reason = ?, cancelled_by = ? WHERE id = ? AND tenant_id = ?'
        ).run('CANCELADA', reason, cancelledBy, saleId, tenantId);

        // Devolver estoque
        const items = getDb().prepare(
            'SELECT * FROM sale_items WHERE sale_id = ? AND tenant_id = ?'
        ).all(saleId, tenantId);

        const restoreStock = getDb().prepare(
            'UPDATE products SET stock = stock + ? WHERE id = ? AND tenant_id = ?'
        );

        for (const item of items) {
            restoreStock.run(item.qty, item.product_id, tenantId);
        }

        return { ...sale, status: 'CANCELADA', cancel_reason: reason, cancelled_by: cancelledBy, items };
    });

    return txn();
}

function getAllSales(tenantId = 'default') {
    const sales = getDb().prepare(
        'SELECT * FROM sales WHERE tenant_id = ? ORDER BY created_at DESC'
    ).all(tenantId);

    const getItems = getDb().prepare(
        'SELECT * FROM sale_items WHERE sale_id = ? AND tenant_id = ?'
    );

    return sales.map(sale => ({
        ...sale,
        items: getItems.all(sale.id, tenantId)
    }));
}

function getSalesByShift(shiftId, tenantId = 'default') {
    const sales = getDb().prepare(
        'SELECT * FROM sales WHERE shift_id = ? AND tenant_id = ? ORDER BY created_at ASC'
    ).all(shiftId, tenantId);

    const getItems = getDb().prepare(
        'SELECT * FROM sale_items WHERE sale_id = ? AND tenant_id = ?'
    );

    return sales.map(sale => ({
        ...sale,
        items: getItems.all(sale.id, tenantId)
    }));
}

// ==========================================================================
// QUERIES — SHIFTS
// ==========================================================================

function getActiveShift(tenantId = 'default') {
    return getDb().prepare(
        'SELECT * FROM shifts WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1'
    ).get(tenantId, 'OPEN');
}

function createShift(shiftData, tenantId = 'default') {
    getDb().prepare(`
        INSERT INTO shifts (id, tenant_id, shift_code, operator_id, operator_name, start_time, status)
        VALUES (?, ?, ?, ?, ?, datetime('now'), 'OPEN')
    `).run(shiftData.id, tenantId, shiftData.shiftCode, shiftData.operatorId, shiftData.operatorName);

    return getDb().prepare('SELECT * FROM shifts WHERE id = ?').get(shiftData.id);
}

function closeShift(countedCash, operatorId, operatorName, tenantId = 'default') {
    const txn = getDb().transaction(() => {
        const shift = getActiveShift(tenantId);
        if (!shift) return null;

        // Calcular totais do turno
        const stats = getDb().prepare(`
            SELECT
                COUNT(*) as total_sales,
                COALESCE(SUM(CASE WHEN status != 'CANCELADA' THEN total ELSE 0 END), 0) as total_revenue,
                COALESCE(SUM(CASE WHEN status != 'CANCELADA' AND payment_method = 'dinheiro' THEN total ELSE 0 END), 0) as system_cash
            FROM sales WHERE shift_id = ? AND tenant_id = ?
        `).get(shift.id, tenantId);

        const diff = countedCash - stats.system_cash;

        // Fechar turno atual
        getDb().prepare(`
            UPDATE shifts SET
                end_time = datetime('now'),
                total_sales = ?, total_revenue = ?,
                system_cash = ?, counted_cash = ?, diff = ?,
                status = 'CLOSED'
            WHERE id = ? AND tenant_id = ?
        `).run(stats.total_sales, stats.total_revenue, stats.system_cash, countedCash, diff, shift.id, tenantId);

        // Criar próximo turno
        const nextShiftNum = getDb().prepare(
            'SELECT COUNT(*) as cnt FROM shifts WHERE tenant_id = ?'
        ).get(tenantId).cnt + 1;

        const newShiftId = 'shift_' + Date.now();
        const newShiftCode = `T${nextShiftNum < 10 ? '0' + nextShiftNum : nextShiftNum}`;

        getDb().prepare(`
            INSERT INTO shifts (id, tenant_id, shift_code, operator_id, operator_name, start_time, status)
            VALUES (?, ?, ?, ?, ?, datetime('now'), 'OPEN')
        `).run(newShiftId, tenantId, newShiftCode, operatorId, operatorName);

        const closedShift = getDb().prepare('SELECT * FROM shifts WHERE id = ?').get(shift.id);

        return {
            closedShift: { ...closedShift, diff, system_cash: stats.system_cash, counted_cash: countedCash },
            totalSales: stats.total_sales,
            totalRevenue: stats.total_revenue
        };
    });

    return txn();
}

function getShiftHistory(tenantId = 'default', limit = 10) {
    return getDb().prepare(
        'SELECT * FROM shifts WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?'
    ).all(tenantId, 'CLOSED', limit);
}

// ==========================================================================
// QUERIES — SESSIONS (Autenticação por Token)
// ==========================================================================

const SESSION_DURATION_HOURS = 12;

function createSession(user, tenantId = 'default') {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();

    getDb().prepare(`
        INSERT INTO sessions (token, tenant_id, user_id, user_code, user_name, user_role, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(token, tenantId, user.id, user.code, user.name, user.role, expiresAt);

    return { token, expiresAt };
}

function validateSession(token) {
    if (!token) return null;

    const session = getDb().prepare(
        'SELECT * FROM sessions WHERE token = ? AND expires_at > datetime(\'now\')'
    ).get(token);

    return session || null;
}

function deleteSession(token) {
    if (!token) return;
    getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function deleteUserSessions(userId, tenantId = 'default') {
    getDb().prepare('DELETE FROM sessions WHERE user_id = ? AND tenant_id = ?').run(userId, tenantId);
}

function cleanExpiredSessions() {
    const result = getDb().prepare('DELETE FROM sessions WHERE expires_at <= datetime(\'now\')').run();
    if (result.changes > 0) {
        console.log(`🧹 ${result.changes} sessão(ões) expirada(s) removida(s).`);
    }
    return result.changes;
}

// ==========================================================================
// QUERIES — AUDIT LOG
// ==========================================================================

function logAudit(action, entityType, entityId, operatorId, operatorName, details, tenantId = 'default') {
    getDb().prepare(`
        INSERT INTO audit_log (tenant_id, action, entity_type, entity_id, operator_id, operator_name, details)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(tenantId, action, entityType, entityId, operatorId, operatorName, details || null);
}

function getAuditLogs(filters = {}, tenantId = 'default') {
    let sql = 'SELECT * FROM audit_log WHERE tenant_id = ?';
    const params = [tenantId];

    if (filters.action) {
        sql += ' AND action = ?';
        params.push(filters.action);
    }
    if (filters.operatorId) {
        sql += ' AND operator_id = ?';
        params.push(filters.operatorId);
    }
    if (filters.dateFrom) {
        sql += ' AND created_at >= ?';
        params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
        sql += ' AND created_at <= ?';
        params.push(filters.dateTo);
    }
    if (filters.search) {
        sql += ' AND (operator_name LIKE ? OR entity_id LIKE ? OR details LIKE ? OR action LIKE ?)';
        const term = `%${filters.search}%`;
        params.push(term, term, term, term);
    }

    sql += ' ORDER BY created_at DESC';

    const limit = filters.limit || 200;
    sql += ' LIMIT ?';
    params.push(limit);

    return getDb().prepare(sql).all(...params);
}

function getAuditActionTypes(tenantId = 'default') {
    return getDb().prepare(
        'SELECT DISTINCT action FROM audit_log WHERE tenant_id = ? ORDER BY action'
    ).all(tenantId).map(r => r.action);
}

// ==========================================================================
// QUERIES — COUNTERS
// ==========================================================================

function getCounter(key, tenantId = 'default') {
    const row = getDb().prepare(
        'SELECT value FROM counters WHERE tenant_id = ? AND key = ?'
    ).get(tenantId, key);
    return row ? row.value : 0;
}

// ==========================================================================
// ESTADO COMPLETO (para polling do frontend)
// ==========================================================================

function getFullState(tenantId = 'default') {
    const products = getAllProducts(tenantId);
    const users = getAllUsers(tenantId);
    const sales = getAllSales(tenantId);
    const activeShift = getActiveShift(tenantId);
    const shifts = getShiftHistory(tenantId, 10);
    const saleCounter = getCounter('sale_counter', tenantId);

    // Formatar vendas para compatibilidade com o frontend
    const formattedSales = sales.map(s => ({
        id: s.id,
        seq: s.seq,
        timestamp: s.created_at,
        dateFormatted: formatTime(s.created_at),
        fullDateTime: formatDateTime(s.created_at),
        operatorId: s.operator_id,
        operatorName: s.operator_name,
        operatorCode: s.operator_code,
        paymentMethod: s.payment_method,
        total: s.total,
        cost: s.cost,
        profit: s.profit,
        status: s.status,
        cancelReason: s.cancel_reason,
        items: (s.items || []).map(it => ({
            productId: it.product_id,
            name: it.product_name,
            qty: it.qty,
            price: it.unit_price,
            cost: it.unit_cost
        }))
    }));

    // Vendas do turno ativo
    let activeShiftFormatted = null;
    if (activeShift) {
        const shiftSales = getSalesByShift(activeShift.id, tenantId);
        activeShiftFormatted = {
            id: activeShift.id,
            shiftCode: activeShift.shift_code,
            operatorId: activeShift.operator_id,
            operatorName: activeShift.operator_name,
            startTime: activeShift.start_time,
            status: activeShift.status,
            sales: shiftSales.map(s => ({
                id: s.id,
                seq: s.seq,
                timestamp: s.created_at,
                dateFormatted: formatTime(s.created_at),
                fullDateTime: formatDateTime(s.created_at),
                operatorId: s.operator_id,
                operatorName: s.operator_name,
                operatorCode: s.operator_code,
                paymentMethod: s.payment_method,
                total: s.total,
                cost: s.cost,
                profit: s.profit,
                status: s.status,
                cancelReason: s.cancel_reason,
                items: (s.items || []).map(it => ({
                    productId: it.product_id,
                    name: it.product_name,
                    qty: it.qty,
                    price: it.unit_price,
                    cost: it.unit_cost
                }))
            }))
        };
    }

    // Formatar produtos (sem enviar base64 — imagens servidas como estáticos)
    const formattedProducts = products.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        cost: p.cost,
        price: p.price,
        stock: p.stock,
        minStock: p.min_stock,
        icon: p.icon,
        image: p.image_path ? `/${p.image_path}` : ''
    }));

    // Formatar usuários
    const formattedUsers = users.map(u => ({
        id: u.id,
        code: u.code,
        name: u.name,
        role: u.role,
        title: u.title,
        avatar: u.avatar
    }));

    // Formatar shifts fechados
    const formattedShifts = shifts.map(sh => ({
        id: sh.id,
        shiftCode: sh.shift_code,
        operatorId: sh.operator_id,
        operatorName: sh.operator_name,
        startTime: sh.start_time,
        endTime: sh.end_time,
        totalSales: sh.total_sales,
        totalRevenue: sh.total_revenue,
        systemCash: sh.system_cash,
        countedCash: sh.counted_cash,
        diff: sh.diff,
        status: sh.status
    }));

    return {
        saleCounter,
        users: formattedUsers,
        products: formattedProducts,
        sales: formattedSales,
        shifts: formattedShifts,
        activeShift: activeShiftFormatted
    };
}

// ==========================================================================
// BACKUP
// ==========================================================================

function createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(BACKUP_DIR, `panobianco_${timestamp}.db`);

    try {
        getDb().backup(backupPath);
        console.log(`💾 Backup criado: ${backupPath}`);

        // Limpar backups antigos (manter últimos 48)
        cleanOldBackups(48);

        return backupPath;
    } catch (e) {
        console.error('❌ Erro ao criar backup:', e.message);
        return null;
    }
}

function cleanOldBackups(keepCount) {
    try {
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('panobianco_') && f.endsWith('.db'))
            .sort()
            .reverse();

        if (files.length > keepCount) {
            const toDelete = files.slice(keepCount);
            toDelete.forEach(f => {
                fs.unlinkSync(path.join(BACKUP_DIR, f));
                console.log(`🗑️ Backup antigo removido: ${f}`);
            });
        }
    } catch (e) {
        console.error('⚠️ Erro ao limpar backups antigos:', e.message);
    }
}

// ==========================================================================
// UTILITÁRIOS
// ==========================================================================

function formatTime(isoString) {
    if (!isoString) return '--:--';
    try {
        const d = new Date(isoString.includes('T') ? isoString : isoString + 'Z');
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '--:--';
    }
}

function formatDateTime(isoString) {
    if (!isoString) return '';
    try {
        const d = new Date(isoString.includes('T') ? isoString : isoString + 'Z');
        return d.toLocaleString('pt-BR');
    } catch {
        return '';
    }
}

function closeDatabase() {
    if (db) {
        db.close();
        console.log('🔒 Banco SQLite fechado.');
    }
}

// ==========================================================================
// EXPORTS
// ==========================================================================

module.exports = {
    initDatabase,
    getDb,
    closeDatabase,

    // Users
    findUserByCode,
    getAllUsers,
    upsertUser,

    // Products
    getAllProducts,
    getProductById,
    upsertProduct,
    updateProductPhoto,
    updateProductStock,

    // Sales
    getNextSaleSeq,
    createSale,
    cancelSale,
    getSaleById,
    getAllSales,
    getSalesByShift,

    // Shifts
    getActiveShift,
    createShift,
    closeShift,
    getShiftHistory,

    // Audit
    logAudit,
    getAuditLogs,
    getAuditActionTypes,

    // Sessions
    createSession,
    validateSession,
    deleteSession,
    deleteUserSessions,
    cleanExpiredSessions,

    // Counters
    getCounter,

    // State
    getFullState,

    // Backup
    createBackup,

    // Paths
    UPLOADS_DIR,
    BACKUP_DIR,
    DB_PATH
};
