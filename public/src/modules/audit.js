/**
 * Panobianco PDV & ERP — Audit Module
 * 
 * Handles audit logs, cancel modal, and events.
 * 
 * @module modules/audit
 */

import { escapeHtml, sanitizeCsvField, formatCurrency } from '../core/helpers.js';
import { SALE_STATUS, ROLES } from '../core/constants.js';

// ── Private State ───────────────────────────
let _config = null;
let _auditQuery = '';
let _auditEvents = [];
let _currentAuditTab = 'vendas';

// ── Configuration ───────────────────────────

/**
 * Configure this module with app-level dependencies.
 * @param {Object} config
 */
export function configureAudit(config) {
    _config = config;
}

export function renderAuditLogs() {
    const tbody = document.getElementById('audit-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const state = _config.getState();
    const currentUser = _config.getCurrentUser();
    let sales = state.sales || [];
    if (_auditQuery) {
        sales = sales.filter(s => 
            s.id.toLowerCase().includes(_auditQuery) ||
            s.operatorName.toLowerCase().includes(_auditQuery) ||
            (s.operatorCode && s.operatorCode.toLowerCase().includes(_auditQuery)) ||
            s.paymentMethod.toLowerCase().includes(_auditQuery) ||
            s.items.some(it => it.name.toLowerCase().includes(_auditQuery))
        );
    }

    sales.forEach(sale => {
        const tr = document.createElement('tr');
        const itemsSummary = escapeHtml(sale.items.map(it => `${it.qty}x ${it.name}`).join(', '));

        tr.innerHTML = `
            <td><span class="slip-code-tag">${escapeHtml(sale.id)}</span></td>
            <td>${escapeHtml(sale.fullDateTime || sale.dateFormatted)}</td>
            <td><strong>${escapeHtml(sale.operatorName)}</strong></td>
            <td>${itemsSummary}</td>
            <td><span class="badge badge-gray">${escapeHtml(sale.paymentMethod).toUpperCase()}</span></td>
            <td><strong>${formatCurrency(sale.total)}</strong></td>
            <td>
                <span class="badge-status ${sale.status === SALE_STATUS.CANCELADA ? 'badge-cancel' : 'badge-ok'}">
                    ${escapeHtml(sale.status)}
                </span>
                ${sale.cancelReason ? `<br><small style="color:#ef4444;">${escapeHtml(sale.cancelReason)}</small>` : ''}
            </td>
            <td class="text-right">
                ${sale.status !== SALE_STATUS.CANCELADA && currentUser && currentUser.role === ROLES.ADMIN ? `
                    <button class="btn btn-sm btn-danger" onclick="app.openCancelModal('${escapeHtml(sale.id)}')">Cancelar</button>
                ` : '-'}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

export function filterAudit(query) {
    _auditQuery = query.toLowerCase().trim();
    renderAuditLogs();
}

export function openCancelModal(saleId) {
    document.getElementById('cancel-sale-id').value = saleId;
    document.getElementById('cancel-reason').value = '';
    document.getElementById('cancel-modal').classList.add('active');
}

export function closeCancelModal() {
    document.getElementById('cancel-modal').classList.remove('active');
}

export async function confirmCancelSale() {
    const saleId = document.getElementById('cancel-sale-id').value;
    const reason = document.getElementById('cancel-reason').value.trim();

    if (!reason) {
        alert('⚠️ A justificativa de cancelamento é obrigatória para a auditoria.');
        return;
    }

    const currentUser = _config.getCurrentUser();
    const adminTitle = currentUser ? `${currentUser.name} [${currentUser.code.toUpperCase()}]` : 'Luan [F20729]';

    if (_config.getUseSupabase()) {
        try {
            const { cancelSale } = await import('../services/data-service.js');
            const opId = currentUser ? currentUser.id : 'f20729';
            const isAdmin = currentUser && currentUser.role === ROLES.ADMIN;
            const res = await cancelSale(saleId, opId, adminTitle, reason, isAdmin);
            if (res && res.success) {
                alert(`✅ Venda ${saleId} cancelada e itens devolvidos ao estoque no Supabase Cloud!`);
                await _config.syncWithSupabase(false);
                closeCancelModal();
                _config.renderAll();
                return;
            } else {
                throw new Error(res?.error || 'Erro ao cancelar venda.');
            }
        } catch (err) {
            console.error('❌ Erro no cancelamento Supabase:', err);
            alert(`❌ ${err.message || 'Erro ao cancelar.'}`);
            return;
        }
    }

    try {
        const res = await fetch(`${_config.getApiBase()}/api/sale/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                saleId,
                reason,
                adminName: adminTitle
            })
        });

        if (res.ok) {
            const data = await res.json();
            _config.saveLocalState(data.state);
            alert(`✅ Venda ${saleId} cancelada e itens devolvidos ao estoque em todas as máquinas!`);
        }
    } catch (e) {
        alert('⚠️ Erro ao comunicar cancelamento.');
    }

    closeCancelModal();
    _config.renderAll();
}

export function exportAuditLogs() {
    let csv = 'CodigoVenda;DataHora;Operador;CodigoOperador;Itens;FormaPagamento;Total;Lucro;Status;Justificativa\n';
    const state = _config.getState();
    (state.sales || []).forEach(s => {
        const items = s.items.map(it => `${it.qty}x ${it.name}`).join(' | ');
        csv += `"${sanitizeCsvField(s.id)}";"${sanitizeCsvField(s.fullDateTime || s.dateFormatted)}";"${sanitizeCsvField(s.operatorName)}";"${sanitizeCsvField(s.operatorCode || '')}";"${sanitizeCsvField(items)}";"${sanitizeCsvField(s.paymentMethod)}";"${s.total.toFixed(2)}";"${s.profit ? s.profit.toFixed(2) : 0}";"${sanitizeCsvField(s.status)}";"${sanitizeCsvField(s.cancelReason || '')}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Auditoria_Lojinha_Panobianco_ViasEVO_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
}

export function switchAuditTab(tab) {
    const isVendas = tab === 'vendas';

    const viewVendas = document.getElementById('audit-view-vendas');
    const viewEventos = document.getElementById('audit-view-eventos');
    const filtersVendas = document.getElementById('audit-filters-vendas');
    const filtersEventos = document.getElementById('audit-filters-eventos');
    
    if (viewVendas) viewVendas.style.display = isVendas ? '' : 'none';
    if (viewEventos) viewEventos.style.display = isVendas ? 'none' : '';
    if (filtersVendas) filtersVendas.style.display = isVendas ? '' : 'none';
    if (filtersEventos) filtersEventos.style.display = isVendas ? 'none' : '';

    const btnVendas = document.getElementById('audit-tab-vendas');
    const btnEventos = document.getElementById('audit-tab-eventos');
    if (btnVendas && btnEventos) {
        btnVendas.className = isVendas ? 'btn btn-sm' : 'btn btn-sm btn-secondary';
        btnVendas.style.fontWeight = isVendas ? 'bold' : 'normal';
        btnEventos.className = isVendas ? 'btn btn-sm btn-secondary' : 'btn btn-sm';
        btnEventos.style.fontWeight = isVendas ? 'normal' : 'bold';
    }

    if (!isVendas) {
        loadAuditEvents();
    }

    _currentAuditTab = tab;
}

export async function loadAuditEvents() {
    try {
        const searchInput = document.getElementById('audit-event-search');
        const actionInput = document.getElementById('audit-action-filter');
        const dateFromInput = document.getElementById('audit-date-from');
        const dateToInput = document.getElementById('audit-date-to');
        
        const search = searchInput ? searchInput.value : '';
        const action = actionInput ? actionInput.value : '';
        const dateFrom = dateFromInput ? dateFromInput.value : '';
        const dateTo = dateToInput ? dateToInput.value : '';

        if (_config.getUseSupabase()) {
            const { getAuditLogs } = await import('../services/data-service.js');
            const data = await getAuditLogs({ search, action, dateFrom, dateTo });
            _auditEvents = data.logs || [];
            const select = document.getElementById('audit-action-filter');
            if (select && data.actionTypes) {
                const currentValue = select.value;
                select.innerHTML = '<option value="">Todas as ações</option>';
                data.actionTypes.forEach(a => {
                    const opt = document.createElement('option');
                    opt.value = a;
                    opt.textContent = formatActionLabel(a);
                    select.appendChild(opt);
                });
                select.value = currentValue;
            }
            renderAuditEvents();
            return;
        }

        const params = new URLSearchParams();
        if (search) params.set('search', search);
        if (action) params.set('action', action);
        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo) params.set('dateTo', dateTo + 'T23:59:59');

        const authFetch = _config.authFetch;
        const res = await authFetch(`${_config.getApiBase()}/api/audit?${params.toString()}`);
        if (!res.ok) return;

        const data = await res.json();
        _auditEvents = data.logs || [];

        const select = document.getElementById('audit-action-filter');
        if (select && data.actionTypes) {
            const currentValue = select.value;
            select.innerHTML = '<option value="">Todas as ações</option>';
            data.actionTypes.forEach(a => {
                const opt = document.createElement('option');
                opt.value = a;
                opt.textContent = formatActionLabel(a);
                select.appendChild(opt);
            });
            select.value = currentValue;
        }

        renderAuditEvents();
    } catch (e) {
        console.error('Erro ao carregar audit log:', e);
    }
}

export function filterAuditEvents() {
    loadAuditEvents();
}

export function renderAuditEvents() {
    const tbody = document.getElementById('audit-events-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const events = _auditEvents || [];

    if (events.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:32px;">Nenhum evento encontrado.</td></tr>';
        return;
    }

    events.forEach(ev => {
        const tr = document.createElement('tr');
        const dateStr = ev.created_at ? new Date(ev.created_at.includes('T') ? ev.created_at : ev.created_at + 'Z').toLocaleString('pt-BR') : '-';
        const actionBadge = getActionBadge(ev.action);

        tr.innerHTML = `
            <td style="font-size:0.85em;color:#6b7280;white-space:nowrap;">${escapeHtml(dateStr)}</td>
            <td>${actionBadge}</td>
            <td><code style="font-size:0.8em;">${escapeHtml(ev.entity_type || '-')}</code></td>
            <td><code style="font-size:0.8em;">${escapeHtml(ev.entity_id || '-')}</code></td>
            <td><strong>${escapeHtml(ev.operator_name || '-')}</strong></td>
            <td style="font-size:0.9em;color:#4b5563;">${escapeHtml(ev.details || '-')}</td>
        `;
        tbody.appendChild(tr);
    });
}

export function formatActionLabel(action) {
    const labels = {
        'LOGIN': '🔑 Login',
        'LOGOUT': '🚪 Logout',
        'VENDA': '💰 Venda',
        'CANCELAMENTO': '❌ Cancelamento',
        'REPOSICAO': '📦 Reposição',
        'PRODUTO_ATUALIZADO': '✏️ Produto Editado',
        'FOTO_ATUALIZADA': '📷 Foto Atualizada',
        'USUARIO_ATUALIZADO': '👤 Usuário Editado',
        'FECHAMENTO_TURNO': '🔒 Fechamento de Turno'
    };
    return labels[action] || action;
}

export function getActionBadge(action) {
    const colors = {
        'LOGIN': '#22c55e', 'LOGOUT': '#6b7280',
        'VENDA': '#3b82f6', 'CANCELAMENTO': '#ef4444',
        'REPOSICAO': '#f59e0b', 'PRODUTO_ATUALIZADO': '#8b5cf6',
        'FOTO_ATUALIZADA': '#06b6d4', 'USUARIO_ATUALIZADO': '#ec4899',
        'FECHAMENTO_TURNO': '#f97316'
    };
    const color = colors[action] || '#6b7280';
    const label = formatActionLabel(action);
    return `<span style="background:${color}15;color:${color};padding:2px 8px;border-radius:6px;font-size:0.8em;font-weight:600;white-space:nowrap;">${label}</span>`;
}
