/**
 * ==========================================================================
 * SCRIPT DE MIGRAÇÃO: SQLite (panobianco.db) -> Supabase Cloud (PostgreSQL)
 * ==========================================================================
 * 
 * Uso:
 *   node supabase/migrate_sqlite_to_supabase.js <SUPABASE_URL> <SUPABASE_SERVICE_ROLE_OU_ANON_KEY>
 * 
 * Exemplo:
 *   node supabase/migrate_sqlite_to_supabase.js https://xyz.supabase.co eyJhbGciOi...
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.argv[2] || process.env.SUPABASE_URL;
const supabaseKey = process.argv[3] || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error(`
❌ ERRO: Credenciais do Supabase não fornecidas!

Uso correto:
  node supabase/migrate_sqlite_to_supabase.js <SUPABASE_URL> <SUPABASE_KEY>

Ou configure as variáveis de ambiente SUPABASE_URL e SUPABASE_KEY.
`);
    process.exit(1);
}

const dbPath = path.join(__dirname, '..', 'panobianco.db');
if (!fs.existsSync(dbPath)) {
    console.error(`❌ Banco SQLite não encontrado em: ${dbPath}`);
    process.exit(1);
}

const sqlite = new Database(dbPath);
const supabase = createClient(supabaseUrl, supabaseKey);

async function uploadProductPhoto(productId, relativePath) {
    if (!relativePath) return '';
    const fullPath = path.join(__dirname, '..', relativePath);
    if (!fs.existsSync(fullPath)) return '';

    try {
        const fileBuffer = fs.readFileSync(fullPath);
        const fileName = `${productId}.jpg`;

        const { data, error } = await supabase.storage
            .from('product-images')
            .upload(fileName, fileBuffer, {
                contentType: 'image/jpeg',
                upsert: true
            });

        if (error) {
            console.warn(`  ⚠️ Aviso ao enviar foto ${fileName}:`, error.message);
            return '';
        }

        const { data: publicData } = supabase.storage
            .from('product-images')
            .getPublicUrl(fileName);

        return publicData.publicUrl;
    } catch (e) {
        console.warn(`  ⚠️ Erro no upload da foto ${productId}:`, e.message);
        return '';
    }
}

async function runMigration() {
    console.log('===========================================================');
    console.log('🚀 INICIANDO MIGRAÇÃO: SQLite -> Supabase Cloud');
    console.log(`📍 Supabase URL: ${supabaseUrl}`);
    console.log(`📦 SQLite: ${dbPath}`);
    console.log('===========================================================\n');

    try {
        // 1. Migrar Tenant padrão
        console.log('1. Garantindo Tenant padrão...');
        const { error: tenantErr } = await supabase
            .from('tenants')
            .upsert({ id: 'default', name: 'Panobianco Unidade Piloto' });
        if (tenantErr) throw tenantErr;
        console.log('   ✅ Tenant default OK\n');

        // 2. Migrar Usuários
        console.log('2. Migrando Usuários...');
        const users = sqlite.prepare('SELECT * FROM users').all();
        for (const u of users) {
            const { error } = await supabase.from('users').upsert({
                id: u.id,
                tenant_id: u.tenant_id || 'default',
                code: u.code,
                name: u.name,
                role: u.role,
                title: u.title,
                avatar: u.avatar || '👤',
                active: u.active === 1,
                created_at: u.created_at
            });
            if (error) console.error(`   ❌ Erro ao migrar usuário ${u.name}:`, error.message);
            else console.log(`   👤 Usuário migrado: ${u.name} [${u.code}]`);
        }
        console.log(`   ✅ ${users.length} usuários processados\n`);

        // 3. Migrar Produtos e Fotos
        console.log('3. Migrando Produtos e Fotos para o Storage...');
        const products = sqlite.prepare('SELECT * FROM products').all();
        for (const p of products) {
            let publicPhotoUrl = '';
            if (p.image_path) {
                publicPhotoUrl = await uploadProductPhoto(p.id, p.image_path);
            }

            const { error } = await supabase.from('products').upsert({
                id: p.id,
                tenant_id: p.tenant_id || 'default',
                name: p.name,
                category: p.category,
                cost: p.cost,
                price: p.price,
                stock: p.stock,
                min_stock: p.min_stock,
                icon: p.icon || '📦',
                image_path: publicPhotoUrl || p.image_path || '',
                active: p.active === 1,
                created_at: p.created_at,
                updated_at: p.updated_at
            });

            if (error) console.error(`   ❌ Erro ao migrar produto ${p.name}:`, error.message);
            else console.log(`   📦 Produto migrado: ${p.name} (Estoque: ${p.stock}) ${publicPhotoUrl ? '📷 [Foto na Nuvem]' : ''}`);
        }
        console.log(`   ✅ ${products.length} produtos processados\n`);

        // 4. Migrar Contadores
        console.log('4. Sincronizando Contadores...');
        const counters = sqlite.prepare('SELECT * FROM counters').all();
        for (const c of counters) {
            await supabase.from('counters').upsert({
                tenant_id: c.tenant_id || 'default',
                key: c.key,
                value: c.value
            });
        }
        console.log(`   ✅ Contadores sincronizados\n`);

        // 5. Migrar Turnos
        console.log('5. Migrando Turnos de Caixa...');
        const shifts = sqlite.prepare('SELECT * FROM shifts').all();
        for (const s of shifts) {
            await supabase.from('shifts').upsert({
                id: s.id,
                tenant_id: s.tenant_id || 'default',
                shift_code: s.shift_code,
                operator_id: s.operator_id,
                operator_name: s.operator_name,
                start_time: s.start_time,
                end_time: s.end_time,
                total_sales: s.total_sales,
                total_revenue: s.total_revenue,
                system_cash: s.system_cash,
                counted_cash: s.counted_cash,
                diff: s.diff,
                status: s.status,
                created_at: s.created_at
            });
        }
        console.log(`   ✅ ${shifts.length} turnos migrados\n`);

        // 6. Migrar Vendas e Itens
        console.log('6. Migrando Histórico de Vendas e Itens...');
        const sales = sqlite.prepare('SELECT * FROM sales').all();
        for (const sale of sales) {
            const { error: saleErr } = await supabase.from('sales').upsert({
                id: sale.id,
                tenant_id: sale.tenant_id || 'default',
                seq: sale.seq,
                operator_id: sale.operator_id,
                operator_name: sale.operator_name,
                operator_code: sale.operator_code,
                payment_method: sale.payment_method,
                total: sale.total,
                cost: sale.cost,
                profit: sale.profit,
                status: sale.status,
                cancel_reason: sale.cancel_reason,
                cancelled_by: sale.cancelled_by,
                shift_id: sale.shift_id,
                created_at: sale.created_at
            });

            if (saleErr) {
                console.error(`   ❌ Erro ao migrar venda ${sale.id}:`, saleErr.message);
                continue;
            }

            const items = sqlite.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
            for (const item of items) {
                await supabase.from('sale_items').upsert({
                    sale_id: item.sale_id,
                    tenant_id: item.tenant_id || 'default',
                    product_id: item.product_id,
                    product_name: item.product_name,
                    qty: item.qty,
                    unit_price: item.unit_price,
                    unit_cost: item.unit_cost
                });
            }
            console.log(`   🧾 Venda ${sale.id} migrada com ${items.length} itens`);
        }
        console.log(`   ✅ ${sales.length} vendas migradas\n`);

        // 7. Migrar Logs de Auditoria
        console.log('7. Migrando Trilha de Auditoria...');
        const logs = sqlite.prepare('SELECT * FROM audit_log').all();
        for (const log of logs) {
            await supabase.from('audit_log').insert({
                tenant_id: log.tenant_id || 'default',
                action: log.action,
                entity_type: log.entity_type,
                entity_id: log.entity_id,
                operator_id: log.operator_id,
                operator_name: log.operator_name,
                details: log.details,
                created_at: log.created_at
            });
        }
        console.log(`   ✅ ${logs.length} registros de auditoria migrados\n`);

        console.log('===========================================================');
        console.log('🎉 MIGRAÇÃO CONCLUÍDA COM SUCESSO!');
        console.log('Todas as tabelas, produtos, estoque, fotos e histórico');
        console.log('estão sincronizados no Supabase Cloud.');
        console.log('===========================================================');
    } catch (err) {
        console.error('❌ Erro fatal durante a migração:', err);
    } finally {
        sqlite.close();
    }
}

runMigration();
