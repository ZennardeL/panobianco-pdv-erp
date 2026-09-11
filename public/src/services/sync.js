/**
 * Panobianco PDV & ERP — Sync Service
 * 
 * Unifica a lógica de fallback em 3 camadas que estava TRIPLICADA no app.js:
 *   1. Supabase Cloud (se conectado)
 *   2. Servidor local Node.js + SQLite (se rodando)
 *   3. localStorage do navegador (sempre disponível)
 * 
 * Cada operação de dados deve chamar este serviço em vez de implementar
 * seu próprio try/catch com 3 caminhos.
 * 
 * @module services/sync
 */

const LOCAL_STORAGE_KEY = 'panobianco_state';

// ────────────────────────────────────────────
// Estado Local (localStorage)
// ────────────────────────────────────────────

/**
 * Carrega o estado do localStorage.
 * @returns {object|null} Estado salvo ou null
 */
export function loadLocalState() {
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        console.error('Erro ao ler estado local:', e);
        return null;
    }
}

/**
 * Salva o estado no localStorage.
 * @param {object} state - Estado completo para salvar
 */
export function saveLocalState(state) {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.error('Erro ao salvar estado local:', e);
    }
}


// ────────────────────────────────────────────
// API Local (Node.js server)
// ────────────────────────────────────────────

/**
 * Resolve a base URL do servidor local.
 * @returns {string}
 */
export function getApiBase() {
    if (typeof window !== 'undefined' && window.location.origin.includes('http')) {
        return window.location.origin;
    }
    return 'http://localhost:3000';
}

/**
 * Fetch autenticado para o servidor local.
 * Injeta o Bearer token da sessão e intercepta 401/403.
 * 
 * @param {string} url - URL completa
 * @param {object} [options] - Opções do fetch
 * @param {Function} [onUnauthorized] - Callback para 401 (logout)
 * @returns {Promise<Response>}
 */
export async function authFetch(url, options = {}, onUnauthorized) {
    const token = sessionStorage.getItem('panobianco_token');
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(url, { ...options, headers });

    if (res.status === 401) {
        if (onUnauthorized) onUnauthorized();
        throw new Error('Sessão expirada. Faça login novamente.');
    }
    if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Acesso restrito a gestores (ADMIN).');
    }

    return res;
}


// ────────────────────────────────────────────
// Executor com Fallback de 3 Camadas
// ────────────────────────────────────────────

/**
 * Executa uma operação com fallback automático de 3 camadas.
 * 
 * Este é o coração do sistema de resiliência. Ele recebe até 3 estratégias
 * (Supabase, API local, offline) e executa a primeira que funcionar.
 * 
 * @param {object} strategies - Estratégias disponíveis
 * @param {Function} [strategies.supabase] - Função async que executa via Supabase
 * @param {Function} [strategies.api] - Função async que executa via API local
 * @param {Function} [strategies.offline] - Função que executa via localStorage
 * @param {object} [context] - Contexto adicional
 * @param {boolean} [context.useSupabase] - Se o Supabase está habilitado
 * @returns {Promise<{result: any, source: 'supabase'|'api'|'offline'}>}
 * @throws {Error} Se todas as estratégias falharem
 * 
 * @example
 * const { result, source } = await executeWithFallback({
 *     supabase: () => dataService.processSale(payload),
 *     api: () => authFetch('/api/sale', { method: 'POST', body: JSON.stringify(payload) }),
 *     offline: () => { state.sales.push(sale); saveLocalState(state); return sale; }
 * }, { useSupabase: true });
 */
export async function executeWithFallback(strategies, context = {}) {
    const errors = [];

    // Camada 1: Supabase Cloud
    if (context.useSupabase && strategies.supabase) {
        try {
            const result = await strategies.supabase();
            return { result, source: 'supabase' };
        } catch (e) {
            console.warn('⚠️ Supabase falhou, tentando API local:', e.message);
            errors.push({ layer: 'supabase', error: e });
        }
    }

    // Camada 2: Servidor local Node.js
    if (strategies.api) {
        try {
            const result = await strategies.api();
            return { result, source: 'api' };
        } catch (e) {
            console.warn('⚠️ API local falhou, tentando offline:', e.message);
            errors.push({ layer: 'api', error: e });
        }
    }

    // Camada 3: localStorage (offline)
    if (strategies.offline) {
        try {
            const result = strategies.offline();
            return { result, source: 'offline' };
        } catch (e) {
            errors.push({ layer: 'offline', error: e });
        }
    }

    // Todas as camadas falharam
    const msg = errors.map(e => `[${e.layer}] ${e.error.message}`).join(' | ');
    throw new Error(`Todas as camadas falharam: ${msg}`);
}


// ────────────────────────────────────────────
// Sincronização de Estado
// ────────────────────────────────────────────

/**
 * Sincroniza o estado completo com o backend disponível.
 * Usa fallback: Supabase → API local → localStorage.
 * 
 * @param {object} options - Opções
 * @param {boolean} options.useSupabase - Se Supabase está habilitado
 * @param {Function} [options.getSupabaseState] - Função para buscar estado do Supabase
 * @param {string} options.apiBase - Base URL da API local
 * @param {Function} [options.onUnauthorized] - Callback de logout
 * @returns {Promise<{state: object, source: string}>}
 */
export async function syncState(options) {
    return executeWithFallback({
        supabase: options.getSupabaseState,
        api: async () => {
            const res = await authFetch(
                `${options.apiBase}/api/state`,
                {},
                options.onUnauthorized
            );
            if (!res.ok) throw new Error(`API retornou ${res.status}`);
            return await res.json();
        },
        offline: () => {
            const state = loadLocalState();
            if (!state) throw new Error('Sem dados locais');
            return state;
        }
    }, { useSupabase: options.useSupabase });
}
