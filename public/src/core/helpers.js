/**
 * Panobianco PDV & ERP — Helpers Utilitários
 * 
 * Funções puras reutilizáveis para formatação, sanitização e utilidades gerais.
 * Nenhuma dependência externa. Nenhum acesso ao DOM, estado ou rede.
 * 
 * @module core/helpers
 */

// ────────────────────────────────────────────
// Sanitização & Segurança
// ────────────────────────────────────────────

/**
 * Escapa caracteres HTML perigosos para prevenir XSS.
 * Deve ser usado em todo conteúdo dinâmico antes de inserir via innerHTML.
 * 
 * @param {*} str - Valor a sanitizar (converte para string se necessário)
 * @returns {string} String segura para inserção em HTML
 * 
 * @example
 * escapeHtml('<img src=x onerror=alert(1)>')
 * // '&lt;img src=x onerror=alert(1)&gt;'
 * 
 * escapeHtml('Baly Energético 250ml')
 * // 'Baly Energético 250ml' (sem alteração)
 */
export function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const s = String(str);
    if (s === '') return '';
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Sanitiza um campo para exportação CSV, prevenindo CSV Injection.
 * Campos que iniciam com =, +, -, @ ou TAB são prefixados com apóstrofo.
 * 
 * @param {*} field - Campo a sanitizar
 * @returns {string} Campo seguro para CSV
 */
export function sanitizeCsvField(field) {
    if (field === null || field === undefined) return '';
    const s = String(field);
    // Prevenir CSV injection: fórmulas do Excel/Sheets começam com estes chars
    if (/^[=+\-@\t]/.test(s)) {
        return "'" + s;
    }
    return s;
}


// ────────────────────────────────────────────
// Formatação de Moeda
// ────────────────────────────────────────────

/**
 * Formata um número como moeda brasileira (R$).
 * Reproduz exatamente o padrão usado no app.js original:
 *   value.toFixed(2).replace('.', ',')
 * 
 * @param {number|string} value - Valor numérico
 * @param {boolean} [withSymbol=true] - Se true, prefixe com "R$ "
 * @returns {string} Valor formatado (ex: "R$ 12,50")
 * 
 * @example
 * formatCurrency(12.5)      // 'R$ 12,50'
 * formatCurrency(12.5, false) // '12,50'
 * formatCurrency(0)          // 'R$ 0,00'
 * formatCurrency(null)       // 'R$ 0,00'
 */
export function formatCurrency(value, withSymbol = true) {
    const num = Number(value) || 0;
    const formatted = num.toFixed(2).replace('.', ',');
    return withSymbol ? `R$ ${formatted}` : formatted;
}


// ────────────────────────────────────────────
// Formatação de Data/Hora
// ────────────────────────────────────────────

/**
 * Formata uma data/hora completa em pt-BR.
 * Reproduz: new Date(str).toLocaleString('pt-BR')
 * 
 * @param {string|Date} dateInput - Data ISO string ou Date object
 * @param {string} [fallback='-'] - Valor retornado se dateInput for inválido
 * @returns {string} Ex: "07/09/2026, 20:04:33"
 */
export function formatDateTime(dateInput, fallback = '-') {
    if (!dateInput) return fallback;
    try {
        return new Date(dateInput).toLocaleString('pt-BR');
    } catch {
        return fallback;
    }
}

/**
 * Formata apenas o horário (HH:MM) em pt-BR.
 * Reproduz: new Date(str).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
 * 
 * @param {string|Date} dateInput - Data ISO string ou Date object
 * @param {string} [fallback='-'] - Valor retornado se dateInput for inválido
 * @returns {string} Ex: "20:04"
 */
export function formatTime(dateInput, fallback = '-') {
    if (!dateInput) return fallback;
    try {
        return new Date(dateInput).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return fallback;
    }
}

/**
 * Formata data curta (DD/MM HH:MM).
 * Reproduz: `${d.toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit'})} ${d.toLocaleTimeString(...)}`
 * 
 * @param {string|Date} dateInput - Data ISO string ou Date object
 * @param {string} [fallback='-'] - Valor retornado se dateInput for inválido
 * @returns {string} Ex: "07/09 20:04"
 */
export function formatShortDateTime(dateInput, fallback = '-') {
    if (!dateInput) return fallback;
    try {
        const d = new Date(dateInput);
        const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `${date} ${time}`;
    } catch {
        return fallback;
    }
}


// ────────────────────────────────────────────
// Utilitários Gerais
// ────────────────────────────────────────────

/**
 * Cria um debounce wrapper para limitar execuções de uma função.
 * Útil para campos de busca, filtros, e handlers de input.
 * 
 * @param {Function} fn - Função a ser debounced
 * @param {number} ms - Delay em milissegundos
 * @returns {Function} Função com debounce aplicado
 */
export function debounce(fn, ms) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

/**
 * Gera um ID único simples baseado em timestamp + random.
 * NÃO é UUID v4 — adequado apenas para IDs locais/offline.
 * 
 * @returns {string} Ex: "1725739473000-a1b2c3d4"
 */
export function generateLocalId() {
    const ts = Date.now();
    const rand = Math.random().toString(36).substring(2, 10);
    return `${ts}-${rand}`;
}

/**
 * Normaliza uma string para comparações (remove acentos, lowercase).
 * Usado para busca de produtos e detecção de duplicatas.
 * 
 * @param {string} str - String a normalizar
 * @returns {string} String normalizada
 */
export function normalizeString(str) {
    if (!str) return '';
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

/**
 * Trunca texto adicionando "..." no final se exceder maxLen.
 * 
 * @param {string} text - Texto original
 * @param {number} maxLen - Comprimento máximo (default 50)
 * @returns {string} Texto truncado ou original
 */
export function truncate(text, maxLen = 50) {
    if (!text || text.length <= maxLen) return text || '';
    return text.substring(0, maxLen) + '...';
}
