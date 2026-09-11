/**
 * Panobianco PDV & ERP — Supabase Client
 * 
 * Inicialização centralizada do client Supabase.
 * Único ponto de criação do client — elimina duplicação e centraliza config.
 * 
 * @module services/supabase-client
 */

import { DEFAULT_TENANT_ID } from '../core/constants.js';

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let _client = null;

/** @type {object} */
let _config = null;

/** @type {boolean} */
let _connected = false;

/**
 * Inicializa o Supabase client com as credenciais fornecidas.
 * Seguro para ser chamado múltiplas vezes — reutiliza o client existente.
 * 
 * @param {object} [config] - Configuração manual. Se omitido, usa SUPABASE_CONFIG global.
 * @param {string} config.url - URL do projeto Supabase
 * @param {string} config.anonKey - Chave anon/pública
 * @param {string} [config.tenantId] - ID do tenant (default: 'default')
 * @returns {boolean} true se conexão foi estabelecida
 */
export function initSupabase(config) {
    // Reutilizar client existente se já conectado
    if (_client && _connected) return true;

    // Resolver config: parâmetro > global > localStorage
    _config = config || (typeof window.SUPABASE_CONFIG !== 'undefined' ? window.SUPABASE_CONFIG : null);

    if (!_config || !_config.url || !_config.anonKey) {
        console.warn('⚠️ Supabase: configuração não encontrada.');
        return false;
    }

    // Ignorar placeholders
    if (_config.url.includes('SUA-URL') || _config.anonKey.includes('SUA-ANON')) {
        console.warn('⚠️ Supabase: credenciais placeholder detectadas.');
        return false;
    }

    try {
        // supabase é carregado via CDN (<script> no index.html)
        if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
            _client = window.supabase.createClient(_config.url, _config.anonKey);
            _connected = true;
            console.log('⚡ Supabase Client inicializado com sucesso.');
        } else {
            console.warn('⚠️ Supabase SDK não encontrado. Verifique o <script> no index.html.');
        }
    } catch (e) {
        console.error('❌ Erro ao inicializar Supabase Client:', e);
        _connected = false;
    }

    return _connected;
}

/**
 * Retorna o client Supabase. Lança erro se não inicializado.
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 * @throws {Error} Se o client não foi inicializado
 */
export function getClient() {
    if (!_client) throw new Error('Supabase não conectado. Chame initSupabase() primeiro.');
    return _client;
}

/**
 * Retorna o client Supabase ou null (sem lançar erro).
 * Útil para verificações condicionais.
 * @returns {import('@supabase/supabase-js').SupabaseClient | null}
 */
export function getClientOrNull() {
    return _client;
}

/**
 * Verifica se o Supabase está conectado.
 * @returns {boolean}
 */
export function isConnected() {
    return _connected;
}

/**
 * Retorna a config atual.
 * @returns {object|null}
 */
export function getConfig() {
    return _config;
}

/**
 * Retorna o tenant ID configurado.
 * @returns {string}
 */
export function getTenantId() {
    return (_config && _config.tenantId) || DEFAULT_TENANT_ID;
}

/**
 * Testa a conexão com o Supabase fazendo uma query leve.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export async function testConnection() {
    if (!_client) return { success: false, error: 'Cliente Supabase não inicializado.' };
    try {
        const { data, error } = await _client.from('tenants').select('id, name').limit(1);
        if (error) throw error;
        return { success: true, data };
    } catch (e) {
        return { success: false, error: e.message || 'Erro ao conectar ao Supabase.' };
    }
}

/**
 * Destrói o client e reseta o estado.
 * Usado em logout ou troca de credenciais.
 */
export function destroyClient() {
    _client = null;
    _config = null;
    _connected = false;
}
