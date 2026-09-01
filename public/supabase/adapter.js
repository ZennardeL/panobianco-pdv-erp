/**
 * ==========================================================================
 * SUPABASE CLOUD ADAPTER — PANOBIANCO PDV & ERP
 * ==========================================================================
 * 
 * Gerencia toda a comunicação direta com o Supabase:
 * - Consultas PostgreSQL
 * - Chamadas de Stored Procedures RPC (process_sale com lock atômico)
 * - Assinaturas WebSockets em Tempo Real (Realtime)
 * - Upload de Fotos no Supabase Storage
 */

class SupabaseAdapter {
    constructor() {
        this.client = null;
        this.config = null;
        this.channel = null;
        this.isConnected = false;
    }

    init(config = SUPABASE_CONFIG) {
        this.config = config;
        if (this.isConfigured()) {
            try {
                if (typeof supabase !== 'undefined' && supabase.createClient) {
                    this.client = supabase.createClient(config.url, config.anonKey);
                    this.isConnected = true;
                    console.log('⚡ Supabase Client inicializado com sucesso.');
                }
            } catch (e) {
                console.error('❌ Erro ao inicializar Supabase Client:', e);
                this.isConnected = false;
            }
        }
        return this.isConnected;
    }

    isConfigured() {
        return Boolean(
            this.config &&
            this.config.url &&
            this.config.anonKey &&
            !this.config.url.includes('SUA-URL') &&
            !this.config.anonKey.includes('SUA-ANON')
        );
    }

    async testConnection() {
        if (!this.client) return { success: false, error: 'Cliente Supabase não inicializado.' };
        try {
            const { data, error } = await this.client.from('tenants').select('id, name').limit(1);
            if (error) throw error;
            return { success: true, data };
        } catch (e) {
            return { success: false, error: e.message || 'Erro ao conectar ao Supabase.' };
        }
    }

    async getFullState(tenantId = 'default') {
        if (!this.client) throw new Error('Supabase não conectado.');

        const [
            { data: products, error: prodErr },
            { data: users, error: userErr },
            { data: counters, error: countErr },
            { data: shifts, error: shiftErr },
            { data: sales, error: saleErr },
            { data: saleItems, error: itemErr }
        ] = await Promise.all([
            this.client.from('products').select('*').eq('tenant_id', tenantId).order('name'),
            this.client.from('users').select('*').eq('tenant_id', tenantId).order('name'),
            this.client.from('counters').select('*').eq('tenant_id', tenantId),
            this.client.from('shifts').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
            this.client.from('sales').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
            this.client.from('sale_items').select('*').eq('tenant_id', tenantId)
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
            products: (products || []).map(p => ({
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
            activeShift: activeShift,
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

    /**
     * Executa a venda atomicamente via PostgreSQL RPC
     * Garante sequência estrita V01, V02... e decremento seguro sem race conditions
     */
    async processSale(salePayload, tenantId = 'default') {
        if (!this.client) throw new Error('Supabase não conectado.');

        const { data, error } = await this.client.rpc('process_sale', {
            p_tenant_id: tenantId,
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
     * Cancela uma venda atomicamente via RPC
     */
    async cancelSale(saleId, operatorId, operatorName, reason, isAdmin, tenantId = 'default') {
        if (!this.client) throw new Error('Supabase não conectado.');

        const { data, error } = await this.client.rpc('cancel_sale', {
            p_tenant_id: tenantId,
            p_sale_id: saleId,
            p_operator_id: operatorId,
            p_operator_name: operatorName,
            p_reason: reason,
            p_is_admin: isAdmin
        });

        if (error) throw error;
        return data;
    }

    /**
     * Upload de foto do produto para o Supabase Storage
     */
    async uploadProductPhoto(productId, base64Data) {
        if (!this.client) throw new Error('Supabase não conectado.');

        // Converter base64 para Blob
        const response = await fetch(base64Data);
        const blob = await response.blob();
        const fileName = `${productId}_${Date.now()}.jpg`;

        const { data, error } = await this.client.storage
            .from('product-images')
            .upload(fileName, blob, {
                contentType: 'image/jpeg',
                upsert: true
            });

        if (error) throw error;

        const { data: publicData } = this.client.storage
            .from('product-images')
            .getPublicUrl(fileName);

        const publicUrl = publicData.publicUrl;

        // Atualizar URL na tabela products
        await this.client
            .from('products')
            .update({ image_path: publicUrl, updated_at: new Date().toISOString() })
            .eq('id', productId);

        return publicUrl;
    }

    /**
     * Atualizar produto no catálogo
     */
    async upsertProduct(product, tenantId = 'default') {
        if (!this.client) throw new Error('Supabase não conectado.');

        const { data, error } = await this.client
            .from('products')
            .upsert({
                id: product.id,
                tenant_id: tenantId,
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
        return data;
    }

    /**
     * Entrada de estoque (Reposição)
     */
    async restockProduct(productId, qty, operatorId, operatorName, tenantId = 'default') {
        if (!this.client) throw new Error('Supabase não conectado.');

        const { data: prod, error: fetchErr } = await this.client
            .from('products')
            .select('name, stock')
            .eq('id', productId)
            .single();

        if (fetchErr) throw fetchErr;

        const newStock = prod.stock + qty;
        const { error: updErr } = await this.client
            .from('products')
            .update({ stock: newStock, updated_at: new Date().toISOString() })
            .eq('id', productId);

        if (updErr) throw updErr;

        // Gravar auditoria
        await this.client.from('audit_log').insert({
            tenant_id: tenantId,
            action: 'REPOSICAO',
            entity_type: 'product',
            entity_id: productId,
            operator_id: operatorId,
            operator_name: operatorName,
            details: `+${qty} unidades de ${prod.name} (Estoque: ${prod.stock} -> ${newStock})`
        });

        return newStock;
    }

    /**
     * Buscar logs de auditoria com filtros
     */
    async getAuditLogs(filters = {}, tenantId = 'default') {
        if (!this.client) throw new Error('Supabase não conectado.');

        let query = this.client
            .from('audit_log')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })
            .limit(filters.limit || 200);

        if (filters.action) query = query.eq('action', filters.action);
        if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom);
        if (filters.dateTo) query = query.lte('created_at', filters.dateTo);
        if (filters.search) {
            query = query.or(`operator_name.ilike.%${filters.search}%,details.ilike.%${filters.search}%,entity_id.ilike.%${filters.search}%`);
        }

        const { data: logs, error } = await query;
        if (error) throw error;

        // Buscar tipos distintos de ação
        const { data: actions } = await this.client
            .from('audit_log')
            .select('action')
            .eq('tenant_id', tenantId);

        const actionTypes = [...new Set((actions || []).map(a => a.action))].sort();

        return { logs: logs || [], actionTypes };
    }

    /**
     * Fechar turno de caixa no Supabase
     */
    async closeShift(countedCash, operatorId, operatorName, tenantId = 'default') {
        if (!this.client) throw new Error('Supabase não conectado.');

        // Buscar turno aberto atual
        const { data: openShift, error: shiftErr } = await this.client
            .from('shifts')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('status', 'OPEN')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (shiftErr && shiftErr.code !== 'PGRST116') throw shiftErr;

        // Buscar vendas do turno atual
        const { data: shiftSales } = await this.client
            .from('sales')
            .select('total, payment_method, status')
            .eq('tenant_id', tenantId)
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

        // Atualizar turno fechado
        await this.client
            .from('shifts')
            .upsert({
                id: shiftId,
                tenant_id: tenantId,
                shift_code: openShift ? openShift.shift_code : 'T01',
                operator_id: operatorId,
                operator_name: operatorName,
                start_time: openShift ? openShift.start_time : new Date().toISOString(),
                end_time: new Date().toISOString(),
                total_sales: (shiftSales || []).length,
                total_revenue: totalRevenue,
                system_cash: systemCash,
                counted_cash: countedCash,
                diff: diff,
                status: 'CLOSED'
            });

        // Abrir novo turno
        const nextShiftCode = 'T' + String(Date.now()).slice(-2);
        await this.client
            .from('shifts')
            .insert({
                id: 'shift_' + Date.now(),
                tenant_id: tenantId,
                shift_code: nextShiftCode,
                operator_id: operatorId,
                operator_name: operatorName,
                start_time: new Date().toISOString(),
                status: 'OPEN'
            });

        // Registrar auditoria
        await this.client.from('audit_log').insert({
            tenant_id: tenantId,
            action: 'FECHAMENTO_TURNO',
            entity_type: 'shift',
            entity_id: shiftId,
            operator_id: operatorId,
            operator_name: operatorName,
            details: `Fechamento: Gaveta R$ ${countedCash.toFixed(2)} | Sistema R$ ${systemCash.toFixed(2)} | Dif R$ ${diff.toFixed(2)}`
        });

        return { diff, systemCash, totalRevenue };
    }

    /**
     * Salvar / Atualizar Usuário
     */
    async upsertUser(user, operatorName, tenantId = 'default') {
        if (!this.client) throw new Error('Supabase não conectado.');

        const userId = user.id || ('user_' + user.code.toLowerCase());
        const { error } = await this.client
            .from('users')
            .upsert({
                id: userId,
                tenant_id: tenantId,
                code: user.code.toLowerCase(),
                name: user.name,
                role: user.role,
                title: user.title || '',
                avatar: user.avatar || '👤',
                active: user.active !== false
            });

        if (error) throw error;

        await this.client.from('audit_log').insert({
            tenant_id: tenantId,
            action: 'USUARIO_ATUALIZADO',
            entity_type: 'user',
            entity_id: userId,
            operator_id: 'admin',
            operator_name: operatorName,
            details: `Colaborador ${user.name} [${user.code.toUpperCase()}] atualizado`
        });
    }

    /**
     * Iniciar escuta WebSockets Realtime para sincronização instantânea
     */
    subscribeRealtime(onDataChanged, tenantId = 'default') {
        if (!this.client) return null;

        if (this.channel) {
            this.client.removeChannel(this.channel);
        }

        this.channel = this.client
            .channel('panobianco-realtime')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'products', filter: `tenant_id=eq.${tenantId}` },
                (payload) => {
                    console.log('⚡ [Realtime] Produto alterado:', payload);
                    if (onDataChanged) onDataChanged('product', payload);
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'sales', filter: `tenant_id=eq.${tenantId}` },
                (payload) => {
                    console.log('⚡ [Realtime] Nova venda ou cancelamento:', payload);
                    if (onDataChanged) onDataChanged('sale', payload);
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'shifts', filter: `tenant_id=eq.${tenantId}` },
                (payload) => {
                    console.log('⚡ [Realtime] Turno de caixa alterado:', payload);
                    if (onDataChanged) onDataChanged('shift', payload);
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'users', filter: `tenant_id=eq.${tenantId}` },
                (payload) => {
                    console.log('⚡ [Realtime] Usuário alterado:', payload);
                    if (onDataChanged) onDataChanged('user', payload);
                }
            )
            .subscribe((status) => {
                console.log('⚡ [Realtime Channel Status]:', status);
            });

        return this.channel;
    }
}

const supabaseAdapter = new SupabaseAdapter();
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SupabaseAdapter, supabaseAdapter };
}
