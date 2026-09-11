/**
 * Panobianco PDV & ERP — Módulo de Autenticação
 * 
 * Gerencia todo o ciclo de vida da sessão do operador:
 * - Login por código funcional (6 caracteres)
 * - Sessão via sessionStorage (browser) + token JWT (API local)
 * - RBAC visual (.admin-only) e programático (isAdmin)
 * - Logout com invalidação de token
 * 
 * Extraído de PanobiancoApp: handleEmployeeLogin, onLoginSuccess, 
 * logout, clearSession, showLoginModal (app.js L231-L344)
 * 
 * @module modules/auth
 */

import { ROLES, ROLE_LABELS, ROLE_AVATARS } from '../core/constants.js';
import { escapeHtml } from '../core/helpers.js';

// ────────────────────────────────────────────
// Estado interno do módulo
// ────────────────────────────────────────────

const SESSION_USER_KEY = 'panobianco_user';
const SESSION_TOKEN_KEY = 'panobianco_token';

/** @type {object|null} Usuário logado atualmente */
let _currentUser = null;

/** @type {string|null} Token JWT para API local */
let _authToken = sessionStorage.getItem(SESSION_TOKEN_KEY) || null;

/** @type {Function|null} Callback chamado após login bem-sucedido */
let _onLoginCallback = null;

/** @type {Function|null} Callback chamado após logout */
let _onLogoutCallback = null;


// ────────────────────────────────────────────
// Configuração
// ────────────────────────────────────────────

/**
 * Configura callbacks do módulo de auth.
 * Deve ser chamado uma vez durante a inicialização do app.
 * 
 * @param {object} options
 * @param {Function} options.onLogin - Callback pós-login (recebe user)
 * @param {Function} options.onLogout - Callback pós-logout
 */
export function configureAuth(options = {}) {
    _onLoginCallback = options.onLogin || null;
    _onLogoutCallback = options.onLogout || null;
}


// ────────────────────────────────────────────
// Estado público (getters)
// ────────────────────────────────────────────

/**
 * Retorna o usuário logado atualmente.
 * @returns {object|null}
 */
export function getCurrentUser() {
    return _currentUser;
}

/**
 * Retorna o token de autenticação atual.
 * @returns {string|null}
 */
export function getAuthToken() {
    return _authToken;
}

/**
 * Verifica se o usuário atual é admin.
 * @returns {boolean}
 */
export function isAdmin() {
    return _currentUser?.role === ROLES.ADMIN;
}

/**
 * Verifica se há uma sessão ativa.
 * @returns {boolean}
 */
export function isAuthenticated() {
    return _currentUser !== null;
}


// ────────────────────────────────────────────
// Login Modal
// ────────────────────────────────────────────

/**
 * Exibe o modal de login e limpa o campo de código.
 * Reproduz showLoginModal() do app.js (L232-L241).
 */
export function showLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) modal.classList.add('active');

    const codeInput = document.getElementById('login-employee-code');
    if (codeInput) {
        codeInput.value = '';
        codeInput.focus();
    }

    const err = document.getElementById('login-error');
    if (err) err.style.display = 'none';
}

/**
 * Esconde o modal de login.
 */
function hideLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) modal.classList.remove('active');
}


// ────────────────────────────────────────────
// Login
// ────────────────────────────────────────────

/**
 * Processa o login de um colaborador por código funcional.
 * Reproduz handleEmployeeLogin() do app.js (L243-L303) com fallback de 3 camadas.
 * 
 * @param {object} context - Contexto do app necessário para o login
 * @param {boolean} context.useSupabase - Se Supabase está habilitado
 * @param {Array} context.users - Lista de usuários do estado atual
 * @param {string} context.apiBase - Base URL da API local
 * @param {Function} [context.onSyncSupabase] - Callback para sync após login Supabase
 * @param {Function} [context.onStartPolling] - Callback para iniciar polling após login API
 * @param {Function} [context.onSyncServer] - Callback para sync após login API
 */
export async function handleEmployeeLogin(context) {
    const codeInput = document.getElementById('login-employee-code');
    const errorEl = document.getElementById('login-error');
    const code = (codeInput?.value || '').trim().toLowerCase();

    if (!code) {
        if (errorEl) {
            errorEl.innerText = '⚠️ Digite seu código de funcionário para entrar.';
            errorEl.style.display = 'block';
        }
        return;
    }

    // Camada 1: Supabase (sem API, apenas busca no estado local já sincronizado)
    if (context.useSupabase) {
        const user = (context.users || []).find(u => u.code.toLowerCase() === code);
        if (user && user.active !== false) {
            _setSession(user, null);
            applyLoginUI(user);
            if (context.onSyncSupabase) await context.onSyncSupabase();
            return;
        } else {
            if (errorEl) {
                errorEl.innerText = '❌ Código de colaborador não encontrado no sistema!';
                errorEl.style.display = 'block';
            }
            return;
        }
    }

    // Camada 2: API local (autenticação com token)
    try {
        const res = await fetch(`${context.apiBase}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });

        if (res.ok) {
            const data = await res.json();
            _setSession(data.user, data.token);
            applyLoginUI(data.user);
            if (context.onStartPolling) context.onStartPolling();
            if (context.onSyncServer) await context.onSyncServer();
            return;
        } else {
            const errData = await res.json();
            throw new Error(errData.error || 'Código não encontrado.');
        }
    } catch (e) {
        // Camada 3: Fallback offline (busca no estado local)
        const localUser = (context.users || []).find(u => u.code.toLowerCase() === code);
        if (localUser) {
            _setSession(localUser, null);
            applyLoginUI(localUser);
            if (context.onStartPolling) context.onStartPolling();
            return;
        }

        if (errorEl) {
            errorEl.innerText = `❌ ${e.message || 'Código não cadastrado no sistema!'}`;
            errorEl.style.display = 'block';
        }
    }
}


// ────────────────────────────────────────────
// Logout
// ────────────────────────────────────────────

/**
 * Faz logout do operador atual.
 * Reproduz logout() do app.js (L330-L344).
 * 
 * @param {object} [context] - Contexto opcional
 * @param {string} [context.apiBase] - Base URL da API local
 * @param {number} [context.syncInterval] - ID do interval para limpar
 */
export async function logout(context = {}) {
    // Invalidar token no servidor
    if (_authToken) {
        try {
            await fetch(`${context.apiBase || 'http://localhost:3000'}/api/auth/logout`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${_authToken}` }
            });
        } catch (e) { /* ignorar erros de rede no logout */ }
    }

    // Limpar interval de polling
    if (context.syncInterval) {
        clearInterval(context.syncInterval);
    }

    // Limpar sessão
    clearSession();

    // Mostrar modal de login
    showLoginModal();

    // Notificar o app
    if (_onLogoutCallback) _onLogoutCallback();
}


// ────────────────────────────────────────────
// Sessão
// ────────────────────────────────────────────

/**
 * Limpa a sessão atual.
 * Reproduz clearSession() do app.js (L127-L132).
 */
export function clearSession() {
    _currentUser = null;
    _authToken = null;
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_USER_KEY);
}

/**
 * Restaura a sessão a partir do sessionStorage (se existir).
 * Usado durante a inicialização para recuperar sessões ativas.
 * 
 * @returns {object|null} Usuário restaurado ou null
 */
export function restoreSession() {
    const saved = sessionStorage.getItem(SESSION_USER_KEY);
    if (!saved) return null;

    try {
        const user = JSON.parse(saved);
        _currentUser = user;
        _authToken = sessionStorage.getItem(SESSION_TOKEN_KEY) || null;
        return user;
    } catch {
        clearSession();
        return null;
    }
}


// ────────────────────────────────────────────
// UI de Login (RBAC visual)
// ────────────────────────────────────────────

/**
 * Aplica as alterações de UI pós-login.
 * Reproduz onLoginSuccess() do app.js (L305-L328).
 * 
 * @param {object} user - Usuário que fez login
 */
export function applyLoginUI(user) {
    // Fechar modal
    hideLoginModal();

    // Header do usuário
    const avatarEl = document.getElementById('current-user-avatar');
    const nameEl = document.getElementById('current-user-name');
    const roleEl = document.getElementById('current-user-role');

    if (avatarEl) avatarEl.innerText = user.avatar || ROLE_AVATARS[user.role] || '👤';
    if (nameEl) nameEl.innerText = `${escapeHtml(user.name)} [${user.code.toUpperCase()}]`;
    if (roleEl) roleEl.innerText = user.title || ROLE_LABELS[user.role] || 'Operador';

    // Tag do operador no carrinho
    const tag = document.getElementById('cart-operator-tag');
    if (tag) tag.innerText = `Operador: ${escapeHtml(user.name)} [${user.code.toUpperCase()}]`;

    // RBAC visual: mostrar/esconder elementos admin-only
    const userIsAdmin = user.role === ROLES.ADMIN;
    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = userIsAdmin ? '' : 'none';
    });

    // Descrição contextual do estoque
    const stockDesc = document.getElementById('stock-view-desc');
    if (stockDesc) {
        stockDesc.innerText = userIsAdmin
            ? 'Acompanhamento de saldos, custos, margens e cadastro de fotos'
            : 'Consulta rápida de preços, estoque e fotos dos produtos no balcão';
    }

    // Notificar o app
    if (_onLoginCallback) _onLoginCallback(user);
}


// ────────────────────────────────────────────
// Helpers internos
// ────────────────────────────────────────────

/**
 * Salva os dados da sessão internamente e no sessionStorage.
 * @param {object} user - Usuário autenticado
 * @param {string|null} token - Token JWT (null para Supabase/offline)
 */
function _setSession(user, token) {
    _currentUser = user;
    _authToken = token;
    sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
    if (token) {
        sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    }
}
