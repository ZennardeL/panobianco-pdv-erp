/**
 * Panobianco PDV & ERP — Data Service
 * 
 * Repositório centralizado de acesso a dados do Supabase.
 * Substitui todos os acessos diretos `supabase.from(...)` espalhados pelo código.
 * 
 * Cada método representa uma operação de negócio atômica.
 * Os módulos de domínio (cart, sales, shifts, etc.) chamam este serviço
 * em vez de acessar o Supabase diretamente.
 * 
 * @module services/data-service
 */

import { getClient, getTenantId } from './supabase-client.js';

// ────────────────────────────────────────────
// Estado Completo
// ────────────────────────────────────────────

/**
 * Carrega o estado completo do banco de dados.
 * Reproduz exatamente o getFullState() do adapter.js original.
 * 
 * @param {string} [tenantId] - ID do tenant
 * @returns {Promise<object>} Estado completo formatado para o frontend
 */
export async function getFullState(tenantId) {
    const client = getClient();
    const tid = tenantId || getTenantId();

    const [
        { data: products, error: prodErr },
        { data: users, error: userErr },
        { data: counters, error: countErr },
        { data: shifts, error: shiftErr },
        { data: sales, error: saleErr },
        { data: saleItems, error: itemErr }
    ] = await Promise.all([
        client.from('products').select('*').eq('tenant_id', tid).order('name'),
        client.from('users').select('*').eq('tenant_id', tid).order('name'),
        client.from('counters').select('*').eq('tenant_id', tid),
        client.from('shifts').select('*').eq('tenant_id', tid).order('created_at', { ascending: false }),
        client.from('sales').select('*').eq('tenant_id', tid).order('created_at', { ascending: false }),
        client.from('sale_items').select('*').eq('tenant_id', tid)
    ]);

    if (prodErr) throw prodErr;
    if (userErr) throw userErr;

    // Mapear itens para cada venda
    const itemsBySale = {};
    (saleItems || []).forEach(it => {
        if (!itemsBySale[it.sale_id]) itemsBySale[it.sale_id] = [];
        itemsBySale[it.sale_id].push({
            productId: it.product_id,
            name: it.product_name,
            qty: it.qty,
            price: Number(it.unit_price),
            cost: Number(it.unit_cost)
        });
    });

    const formattedSales = (sales || []).map(s => ({
        id: s.id,
        seq: s.seq,
        operatorId: s.operator_id,
        operatorName: s.operator_name,
        operatorCode: s.operator_code,
        paymentMethod: s.payment_method,
        total: Number(s.total),
        cost: Number(s.cost),
        profit: Number(s.profit),
        status: s.status,
        cancelReason: s.cancel_reason,
        cancelledBy: s.cancelled_by,
        shiftId: s.shift_id,
        timestamp: s.created_at,
        dateFormatted: new Date(s.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        fullDateTime: new Date(s.created_at).toLocaleString('pt-BR'),
        items: itemsBySale[s.id] || []
    }));

    // Buscar turno ativo
    const activeShiftRaw = (shifts || []).find(s => s.status === 'OPEN');
    const activeShift = activeShiftRaw ? {
        id: activeShiftRaw.id,
        shiftCode: activeShiftRaw.shift_code,
        operatorId: activeShiftRaw.operator_id,
        operatorName: activeShiftRaw.operator_name,
        startTime: activeShiftRaw.start_time,
        totalSales: activeShiftRaw.total_sales,
        totalRevenue: Number(activeShiftRaw.total_revenue),
        systemCash: Number(activeShiftRaw.system_cash),
        countedCash: activeShiftRaw.counted_cash ? Number(activeShiftRaw.counted_cash) : null,
        status: activeShiftRaw.status,
        sales: formattedSales.filter(s => s.shiftId === activeShiftRaw.id)
    } : null;

    const saleCounter = (counters || []).find(c => c.key === 'sale_counter')?.value || 0;
    const shiftCounter = (counters || []).find(c => c.key === 'shift_counter')?.value || 0;

    return {
        products: (products || []).filter(p => p.active !== false && p.active !== 0).map(p => ({
            id: p.id,
            name: p.name,
            category: p.category,
            cost: Number(p.cost),
            price: Number(p.price),
            stock: p.stock,
            minStock: p.min_stock,
            icon: p.icon || '📦',
            image: p.image_path || '',
            active: p.active
        })),
        users: (users || []).map(u => ({
            id: u.id,
            code: u.code,
            name: u.name,
            role: u.role,
            title: u.title,
            avatar: u.avatar || '👤',
            active: u.active
        })),
        sales: formattedSales,
        activeShift,
        shifts: (shifts || []).filter(s => s.status === 'CLOSED').map(s => ({
            id: s.id,
            shiftCode: s.shift_code,
            operatorId: s.operator_id,
            operatorName: s.operator_name,
            startTime: s.start_time,
            endTime: s.end_time,
            totalSales: s.total_sales,
            totalRevenue: Number(s.total_revenue),
            systemCash: Number(s.system_cash),
            countedCash: Number(s.counted_cash),
            diff: Number(s.diff),
            status: s.status,
            sales: formattedSales.filter(sale => sale.shiftId === s.id)
        })),
        saleCounter,
        shiftCounter
    };
}


// ────────────────────────────────────────────
// Vendas
// ────────────────────────────────────────────

/**
 * Processa uma venda via RPC atômico.
 * @param {object} salePayload - Dados da venda
 * @param {string} [tenantId] - ID do tenant
 * @returns {Promise<object>} Resultado da venda (seq, total, etc.)
 */
export async function processSale(salePayload, tenantId) {
    const client = getClient();
    const { data, error } = await client.rpc('process_sale', {
        p_tenant_id: tenantId || getTenantId(),
        p_operator_id: salePayload.operatorId,
        p_operator_name: salePayload.operatorName,
        p_operator_code: salePayload.operatorCode,
        p_payment_method: salePayload.paymentMethod,
        p_items: salePayload.items
    });
    if (error) throw error;
    return data;
}

/**
 * Cancela uma venda via RPC atômico.
 * @param {string} saleId - ID da venda
 * @param {string} operatorId - ID do operador
 * @param {string} operatorName - Nome do operador
 * @param {string} reason - Motivo do cancelamento
 * @param {boolean} isAdmin - Se o operador é admin
 * @param {string} [tenantId] - ID do tenant
 * @returns {Promise<object>} Resultado do cancelamento
 */
export async function cancelSale(saleId, operatorId, operatorName, reason, isAdmin, tenantId) {
    const client = getClient();
    const { data, error } = await client.rpc('cancel_sale', {
        p_tenant_id: tenantId || getTenantId(),
        p_sale_id: saleId,
        p_operator_id: operatorId,
        p_operator_name: operatorName,
        p_reason: reason,
        p_is_admin: isAdmin
    });
    if (error) throw error;
    return data;
}


// ────────────────────────────────────────────
// Produtos
// ────────────────────────────────────────────

/**
 * Cria ou atualiza um produto.
 * @param {object} product - Dados do produto
 * @param {string} [tenantId] - ID do tenant
 */
export async function upsertProduct(product, tenantId) {
    const client = getClient();
    const tid = tenantId || getTenantId();
    const { error } = await client.from('products').upsert({
        id: product.id,
        tenant_id: tid,
        name: product.name,
        category: product.category,
        cost: product.cost,
        price: product.price,
        stock: product.stock,
        min_stock: product.minStock || 5,
        icon: product.icon || '📦',
        image_path: product.image || '',
        active: product.active !== false,
        updated_at: new Date().toISOString()
    });
    if (error) throw error;
}

/**
 * Exclui um produto (soft delete, com fallback para hard delete).
 * @param {string} productId - ID do produto
 * @param {string} productName - Nome para auditoria
 * @param {string} operatorName - Operador que executou
 * @param {string} [tenantId] - ID do tenant
 */
export async function deleteProduct(productId, productName, operatorName, tenantId) {
    const client = getClient();
    const tid = tenantId || getTenantId();

    const { error } = await client
        .from('products')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', productId)
        .eq('tenant_id', tid);

    if (error) {
        const { error: delErr } = await client
            .from('products')
            .delete()
            .eq('id', productId)
            .eq('tenant_id', tid);
        if (delErr) throw delErr;
    }

    await insertAuditLog(tid, {
        action: 'PRODUTO_EXCLUIDO',
        entityType: 'product',
        entityId: productId,
        operatorName,
        details: `Produto ${productName || productId} foi excluído do catálogo por ${operatorName}`
    });
}

/**
 * Repõe estoque de um produto.
 * @param {string} productId - ID do produto
 * @param {number} qty - Quantidade a adicionar
 * @param {string} operatorId - ID do operador
 * @param {string} operatorName - Nome do operador
 * @param {string} [tenantId] - ID do tenant
 * @returns {Promise<number>} Novo estoque
 */
export async function restockProduct(productId, qty, operatorId, operatorName, tenantId) {
    const client = getClient();
    const tid = tenantId || getTenantId();

    const { data: prod, error: fetchErr } = await client
        .from('products')
        .select('name, stock')
        .eq('id', productId)
        .single();
    if (fetchErr) throw fetchErr;

    const newStock = prod.stock + qty;
    const { error: updErr } = await client
        .from('products')
        .update({ stock: newStock, updated_at: new Date().toISOString() })
        .eq('id', productId);
    if (updErr) throw updErr;

    await insertAuditLog(tid, {
        action: 'REPOSICAO',
        entityType: 'product',
        entityId: productId,
        operatorId,
        operatorName,
        details: `+${qty} unidades de ${prod.name} (Estoque: ${prod.stock} -> ${newStock})`
    });

    return newStock;
}


// ────────────────────────────────────────────
// Turnos (Shifts)
// ────────────────────────────────────────────

/**
 * Fecha o turno atual e abre um novo.
 * @param {number} countedCash - Valor contado no gaveta
 * @param {string} operatorId - ID do operador
 * @param {string} operatorName - Nome do operador
 * @param {string} [tenantId] - ID do tenant
 * @returns {Promise<{diff: number, systemCash: number, totalRevenue: number}>}
 */
export async function closeShift(countedCash, operatorId, operatorName, tenantId) {
    const client = getClient();
    const tid = tenantId || getTenantId();

    const { data: openShift, error: shiftErr } = await client
        .from('shifts')
        .select('*')
        .eq('tenant_id', tid)
        .eq('status', 'OPEN')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (shiftErr && shiftErr.code !== 'PGRST116') throw shiftErr;

    const { data: shiftSales } = await client
        .from('sales')
        .select('total, payment_method, status')
        .eq('tenant_id', tid)
        .eq('status', 'CONCLUIDA');

    let systemCash = 0;
    let totalRevenue = 0;
    (shiftSales || []).forEach(s => {
        totalRevenue += Number(s.total);
        if (s.payment_method === 'dinheiro') {
            systemCash += Number(s.total);
        }
    });

    const diff = countedCash - systemCash;
    const shiftId = openShift ? openShift.id : ('shift_' + Date.now());

    await client.from('shifts').upsert({
        id: shiftId,
        tenant_id: tid,
        shift_code: openShift ? openShift.shift_code : 'T01',
        operator_id: operatorId,
        operator_name: operatorName,
        start_time: openShift ? openShift.start_time : new Date().toISOString(),
        end_time: new Date().toISOString(),
        total_sales: (shiftSales || []).length,
        total_revenue: totalRevenue,
        system_cash: systemCash,
        counted_cash: countedCash,
        diff,
        status: 'CLOSED'
    });

    const nextShiftCode = 'T' + String(Date.now()).slice(-2);
    await client.from('shifts').insert({
        id: 'shift_' + Date.now(),
        tenant_id: tid,
        shift_code: nextShiftCode,
        operator_id: operatorId,
        operator_name: operatorName,
        start_time: new Date().toISOString(),
        status: 'OPEN'
    });

    await insertAuditLog(tid, {
        action: 'FECHAMENTO_TURNO',
        entityType: 'shift',
        entityId: shiftId,
        operatorId,
        operatorName,
        details: `Fechamento: Gaveta R$ ${countedCash.toFixed(2)} | Sistema R$ ${systemCash.toFixed(2)} | Dif R$ ${diff.toFixed(2)}`
    });

    return { diff, systemCash, totalRevenue };
}


// ────────────────────────────────────────────
// Usuários
// ────────────────────────────────────────────

/**
 * Cria ou atualiza um usuário.
 * @param {object} user - Dados do usuário
 * @param {string} operatorName - Nome do operador que executou
 * @param {string|null} originalCode - Código original (para detectar alteração)
 * @param {string} [tenantId] - ID do tenant
 */
export async function upsertUser(user, operatorName, originalCode = null, tenantId) {
    const client = getClient();
    const tid = tenantId || getTenantId();
    const newCode = user.code.toLowerCase();
    const origCode = originalCode ? originalCode.toLowerCase() : null;

    if (origCode && origCode !== newCode) {
        await client.from('users').delete().eq('tenant_id', tid).eq('code', origCode);
    }

    const userId = user.id || newCode;
    const { error } = await client.from('users').upsert({
        id: userId,
        tenant_id: tid,
        code: newCode,
        name: user.name,
        role: user.role,
        title: user.title || '',
        avatar: user.avatar || (user.role === 'ADMIN' ? '💼' : '👩‍💼'),
        active: user.active !== false
    });
    if (error) throw error;

    await insertAuditLog(tid, {
        action: origCode ? 'USUARIO_ATUALIZADO' : 'USUARIO_CRIADO',
        entityType: 'user',
        entityId: userId,
        operatorName,
        details: origCode && origCode !== newCode
            ? `Colaborador ${user.name} atualizado (Código alterado de ${origCode.toUpperCase()} para ${newCode.toUpperCase()})`
            : `Colaborador ${user.name} [${newCode.toUpperCase()}] ${origCode ? 'atualizado' : 'cadastrado'}`
    });
}

/**
 * Exclui um usuário.
 * @param {string} userCode - Código do usuário
 * @param {string} userName - Nome do usuário
 * @param {string} operatorName - Operador que executou
 * @param {string} [tenantId] - ID do tenant
 */
export async function deleteUser(userCode, userName, operatorName, tenantId) {
    const client = getClient();
    const tid = tenantId || getTenantId();
    const codeToDel = userCode.toLowerCase();

    const { error } = await client.from('users').delete().eq('tenant_id', tid).eq('code', codeToDel);
    if (error) throw error;

    await insertAuditLog(tid, {
        action: 'USUARIO_EXCLUIDO',
        entityType: 'user',
        entityId: codeToDel,
        operatorName,
        details: `Colaborador ${userName || codeToDel} [${codeToDel.toUpperCase()}] foi excluído por ${operatorName}`
    });
}


// ────────────────────────────────────────────
// Auditoria
// ────────────────────────────────────────────

/**
 * Insere um registro de auditoria.
 * Centraliza a lógica que estava duplicada em 6+ métodos do adapter.js.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {object} entry - Dados do log
 * @param {string} entry.action - Tipo de ação
 * @param {string} entry.entityType - Tipo da entidade
 * @param {string} entry.entityId - ID da entidade
 * @param {string} [entry.operatorId] - ID do operador
 * @param {string} entry.operatorName - Nome do operador
 * @param {string} entry.details - Descrição detalhada
 */
export async function insertAuditLog(tenantId, entry) {
    const client = getClient();
    await client.from('audit_log').insert({
        tenant_id: tenantId,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        operator_id: entry.operatorId || 'admin',
        operator_name: entry.operatorName,
        details: entry.details
    });
}

/**
 * Busca logs de auditoria com filtros.
 * @param {object} [filters] - Filtros opcionais
 * @param {string} [tenantId] - ID do tenant
 * @returns {Promise<{logs: Array, actionTypes: Array}>}
 */
export async function getAuditLogs(filters = {}, tenantId) {
    const client = getClient();
    const tid = tenantId || getTenantId();

    let query = client
        .from('audit_log')
        .select('*')
        .eq('tenant_id', tid)
        .order('created_at', { ascending: false })
        .limit(filters.limit || 200);

    if (filters.action) query = query.eq('action', filters.action);
    if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom);
    if (filters.dateTo) query = query.lte('created_at', filters.dateTo);
    if (filters.search) {
        query = query.or(
            `operator_name.ilike.%${filters.search}%,details.ilike.%${filters.search}%,entity_id.ilike.%${filters.search}%`
        );
    }

    const { data: logs, error } = await query;
    if (error) throw error;

    const { data: actions } = await client
        .from('audit_log')
        .select('action')
        .eq('tenant_id', tid);

    const actionTypes = [...new Set((actions || []).map(a => a.action))].sort();

    return { logs: logs || [], actionTypes };
}
