/**
 * Panobianco PDV & ERP — Constantes do Sistema
 * 
 * Valores enumerados, categorias, labels e configurações estáticas.
 * Centraliza strings mágicas que estavam espalhadas pelo app.js monolítico.
 * 
 * @module core/constants
 */

// ────────────────────────────────────────────
// Roles & Permissões
// ────────────────────────────────────────────

/** Roles de usuário disponíveis no sistema */
export const ROLES = Object.freeze({
    ADMIN: 'ADMIN',
    OPERADOR: 'OPERADOR'
});

/** Labels amigáveis para roles */
export const ROLE_LABELS = Object.freeze({
    [ROLES.ADMIN]: 'Gestor Master',
    [ROLES.OPERADOR]: 'Operador de Caixa'
});

/** Avatares padrão por role */
export const ROLE_AVATARS = Object.freeze({
    [ROLES.ADMIN]: '👑',
    [ROLES.OPERADOR]: '🧑'
});


// ────────────────────────────────────────────
// Status de Vendas & Turnos
// ────────────────────────────────────────────

/** Status possíveis de uma venda */
export const SALE_STATUS = Object.freeze({
    CONCLUIDA: 'CONCLUIDA',
    CANCELADA: 'CANCELADA'
});

/** Status possíveis de um turno */
export const SHIFT_STATUS = Object.freeze({
    OPEN: 'OPEN',
    CLOSED: 'CLOSED'
});


// ────────────────────────────────────────────
// Formas de Pagamento
// ────────────────────────────────────────────

/** Formas de pagamento disponíveis */
export const PAYMENT_METHODS = Object.freeze({
    PIX: 'pix',
    DEBITO: 'debito',
    CREDITO: 'credito',
    DINHEIRO: 'dinheiro'
});

/** Labels amigáveis para formas de pagamento */
export const PAYMENT_LABELS = Object.freeze({
    [PAYMENT_METHODS.PIX]: 'Pix',
    [PAYMENT_METHODS.DEBITO]: 'Débito',
    [PAYMENT_METHODS.CREDITO]: 'Crédito',
    [PAYMENT_METHODS.DINHEIRO]: 'Dinheiro'
});


// ────────────────────────────────────────────
// Categorias de Produtos
// ────────────────────────────────────────────

/** Categorias de produtos usadas no PDV */
export const CATEGORIES = Object.freeze({
    BEBIDAS: 'bebidas',
    ENERGETICOS: 'energeticos',
    PROTEICOS: 'proteicos',
    SUPLEMENTOS: 'suplementos',
    ROUPAS: 'roupas',
    VESTUARIO: 'vestuario',
    ACESSORIOS: 'acessorios'
});

/** 
 * Labels formatadas para cada categoria (com emoji).
 * Reproduz exatamente o switch de formatCategoryLabel() no app.js original.
 */
export const CATEGORY_LABELS = Object.freeze({
    [CATEGORIES.BEBIDAS]: '🥤 Bebidas & Energéticos',
    [CATEGORIES.ENERGETICOS]: '🥤 Bebidas & Energéticos',
    [CATEGORIES.PROTEICOS]: '🍫 Barrinhas & Whey',
    [CATEGORIES.SUPLEMENTOS]: '🏋️ Suplementos & Doses',
    [CATEGORIES.ROUPAS]: '👕 Roupas & Vestuário',
    [CATEGORIES.VESTUARIO]: '👕 Roupas & Vestuário',
    [CATEGORIES.ACESSORIOS]: '🎒 Acessórios & Brindes'
});

/**
 * Retorna o label formatado de uma categoria.
 * Reproduz o comportamento exato de formatCategoryLabel() no app.js.
 * 
 * @param {string} category - Código da categoria
 * @returns {string} Label formatado com emoji
 */
export function getCategoryLabel(category) {
    const key = (category || '').toLowerCase();
    return CATEGORY_LABELS[key] || (category ? category.toUpperCase() : '-');
}

/** 
 * Categorias agrupadas para o filtro do PDV.
 * bebidas e energeticos são filtrados juntos na UI.
 */
export const CATEGORY_GROUPS = Object.freeze({
    bebidas: ['bebidas', 'energeticos']
});


// ────────────────────────────────────────────
// Multi-tenancy
// ────────────────────────────────────────────

/** Tenant padrão para operação single-tenant */
export const DEFAULT_TENANT_ID = 'default';


// ────────────────────────────────────────────
// Configurações
// ────────────────────────────────────────────

/** Intervalo de polling quando não usa Supabase Realtime (ms) */
export const POLLING_INTERVAL_MS = 2500;

/** Limiar de estoque para alerta amarelo (estoque baixo) */
export const STOCK_ALERT_THRESHOLD = 'minStock'; // usa o campo minStock do produto

/** Limiar de diferença de caixa considerada "exata" (R$) */
export const CASH_DIFF_TOLERANCE = 0.05;

/** Dimensões de compressão de foto de produto */
export const PHOTO_MAX_SIZE = 300;

/** Versão do sistema (usada para cache busting) */
export const APP_VERSION = '3.2.1';
