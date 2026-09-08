/**
 * Panobianco PDV & ERP — Entry Point (Modular)
 * 
 * IMPORTANTE: Este arquivo é o ponto de entrada da arquitetura modular.
 * Neste momento (Fase 1), ele apenas exporta os utilitários base.
 * O app.js monolítico original continua sendo o arquivo ativo em produção.
 * 
 * A migração ocorrerá de forma incremental nas Fases 3-8:
 * - Fase 3: modules/auth.js
 * - Fase 4: modules/cart.js + modules/sales.js
 * - Fase 5: modules/shifts.js + modules/reports.js
 * - Fase 6: modules/products.js + modules/inventory.js + modules/users.js
 * - Fase 7: modules/audit.js + modules/dashboard.js
 * - Fase 8: Eliminação do app.js monolítico
 * 
 * @module main
 */

// ── Core: utilitários e constantes ──────────
export {
    escapeHtml,
    sanitizeCsvField,
    formatCurrency,
    formatDateTime,
    formatTime,
    formatShortDateTime,
    debounce,
    generateLocalId,
    normalizeString,
    truncate
} from './core/helpers.js';

export {
    ROLES,
    ROLE_LABELS,
    ROLE_AVATARS,
    SALE_STATUS,
    SHIFT_STATUS,
    PAYMENT_METHODS,
    PAYMENT_LABELS,
    CATEGORIES,
    CATEGORY_LABELS,
    CATEGORY_GROUPS,
    getCategoryLabel,
    DEFAULT_TENANT_ID,
    POLLING_INTERVAL_MS,
    CASH_DIFF_TOLERANCE,
    PHOTO_MAX_SIZE,
    APP_VERSION
} from './core/constants.js';

// ── Módulos de Domínio (Fase 3+) ────────────
export {
    configureAuth,
    getCurrentUser,
    getAuthToken,
    isAdmin,
    isAuthenticated,
    showLoginModal,
    handleEmployeeLogin,
    logout,
    clearSession,
    restoreSession,
    applyLoginUI
} from './modules/auth.js';

export {
    navigate
} from './modules/navigation.js';

export {
    getCart,
    getSelectedPaymentMethod,
    getCartTotal,
    getCartCost,
    getCartQty,
    filterCategory,
    searchProducts,
    getFilteredProducts,
    renderProductsGrid,
    addToCart,
    updateCartQty,
    clearCart,
    resetCart,
    renderCart,
    selectPaymentMethod,
    calculateChange
} from './modules/cart.js';

export {
    getLastSaleId,
    setLastSaleId,
    finalizeSale,
    showSuccessModal,
    closeSuccessModal,
    cancelLastSale
} from './modules/sales.js';

// export * from './modules/shifts.js';
// export * from './modules/products.js';
// export * from './modules/inventory.js';
// export * from './modules/users.js';
// export * from './modules/audit.js';
// export * from './modules/dashboard.js';
// export * from './modules/reports.js';

// ── Serviços (Fase 2) ───────────────────────
export {
    initSupabase,
    getClient,
    getClientOrNull,
    isConnected,
    getConfig,
    getTenantId,
    testConnection,
    destroyClient
} from './services/supabase-client.js';

export {
    getFullState,
    processSale,
    cancelSale,
    upsertProduct,
    deleteProduct,
    restockProduct,
    closeShift,
    upsertUser,
    deleteUser,
    insertAuditLog,
    getAuditLogs
} from './services/data-service.js';

export {
    subscribe as subscribeRealtime,
    unsubscribe as unsubscribeRealtime,
    isSubscribed
} from './services/realtime.js';

export {
    uploadProductPhoto,
    removeProductPhoto
} from './services/storage.js';

export {
    loadLocalState,
    saveLocalState,
    getApiBase,
    authFetch,
    executeWithFallback,
    syncState
} from './services/sync.js';
