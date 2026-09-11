/**
 * Panobianco PDV & ERP — Orquestrador Principal (v3.3.0)
 * 
 * Substituição do app.js monolítico (~2889 linhas) por este orquestrador leve.
 * Importa todos os módulos, configura-os e expõe a API pública em window.app.
 * 
 * @module core/app
 */

// ── Core ────────────────────────────────────
import { escapeHtml } from './helpers.js';
import { ROLES, ROLE_LABELS, ROLE_AVATARS, APP_VERSION } from './constants.js';

// ── Módulos (Fases 3-7) ─────────────────────
import {
    configureAuth, getCurrentUser, getAuthToken, isAdmin, isAuthenticated,
    showLoginModal, handleEmployeeLogin, logout, clearSession,
    restoreSession, applyLoginUI
} from '../modules/auth.js';

import { navigate } from '../modules/navigation.js';

import {
    getCart, getSelectedPaymentMethod, getCartTotal, getCartCost, getCartQty,
    filterCategory, searchProducts, getFilteredProducts, renderProductsGrid,
    addToCart, updateCartQty, clearCart, resetCart, renderCart,
    selectPaymentMethod, calculateChange
} from '../modules/cart.js';

import {
    getLastSaleId, setLastSaleId, finalizeSale,
    showSuccessModal, closeSuccessModal, cancelLastSale
} from '../modules/sales.js';

import {
    configureShifts, setSlipsViewScope, toggleSlipsOrder, filterShiftSlips,
    toggleSlipsExpand, renderShiftModule, reconcileShift, renderShiftHistory,
    openShiftDetailsModal, renderShiftModalSalesTable, filterShiftModalSales,
    closeShiftDetailsModal, printCurrentModalShift, exportCurrentModalShiftCSV
} from '../modules/shifts.js';

import { configureReports, renderEvoPrintSheet, printCashReport } from '../modules/reports.js';

import {
    configureProducts, openQuickPhotoModal, closeQuickPhotoModal,
    previewQuickPhoto, saveQuickPhoto, removeQuickPhoto, compressImage,
    openNewProductModal, editProduct, previewProductPhoto,
    removeProductPhotoFromModal, saveProduct, confirmDeleteProduct,
    deleteCurrentEditingProduct, deleteProductById,
    openDuplicatesModal, closeDuplicatesModal, renderDuplicatesList,
    deleteDuplicateItem, mergeDuplicateItem, closeProductModal
} from '../modules/products.js';

import {
    configureInventory, filterStockTable, detectDuplicateProducts,
    renderStockTable, openRestockModal, confirmRestock, closeRestockModal
} from '../modules/inventory.js';

import {
    configureUsers, renderUsersTable, openNewUserModal, editUser,
    saveUser, deleteUser, closeUserModal
} from '../modules/users.js';

import {
    configureAudit, renderAuditLogs, filterAudit,
    openCancelModal, closeCancelModal, confirmCancelSale,
    exportAuditLogs, switchAuditTab, loadAuditEvents,
    filterAuditEvents, renderAuditEvents, formatActionLabel, getActionBadge
} from '../modules/audit.js';

import { configureDashboard, renderDashboard, setDashEl } from '../modules/dashboard.js';


// ════════════════════════════════════════════
// Estado Global da Aplicação
// ════════════════════════════════════════════

const STORAGE_KEY = 'panobianco_pos_erp_v5';
const API_BASE = window.location.origin.includes('http') ? window.location.origin : 'http://localhost:3000';

let state = loadLocalState();
let currentUser = null;
let authToken = sessionStorage.getItem('panobianco_token') || null;
let useSupabase = false;
let isOnline = true;
let syncInterval = null;


// ════════════════════════════════════════════
// Funções de Infraestrutura (não modularizadas)
// ════════════════════════════════════════════

function loadLocalState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
    }
    return getDefaultSeedData();
}

function saveLocalState(data) {
    state = data;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getDefaultSeedData() {
    return {
        saleCounter: 0,
        users: [
            { id: 'f20729', code: 'f20729', name: 'Luan', role: 'ADMIN', title: 'Auxiliar Administrativo / Gestor', avatar: '💼' },
            { id: 'f30188', code: 'f30188', name: 'Letícia Santos', role: 'OPERADOR', title: 'Recepção / Balcão', avatar: '👩‍💼' },
            { id: 'f00101', code: 'f00101', name: 'Gerente Geral', role: 'ADMIN', title: 'Gerente de Unidade', avatar: '👑' },
            { id: 'f10452', code: 'f10452', name: 'Marcos Oliveira', role: 'OPERADOR', title: 'Recepção Manhã', avatar: '👤' }
        ],
        products: [],
        sales: [],
        shifts: [],
        activeShift: {
            id: 'shift_init',
            shiftCode: 'T01',
            operatorId: 'f20729',
            operatorName: 'Luan [F20729]',
            startTime: new Date().toISOString(),
            sales: [],
            status: 'OPEN'
        }
    };
}

async function authFetch(url, options = {}) {
    if (!options.headers) options.headers = {};
    if (authToken) {
        options.headers['Authorization'] = `Bearer ${authToken}`;
    }
    options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';

    const res = await fetch(url, options);

    if (res.status === 401) {
        clearSessionLocal();
        showLoginModal();
        throw new Error('Sessão expirada. Faça login novamente.');
    }

    if (res.status === 403) {
        const data = await res.json();
        alert(`🔒 ${data.error || 'Acesso restrito a gestores (ADMIN).'}`);
        throw new Error('Sem permissão');
    }

    return res;
}

function clearSessionLocal() {
    authToken = null;
    currentUser = null;
    sessionStorage.removeItem('panobianco_token');
    sessionStorage.removeItem('panobianco_user');
}

function updateSyncBadge(online, isSupabaseMode = useSupabase) {
    const badge = document.getElementById('sync-status-badge');
    if (!badge) return;
    badge.style.cursor = 'default';
    badge.removeAttribute('onclick');

    if (isSupabaseMode) {
        if (online) {
            badge.innerHTML = '🟢 Nuvem Conectada (Realtime)';
            badge.className = 'sync-badge online';
            badge.title = 'Conexão Segura em Nuvem Ativa (Realtime)';
        } else {
            badge.innerHTML = '🟡 Reconectando Nuvem...';
            badge.className = 'sync-badge offline';
            badge.title = 'Tentando restabelecer conexão com a nuvem.';
        }
    } else {
        if (online) {
            badge.innerHTML = '🟢 Conexão Local Ativa';
            badge.className = 'sync-badge online';
            badge.title = 'Conectado ao servidor local';
        } else {
            badge.innerHTML = '🟡 Modo Offline';
            badge.className = 'sync-badge offline';
            badge.title = 'Operando localmente';
        }
    }
}

async function syncWithSupabase(showFeedback = true) {
    try {
        const cloudState = await window.supabaseAdapter.getFullState();
        state = cloudState;
        saveLocalState(cloudState);
        isOnline = true;
        updateSyncBadge(true, true);
        renderAll();
        return true;
    } catch (e) {
        console.warn('⚠️ Falha ao sincronizar com Supabase Cloud:', e);
        isOnline = false;
        updateSyncBadge(false, true);
        return false;
    }
}

function handleRealtimeUpdate(type, payload) {
    console.log(`⚡ [Realtime Push Recebido: ${type}] Atualizando tela instantaneamente...`);
    syncWithSupabase(false);
}

function startPolling() {
    if (syncInterval) clearInterval(syncInterval);
    if (useSupabase) return;
    syncInterval = setInterval(() => {
        syncWithServer(false);
    }, 2500);
}

async function syncWithServer(showFeedback = true) {
    if (useSupabase) return syncWithSupabase(showFeedback);
    try {
        const headers = { 'Cache-Control': 'no-store' };
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }
        const res = await fetch(`${API_BASE}/api/state`, { headers });
        if (res.status === 401) {
            clearSessionLocal();
            showLoginModal();
            return false;
        }
        if (res.ok) {
            const serverState = await res.json();
            state = serverState;
            saveLocalState(serverState);
            isOnline = true;
            updateSyncBadge(true, false);
            renderAll();
            return true;
        } else {
            throw new Error('Servidor indisponível');
        }
    } catch (e) {
        isOnline = false;
        updateSyncBadge(false, false);
        if (showFeedback) console.warn('Modo Offline: Operando com dados locais.');
        return false;
    }
}


// ════════════════════════════════════════════
// renderAll & Alertas de Estoque
// ════════════════════════════════════════════

function renderAll() {
    renderProductsGrid(state.products || [], state.saleCounter || 0, (productId) => addToCart(productId, state.products || []));
    renderStockTable();
    renderShiftModule();
    renderAuditLogs();
    renderUsersTable();
    renderDashboard();
    updateStockAlerts();
}

function updateStockAlerts() {
    const banner = document.getElementById('stock-alert-banner');
    if (!banner) return;

    const products = state.products || [];
    const outOfStock = products.filter(p => p.stock <= 0);
    const critical = products.filter(p => p.stock > 0 && p.stock <= p.minStock);

    if (outOfStock.length === 0 && critical.length === 0) {
        banner.style.display = 'none';
        return;
    }

    banner.style.display = 'flex';
    const titleEl = document.getElementById('stock-alert-title');
    const detailEl = document.getElementById('stock-alert-detail');

    const parts = [];
    if (outOfStock.length > 0) {
        const names = outOfStock.slice(0, 3).map(p => p.name).join(', ');
        const extra = outOfStock.length > 3 ? ` e mais ${outOfStock.length - 3}` : '';
        parts.push(`🔴 ${outOfStock.length} esgotado(s): ${names}${extra}`);
    }
    if (critical.length > 0) {
        const names = critical.slice(0, 3).map(p => `${p.name} (${p.stock}un)`).join(', ');
        const extra = critical.length > 3 ? ` e mais ${critical.length - 3}` : '';
        parts.push(`🟡 ${critical.length} crítico(s): ${names}${extra}`);
    }

    if (titleEl) {
        titleEl.textContent = outOfStock.length > 0 ? '⚠️ Atenção: Produtos Esgotados!' : '⚠️ Estoque Crítico';
        titleEl.style.color = outOfStock.length > 0 ? '#dc2626' : '#d97706';
    }
    if (detailEl) detailEl.textContent = parts.join(' | ');
}

function backupDatabase() {
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Backup_Panobianco_PDV_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
}


// ════════════════════════════════════════════
// Login Flow (ponte entre orquestrador e módulos)
// ════════════════════════════════════════════

function onLoginSuccess(user) {
    currentUser = user;
    document.getElementById('login-modal').classList.remove('active');

    document.getElementById('current-user-avatar').innerText = user.avatar || (user.role === ROLES.ADMIN ? '💼' : '👤');
    document.getElementById('current-user-name').innerText = `${escapeHtml(user.name)} [${escapeHtml(user.code.toUpperCase())}]`;
    document.getElementById('current-user-role').innerText = user.title || (user.role === ROLES.ADMIN ? 'Gestor Master' : 'Operador de Caixa');

    const tag = document.getElementById('cart-operator-tag');
    if (tag) tag.innerText = `Operador: ${user.name} [${user.code.toUpperCase()}]`;

    const userIsAdmin = user.role === ROLES.ADMIN;
    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = userIsAdmin ? '' : 'none';
    });

    const stockDesc = document.getElementById('stock-view-desc');
    if (stockDesc) {
        stockDesc.innerText = userIsAdmin
            ? 'Acompanhamento de saldos, custos, margens e cadastro de fotos'
            : 'Consulta rápida de preços, estoque e fotos dos produtos no balcão';
    }

    navigate('pdv');

    if (typeof Sentry !== 'undefined') {
        Sentry.setUser({
            id: user.id || user.code,
            username: `${user.name} [${(user.code || '').toUpperCase()}]`,
            role: user.role
        });
    }
}

async function handleLogin() {
    const codeInput = document.getElementById('login-employee-code').value.trim().toLowerCase();
    const errorEl = document.getElementById('login-error');

    if (!codeInput) {
        errorEl.innerText = '⚠️ Digite seu código de funcionário para entrar.';
        errorEl.style.display = 'block';
        return;
    }

    if (useSupabase) {
        const user = (state.users || []).find(u => u.code.toLowerCase() === codeInput);
        if (user && user.active !== false) {
            sessionStorage.setItem('panobianco_user', JSON.stringify(user));
            onLoginSuccess(user);
            await syncWithSupabase(false);
            return;
        } else {
            errorEl.innerText = '❌ Código de colaborador não encontrado no sistema!';
            errorEl.style.display = 'block';
            return;
        }
    }

    try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: codeInput })
        });

        if (res.ok) {
            const data = await res.json();
            authToken = data.token;
            sessionStorage.setItem('panobianco_token', data.token);
            sessionStorage.setItem('panobianco_user', JSON.stringify(data.user));
            onLoginSuccess(data.user);
            startPolling();
            await syncWithServer(false);
            return;
        } else {
            const errData = await res.json();
            throw new Error(errData.error || 'Código não encontrado.');
        }
    } catch (e) {
        // Fallback offline
        const localUser = (state.users || []).find(u => u.code.toLowerCase() === codeInput);
        if (localUser) {
            onLoginSuccess(localUser);
            startPolling();
            return;
        }
        errorEl.innerText = `❌ ${e.message || 'Código não cadastrado no sistema!'}`;
        errorEl.style.display = 'block';
    }
}

async function handleLogout() {
    if (typeof Sentry !== 'undefined') {
        Sentry.setUser(null);
    }
    if (authToken) {
        try {
            await fetch(`${API_BASE}/api/auth/logout`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
        } catch (e) { /* ignorar erros de rede no logout */ }
    }
    if (syncInterval) clearInterval(syncInterval);
    clearSessionLocal();
    clearCart();
    showLoginModal();
}


// ════════════════════════════════════════════
// Supabase Config Modal (Admin Only)
// ════════════════════════════════════════════

function openSupabaseModal() {
    if (!currentUser || currentUser.role !== ROLES.ADMIN) return;

    const urlInput = document.getElementById('cfg-supabase-url');
    const keyInput = document.getElementById('cfg-supabase-key');
    const resEl = document.getElementById('supabase-test-result');

    if (urlInput) urlInput.value = 'https://jawrukqnncnjgzixjaqy.supabase.co';
    if (keyInput) {
        keyInput.value = '';
        keyInput.placeholder = '•••••••••••••••••••••••••••••••• (Configurada e Segura)';
    }
    if (resEl) resEl.style.display = 'none';

    document.getElementById('supabase-config-modal').classList.add('active');
}

function closeSupabaseModal() {
    document.getElementById('supabase-config-modal').classList.remove('active');
}

async function testSupabaseConnection() {
    if (!currentUser || currentUser.role !== ROLES.ADMIN) return;
    const url = document.getElementById('cfg-supabase-url').value.trim();
    const key = document.getElementById('cfg-supabase-key').value.trim() || window.SUPABASE_CONFIG.anonKey;
    const resEl = document.getElementById('supabase-test-result');
    if (!resEl) return;

    resEl.innerHTML = '<span style="color:#3b82f6;">⏳ Testando conexão com o Supabase Cloud...</span>';
    resEl.style.display = 'block';

    try {
        const testClient = window.supabase.createClient(url.includes('••••') ? window.SUPABASE_CONFIG.url : url, key);
        const { data, error } = await testClient.from('tenants').select('id, name').limit(1);
        if (error) throw error;
        resEl.innerHTML = '<span style="color:#16a34a; font-weight:bold;">✅ Conexão bem-sucedida! PostgreSQL e Realtime ativos.</span>';
    } catch (err) {
        resEl.innerHTML = `<span style="color:#ef4444;">❌ Falha na conexão: ${escapeHtml(err.message || err)}</span>`;
    }
}

async function saveSupabaseConfig() {
    if (!currentUser || currentUser.role !== ROLES.ADMIN) return;
    let url = document.getElementById('cfg-supabase-url').value.trim();
    let key = document.getElementById('cfg-supabase-key').value.trim();

    if (url.includes('••••') || !url) url = window.SUPABASE_CONFIG.url;
    if (!key) key = window.SUPABASE_CONFIG.anonKey;

    localStorage.setItem('panobianco_supabase_url', url);
    localStorage.setItem('panobianco_supabase_key', key);

    window.SUPABASE_CONFIG.url = url;
    window.SUPABASE_CONFIG.anonKey = key;

    if (window.supabaseAdapter.init(window.SUPABASE_CONFIG)) {
        useSupabase = true;
        await syncWithSupabase(true);
        window.supabaseAdapter.subscribeRealtime((type, payload) => handleRealtimeUpdate(type, payload));
        updateSyncBadge(true, true);
        alert('🎉 Supabase Cloud conectado com sucesso!');
        closeSupabaseModal();
    } else {
        alert('❌ Erro ao inicializar o Supabase com as credenciais informadas.');
    }
}


// ════════════════════════════════════════════
// Configuração dos Módulos
// ════════════════════════════════════════════

const sharedConfig = {
    getState: () => state,
    getCurrentUser: () => currentUser,
    getUseSupabase: () => useSupabase,
    syncWithSupabase,
    renderAll,
    saveLocalState,
    getApiBase: () => API_BASE,
    authFetch
};

configureShifts({
    ...sharedConfig,
    printCashReport
});

configureReports({
    getState: () => state,
    getCurrentUser: () => currentUser
});

configureProducts(sharedConfig);
configureInventory(sharedConfig);
configureUsers(sharedConfig);
configureAudit(sharedConfig);
configureDashboard({ getState: () => state });


// ════════════════════════════════════════════
// API Pública (window.app) para onclick do HTML
// ════════════════════════════════════════════

window.app = {
    // Auth & Navigation
    handleEmployeeLogin: handleLogin,
    logout: handleLogout,
    navigate: (viewId) => { navigate(viewId); renderAll(); },

    // PDV / Carrinho
    filterCategory: (cat) => filterCategory(cat, renderAll),
    searchProducts: (query) => searchProducts(query, renderAll),
    addToCart: (productId) => { addToCart(productId, state.products || []); renderAll(); },
    updateCartQty: (productId, delta) => { updateCartQty(productId, delta, state.products || []); renderAll(); },
    clearCart: () => { clearCart(); renderAll(); },
    selectPaymentMethod,
    calculateChange,
    finalizeSale: () => finalizeSale({
        getState: () => state,
        getCurrentUser: () => currentUser,
        getUseSupabase: () => useSupabase,
        syncWithSupabase,
        renderAll,
        saveLocalState,
        getApiBase: () => API_BASE,
        authFetch
    }),

    // Vendas
    showSuccessModal,
    closeSuccessModal,
    cancelLastSale: () => cancelLastSale({
        getState: () => state,
        getCurrentUser: () => currentUser,
        getUseSupabase: () => useSupabase,
        syncWithSupabase,
        renderAll,
        getApiBase: () => API_BASE,
        authFetch
    }),

    // Turnos & Conferência
    setSlipsViewScope,
    toggleSlipsOrder,
    filterShiftSlips,
    toggleSlipsExpand,
    reconcileShift,
    openShiftDetailsModal,
    filterShiftModalSales,
    closeShiftDetailsModal,
    printCurrentModalShift,
    exportCurrentModalShiftCSV,
    printCashReport,

    // Produtos & Estoque
    openNewProductModal,
    editProduct,
    previewProductPhoto,
    removeProductPhotoFromModal,
    saveProduct,
    confirmDeleteProduct,
    deleteCurrentEditingProduct,
    closeProductModal,
    openQuickPhotoModal,
    closeQuickPhotoModal,
    previewQuickPhoto,
    saveQuickPhoto,
    removeQuickPhoto,
    openDuplicatesModal,
    closeDuplicatesModal,
    filterStockTable,
    openRestockModal,
    confirmRestock,
    closeRestockModal,

    // Usuários
    openNewUserModal,
    editUser,
    saveUser,
    deleteUser,
    closeUserModal,

    // Auditoria
    filterAudit,
    openCancelModal,
    closeCancelModal,
    confirmCancelSale,
    exportAuditLogs,
    switchAuditTab,
    filterAuditEvents,

    // Dashboard & Admin
    backupDatabase,
    openSupabaseModal,
    closeSupabaseModal,
    testSupabaseConnection,
    saveSupabaseConfig
};


// ════════════════════════════════════════════
// Inicialização
// ════════════════════════════════════════════

async function init() {
    // 1. Tentar conectar ao Supabase Cloud (se configurado)
    if (typeof window.supabaseAdapter !== 'undefined' && window.supabaseAdapter.init()) {
        useSupabase = true;
        console.log('⚡ Modo Supabase Cloud Realtime Ativado.');
        await syncWithSupabase(false);
        window.supabaseAdapter.subscribeRealtime((type, payload) => handleRealtimeUpdate(type, payload));
        updateSyncBadge(true, true);
    } else {
        useSupabase = false;
    }

    // 2. Tentar recuperar sessão existente
    const savedUser = sessionStorage.getItem('panobianco_user');
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            onLoginSuccess(user);
            renderAll();
            if (!useSupabase) startPolling();
            return;
        } catch (e) { /* fallthrough para login */ }
    }

    if (authToken && !useSupabase) {
        const ok = await syncWithServer(false);
        if (ok && savedUser) {
            const user = JSON.parse(savedUser);
            onLoginSuccess(user);
            renderAll();
            startPolling();
            return;
        }
        clearSessionLocal();
    }

    showLoginModal();
    renderAll();
}

// Iniciar a aplicação
init();
