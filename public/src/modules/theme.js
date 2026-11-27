/**
 * Panobianco PDV & ERP — Módulo de Personalização & Temas
 *
 * Permite que cada colaborador escolha seu tema (claro, escuro, preto, rosa claro,
 * lavanda, menta, azul céu, etc.) e cor de destaque favorita.
 * As preferências são salvas por matrícula (localStorage + Supabase),
 * sem interferir nos colegas e sem alterar a densidade dos cards.
 *
 * @module modules/theme
 */

const STORAGE_PREFIX = 'panobianco_theme_prefs_';

export const THEME_MODES = [
    { id: 'light', label: 'Claro Clássico', icon: '☀️', swatch: '#f8fafc', border: '#cbd5e1', isDark: false },
    { id: 'warm', label: 'Creme / Areia', icon: '🏜️', swatch: '#faf6ee', border: '#e6dcc8', isDark: false },
    { id: 'soft-pink', label: 'Rosa Claro', icon: '🌸', swatch: '#fdf2f8', border: '#fbcfe8', isDark: false },
    { id: 'lavender', label: 'Lavanda Suave', icon: '🪻', swatch: '#f5f3ff', border: '#ddd6fe', isDark: false },
    { id: 'sky', label: 'Azul Céu', icon: '☁️', swatch: '#f0f9ff', border: '#bae6fd', isDark: false },
    { id: 'mint', label: 'Menta Suave', icon: '🌿', swatch: '#f0fdf4', border: '#bbf7d0', isDark: false },
    { id: 'dark', label: 'Modo Escuro', icon: '🌙', swatch: '#1e293b', border: '#334155', isDark: true },
    { id: 'midnight', label: 'Preto Puro', icon: '🖤', swatch: '#09090b', border: '#27272a', isDark: true },
    { id: 'dark-rose', label: 'Escuro Rosé', icon: '🥀', swatch: '#1f1219', border: '#4c1d3d', isDark: true },
    { id: 'dark-ocean', label: 'Escuro Oceano', icon: '🌊', swatch: '#0b172a', border: '#1e3a5f', isDark: true }
];

export const ACCENT_COLORS = [
    { id: 'orange', label: 'Laranja Padrão', color: '#ea580c', hover: '#c2410c', light: '#ffedd5' },
    { id: 'rose', label: 'Rosa Claro', color: '#f472b6', hover: '#ec4899', light: '#fce7f3' },
    { id: 'pink', label: 'Rosa Pink', color: '#db2777', hover: '#be185d', light: '#fce7f3' },
    { id: 'purple', label: 'Roxo', color: '#9333ea', hover: '#7e22ce', light: '#f3e8ff' },
    { id: 'indigo', label: 'Índigo', color: '#4f46e5', hover: '#4338ca', light: '#e0e7ff' },
    { id: 'blue', label: 'Azul Royal', color: '#2563eb', hover: '#1d4ed8', light: '#dbeafe' },
    { id: 'cyan', label: 'Turquesa', color: '#0891b2', hover: '#0e7490', light: '#cffafe' },
    { id: 'teal', label: 'Verde Água', color: '#0d9488', hover: '#0f766e', light: '#ccfbf1' },
    { id: 'emerald', label: 'Esmeralda', color: '#059669', hover: '#047857', light: '#d1fae5' },
    { id: 'amber', label: 'Dourado', color: '#d97706', hover: '#b45309', light: '#fef3c7' },
    { id: 'red', label: 'Vermelho', color: '#dc2626', hover: '#b91c1c', light: '#fee2e2' },
    { id: 'slate', label: 'Grafite', color: '#475569', hover: '#334155', light: '#f1f5f9' }
];

const DEFAULT_PREFS = {
    mode: 'light',
    accent: 'orange',
    customColor: '#ea580c'
};

let _config = null;
let _draftPrefs = { ...DEFAULT_PREFS };
let _savedPrefs = { ...DEFAULT_PREFS };

export function configureTheme(config) {
    _config = config;
}

function getStorageKey(userCode) {
    return `${STORAGE_PREFIX}${String(userCode || '').trim().toLowerCase()}`;
}

function darkenHex(hex, amount = 24) {
    const clean = (hex || '#ea580c').replace('#', '');
    if (clean.length !== 6) return '#c2410c';
    const num = parseInt(clean, 16);
    const r = Math.max(0, (num >> 16) - amount);
    const g = Math.max(0, ((num >> 8) & 0x00ff) - amount);
    const b = Math.max(0, (num & 0x0000ff) - amount);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function hexToRgba(hex, alpha = 0.16) {
    const clean = (hex || '#ea580c').replace('#', '');
    if (clean.length !== 6) return `rgba(234, 88, 12, ${alpha})`;
    const num = parseInt(clean, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function applyTheme(prefs = DEFAULT_PREFS) {
    const merged = { ...DEFAULT_PREFS, ...(prefs || {}) };
    const root = document.documentElement;
    const modeObj = THEME_MODES.find(m => m.id === merged.mode) || THEME_MODES[0];

    root.setAttribute('data-theme', modeObj.id);
    root.setAttribute('data-theme-dark', modeObj.isDark ? 'true' : 'false');

    let primary = '#ea580c';
    let hover = '#c2410c';
    let light = '#ffedd5';

    if (merged.accent === 'custom' && merged.customColor) {
        primary = merged.customColor;
        hover = darkenHex(primary, 22);
        light = hexToRgba(primary, modeObj.isDark ? 0.22 : 0.14);
    } else {
        const accentObj = ACCENT_COLORS.find(a => a.id === merged.accent) || ACCENT_COLORS[0];
        primary = accentObj.color;
        hover = accentObj.hover;
        light = modeObj.isDark ? hexToRgba(primary, 0.22) : accentObj.light;
    }

    root.style.setProperty('--primary', primary);
    root.style.setProperty('--primary-hover', hover);
    root.style.setProperty('--primary-light', light);
    root.style.setProperty('--border-focus', primary);
}

export function resetThemeToDefault() {
    _savedPrefs = { ...DEFAULT_PREFS };
    _draftPrefs = { ...DEFAULT_PREFS };
    applyTheme(DEFAULT_PREFS);
}

export function loadUserTheme(user) {
    if (!user || !user.code) {
        resetThemeToDefault();
        return;
    }

    let localPrefs = null;
    try {
        const raw = localStorage.getItem(getStorageKey(user.code));
        if (raw) localPrefs = JSON.parse(raw);
    } catch (e) { /* ignore storage errors */ }

    const remotePrefs = (user.preferences && typeof user.preferences === 'object' && user.preferences.mode)
        ? user.preferences
        : null;

    let chosen = DEFAULT_PREFS;
    if (localPrefs && remotePrefs) {
        chosen = (remotePrefs.updatedAt || 0) >= (localPrefs.updatedAt || 0) ? remotePrefs : localPrefs;
    } else if (remotePrefs) {
        chosen = remotePrefs;
    } else if (localPrefs) {
        chosen = localPrefs;
    }

    _savedPrefs = { ...DEFAULT_PREFS, ...chosen };
    _draftPrefs = { ..._savedPrefs };
    applyTheme(_savedPrefs);
}

export function openThemeModal() {
    const user = _config?.getCurrentUser?.();
    if (!user) return;

    _draftPrefs = { ..._savedPrefs };
    renderThemeModalOptions();

    const userLabel = document.getElementById('theme-modal-user-label');
    if (userLabel) {
        userLabel.textContent = `${user.name} [${String(user.code).toUpperCase()}]`;
    }

    const modal = document.getElementById('theme-modal');
    if (modal) modal.classList.add('active');
}

export function closeThemeModal(revert = true) {
    if (revert) {
        applyTheme(_savedPrefs);
    }
    const modal = document.getElementById('theme-modal');
    if (modal) modal.classList.remove('active');
}

export function selectThemeMode(modeId) {
    _draftPrefs.mode = modeId;
    applyTheme(_draftPrefs);
    renderThemeModalOptions();
}

export function selectAccentColor(accentId) {
    _draftPrefs.accent = accentId;
    const found = ACCENT_COLORS.find(a => a.id === accentId);
    if (found) _draftPrefs.customColor = found.color;
    applyTheme(_draftPrefs);
    renderThemeModalOptions();
}

export function selectCustomAccentColor(hexColor) {
    if (!hexColor) return;
    _draftPrefs.accent = 'custom';
    _draftPrefs.customColor = hexColor;
    applyTheme(_draftPrefs);
    renderThemeModalOptions();
}

export function resetDraftTheme() {
    _draftPrefs = { ...DEFAULT_PREFS };
    applyTheme(_draftPrefs);
    renderThemeModalOptions();
}

export async function saveThemePreferences() {
    const user = _config?.getCurrentUser?.();
    if (!user || !user.code) {
        closeThemeModal(false);
        return;
    }

    const prefsToSave = {
        ..._draftPrefs,
        updatedAt: Date.now()
    };

    _savedPrefs = { ...prefsToSave };
    applyTheme(_savedPrefs);

    // 1. Salva no localStorage exclusivo da matrícula do colaborador
    try {
        localStorage.setItem(getStorageKey(user.code), JSON.stringify(prefsToSave));
    } catch (e) { /* ignore quota */ }

    // 2. Atualiza em memória e na sessão atual
    user.preferences = prefsToSave;
    try {
        sessionStorage.setItem('panobianco_user', JSON.stringify(user));
    } catch (e) { /* ignore */ }

    const state = _config?.getState?.();
    if (state && Array.isArray(state.users)) {
        const idx = state.users.findIndex(u => u.code && u.code.toLowerCase() === user.code.toLowerCase());
        if (idx !== -1) state.users[idx].preferences = prefsToSave;
    }

    // 3. Salva no Supabase para acompanhar o colaborador em qualquer PC/notebook da recepção
    if (_config?.getUseSupabase?.()) {
        try {
            const { updateUserPreferences } = await import('../services/data-service.js?v=3.5.0');
            await updateUserPreferences(user.code, prefsToSave);
        } catch (e) {
            console.warn('⚠️ Preferência salva localmente; erro ao sincronizar nuvem:', e.message);
        }
    }

    closeThemeModal(false);
}

function renderThemeModalOptions() {
    const modesContainer = document.getElementById('theme-modes-grid');
    if (modesContainer) {
        modesContainer.innerHTML = THEME_MODES.map(m => {
            const active = _draftPrefs.mode === m.id;
            return `
                <button type="button" class="theme-mode-card ${active ? 'active' : ''}" onclick="app.selectThemeMode('${m.id}')">
                    <span class="theme-swatch" style="background:${m.swatch}; border-color:${m.border};">
                        ${m.icon}
                    </span>
                    <span class="theme-mode-label">${m.label}</span>
                </button>
            `;
        }).join('');
    }

    const accentsContainer = document.getElementById('theme-accents-grid');
    if (accentsContainer) {
        accentsContainer.innerHTML = ACCENT_COLORS.map(a => {
            const active = _draftPrefs.accent === a.id;
            return `
                <button type="button" class="accent-dot-btn ${active ? 'active' : ''}" onclick="app.selectAccentColor('${a.id}')" title="${a.label}">
                    <span class="accent-dot" style="background:${a.color};"></span>
                    <span class="accent-label">${a.label}</span>
                </button>
            `;
        }).join('');
    }

    const customInput = document.getElementById('theme-custom-color-input');
    if (customInput) {
        customInput.value = _draftPrefs.customColor || '#ea580c';
    }
}
