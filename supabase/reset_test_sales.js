/**
 * SCRIPT PARA ZERAR VENDAS TESTE NO SUPABASE CLOUD
 * Restaura o contador para V01 e limpa as vendas de teste.
 */
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://jawrukqnncnjgzixjaqy.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imphd3J1a3FubmNuamd6aXhqYXF5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODI4NzU0OSwiZXhwIjoyMTAzODYzNTQ5fQ.EWnH-PHzlK9m5fCh2sZd4C1EGQbewLKfV-3MNnu4qJA';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function resetTestSales() {
    console.log('🧹 Limpando vendas de teste no Supabase Cloud...');

    // 1. Limpar itens de venda
    const { error: itemErr } = await supabase.from('sale_items').delete().neq('id', 0);
    if (itemErr) console.error('Erro ao limpar sale_items:', itemErr);
    else console.log('✅ Itens de venda limpos.');

    // 2. Limpar vendas
    const { error: saleErr } = await supabase.from('sales').delete().neq('id', '___none___');
    if (saleErr) console.error('Erro ao limpar sales:', saleErr);
    else console.log('✅ Vendas de teste removidas.');

    // 3. Resetar contador de vendas para 0 (Próxima venda será V01)
    const { error: countErr } = await supabase.from('counters').upsert([
        { tenant_id: 'default', key: 'sale_counter', value: 0 },
        { tenant_id: 'default', key: 'shift_counter', value: 0 }
    ]);
    if (countErr) console.error('Erro ao resetar counters:', countErr);
    else console.log('✅ Contador de vendas zerado (Próxima venda: V01).');

    // 4. Limpar turnos antigos e criar turno inicial limpo T01
    await supabase.from('shifts').delete().neq('id', '___none___');
    const { error: shiftErr } = await supabase.from('shifts').insert({
        id: 'shift_init_clean',
        tenant_id: 'default',
        shift_code: 'T01',
        operator_id: 'f20729',
        operator_name: 'Luan [F20729]',
        start_time: new Date().toISOString(),
        total_sales: 0,
        total_revenue: 0,
        system_cash: 0,
        status: 'OPEN'
    });
    if (shiftErr) console.error('Erro ao criar turno limpo:', shiftErr);
    else console.log('✅ Turno inicial T01 aberto e zerado.');

    // 5. Limpar logs de teste e registrar reset
    await supabase.from('audit_log').delete().neq('id', 0);
    await supabase.from('audit_log').insert({
        tenant_id: 'default',
        action: 'SISTEMA_ZERADO',
        entity_type: 'system',
        entity_id: 'v3.0.0',
        operator_id: 'f20729',
        operator_name: 'Luan [F20729]',
        details: 'Vendas de teste limpas. Contador reiniciado para V01. Sistema pronto para operação real.'
    });
    console.log('✅ Log de auditoria atualizado.');

    console.log('\n🎉 BANCO DE DADOS LIMPO E PRONTO PARA O INÍCIO DAS VENDAS REAIS (V01)!');
}

resetTestSales();
