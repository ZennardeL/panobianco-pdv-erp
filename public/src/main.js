/**
 * Panobianco PDV & ERP — Entry Point (Modular)
 * 
 * IMPORTANTE: Este arquivo é o ponto de entrada da arquitetura modular.
 * Exporta todos os módulos extraídos das Fases 1-7.
 * O app.js monolítico original continua ativo em produção.
 * 
 * Fases concluídas:
 * - Fase 1: core/helpers.js + core/constants.js
 * - Fase 2: services/ (supabase-client, data-service, sync, realtime, storage)
 * - Fase 3: modules/auth.js + modules/navigation.js
 * - Fase 4: modules/cart.js + modules/sales.js
 * - Fase 5: modules/shifts.js + modules/reports.js
 * - Fase 6: modules/products.js + modules/inventory.js + modules/users.js
 * - Fase 7: modules/audit.js + modules/dashboard.js
 * - Fase 8: Eliminação do app.js monolítico (pendente)
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

// ── Módulos de Domínio (Fase 5) ────────────
export {
    configureShifts,
    setSlipsViewScope,
    toggleSlipsOrder,
    filterShiftSlips,
    toggleSlipsExpand,
    renderShiftModule,
    reconcileShift,
    renderShiftHistory,
    openShiftDetailsModal,
    renderShiftModalSalesTable,
    filterShiftModalSales,
    closeShiftDetailsModal,
    printCurrentModalShift,
    exportCurrentModalShiftCSV
} from './modules/shifts.js';

export {
    configureReports,
    renderEvoPrintSheet,
    printCashReport
} from './modules/reports.js';

// ── Módulos de Domínio (Fase 6) ────────────
export {
    configureProducts,
    openQuickPhotoModal,
    closeQuickPhotoModal,
    previewQuickPhoto,
    saveQuickPhoto,
    removeQuickPhoto,
    compressImage,
    openNewProductModal,
    editProduct,
    previewProductPhoto,
    removeProductPhotoFromModal,
    saveProduct,
    confirmDeleteProduct,
    deleteCurrentEditingProduct,
    deleteProductById,
    openDuplicatesModal,
    closeDuplicatesModal,
    renderDuplicatesList,
    deleteDuplicateItem,
    mergeDuplicateItem,
    closeProductModal
} from './modules/products.js';

export {
    configureInventory,
    filterStockTable,
    detectDuplicateProducts,
    renderStockTable,
    openRestockModal,
    confirmRestock,
    closeRestockModal
} from './modules/inventory.js';

export {
    configureUsers,
    renderUsersTable,
    openNewUserModal,
    editUser,
    saveUser,
    deleteUser,
    closeUserModal
} from './modules/users.js';

// ── Módulos de Domínio (Fase 7) ────────────
export {
    configureAudit,
    renderAuditLogs,
    filterAudit,
    openCancelModal,
    closeCancelModal,
    confirmCancelSale,
    exportAuditLogs,
    switchAuditTab,
    loadAuditEvents,
    filterAuditEvents,
    renderAuditEvents,
    formatActionLabel,
    getActionBadge
} from './modules/audit.js';

export {
    configureDashboard,
    renderDashboard,
    setDashEl
} from './modules/dashboard.js';

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
