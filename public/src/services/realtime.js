/**
 * Panobianco PDV & ERP — Realtime Service
 * 
 * Gerencia subscrições WebSocket do Supabase Realtime.
 * Extraído de subscribeRealtime() do adapter.js com melhorias:
 * - Cleanup explícito no unsubscribe
 * - Proteção contra listeners duplicados
 * - Debounce opcional para evitar re-renders excessivos
 * 
 * @module services/realtime
 */

import { getClientOrNull, getTenantId } from './supabase-client.js';
import { debounce } from '../core/helpers.js';

/** @type {import('@supabase/supabase-js').RealtimeChannel | null} */
let _channel = null;

/** Tabelas monitoradas via Realtime */
const MONITORED_TABLES = ['products', 'sales', 'shifts', 'users'];

/**
 * Inicia a escuta Realtime para sincronização instantânea.
 * Monitora: products, sales, shifts, users.
 * 
 * Se já existir um canal ativo, ele é destruído antes de criar um novo.
 * 
 * @param {Function} onDataChanged - Callback chamado quando dados mudam.
 *   Recebe (entityType: string, payload: object).
 * @param {string} [tenantId] - ID do tenant para filtrar eventos
 * @param {number} [debounceMs=0] - Se > 0, aplica debounce ao callback
 * @returns {object|null} Canal do Realtime ou null se Supabase indisponível
 */
export function subscribe(onDataChanged, tenantId, debounceMs = 0) {
    const client = getClientOrNull();
    if (!client) return null;

    // Cleanup canal anterior
    unsubscribe();

    const tid = tenantId || getTenantId();
    const handler = debounceMs > 0 ? debounce(onDataChanged, debounceMs) : onDataChanged;

    _channel = client.channel('panobianco-realtime');

    for (const table of MONITORED_TABLES) {
        _channel.on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table,
                filter: `tenant_id=eq.${tid}`
            },
            (payload) => {
                console.log(`⚡ [Realtime] ${table} alterado:`, payload);
                if (handler) handler(table, payload);
            }
        );
    }

    _channel.subscribe((status) => {
        console.log('⚡ [Realtime Channel Status]:', status);
    });

    return _channel;
}

/**
 * Para a escuta Realtime e limpa o canal.
 * Seguro para chamar mesmo se não houver canal ativo.
 */
export function unsubscribe() {
    if (_channel) {
        const client = getClientOrNull();
        if (client) {
            client.removeChannel(_channel);
        }
        _channel = null;
    }
}

/**
 * Verifica se há um canal Realtime ativo.
 * @returns {boolean}
 */
export function isSubscribed() {
    return _channel !== null;
}
