/**
 * Panobianco PDV & ERP — Módulo de Vendas
 * 
 * Gerencia o processamento e cancelamento de vendas:
 * - Finalização com fallback 3 camadas (Supabase → API → offline)
 * - Modal de comprovante pós-venda
 * - Cancelamento imediato com estorno de estoque
 * 
 * Extraído de PanobiancoApp (app.js L551-L723)
 * 
 * @module modules/sales
 */

import { escapeHtml, formatCurrency, formatTime } from '../core/helpers.js';
import { SALE_STATUS } from '../core/constants.js';

// ────────────────────────────────────────────
// Estado interno
// ────────────────────────────────────────────

/** @type {string|null} ID da última venda (para cancelamento imediato) */
let _lastSaleId = null;


// ────────────────────────────────────────────
// Getters
// ────────────────────────────────────────────

/** @returns {string|null} */
export function getLastSaleId() { return _lastSaleId; }

/** @param {string|null} id */
export function setLastSaleId(id) { _lastSaleId = id; }


// ────────────────────────────────────────────
// Finalização de Venda
// ────────────────────────────────────────────

/**
 * Processa a venda com fallback de 3 camadas.
 * Reproduz finalizeSale() do app.js (L551-L641).
 * 
 * @param {object} params
 * @param {Array} params.cart - Itens do carrinho
 * @param {string} params.paymentMethod - Forma de pagamento
 * @param {object} params.currentUser - Usuário logado
 * @param {object} params.state - Estado atual do app (para fallback offline)
 * @param {boolean} params.useSupabase - Se Supabase está habilitado
 * @param {string} params.apiBase - Base URL da API local
 * @param {Function} params.onSuccess - Callback após venda bem-sucedida (recebe sale)
 * @param {Function} params.onSyncSupabase - Callback para sincronizar Supabase
 * @param {Function} params.onSyncServer - Callback para sincronizar servidor local
 * @param {Function} params.onStateChanged - Callback quando estado local muda (offline)
 */
export async function finalizeSale(params) {
    const { cart, paymentMethod, currentUser, state, useSupabase, apiBase } = params;

    if (!cart || cart.length === 0) {
        alert('⚠️ O cupom de venda está vazio!');
        return;
    }

    const totalVal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const totalCost = cart.reduce((sum, item) => sum + (item.cost * item.qty), 0);
    const profit = totalVal - totalCost;

    const opCode = currentUser ? currentUser.code.toUpperCase() : 'F20729';
    const opName = currentUser ? `${currentUser.name} [${opCode}]` : 'Luan [F20729]';

    const salePayload = {
        items: [...cart],
        total: totalVal,
        cost: totalCost,
        profit,
        paymentMethod,
        operatorId: currentUser ? currentUser.id : 'f20729',
        operatorName: opName,
        operatorCode: opCode
    };

    // Camada 1: Supabase Cloud
    if (useSupabase) {
        try {
            // Importação dinâmica evita dependência circular
            const { processSale } = await import('../services/data-service.js');
            const result = await processSale(salePayload);
            if (result && result.success) {
                showSuccessModal(result.sale);
                if (params.onSuccess) params.onSuccess(result.sale);
                if (params.onSyncSupabase) await params.onSyncSupabase();
                return;
            } else {
                throw new Error(result?.error || 'Erro ao processar venda no Supabase.');
            }
        } catch (err) {
            console.error('❌ Erro na venda Supabase:', err);
            alert(`❌ Erro ao finalizar venda: ${err.message || err}`);
            return;
        }
    }

    // Camada 2: API local
    try {
        const res = await fetch(`${apiBase}/api/sale`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(salePayload)
        });

        if (res.ok) {
            const data = await res.json();
            showSuccessModal(data.sale);
            if (params.onSuccess) params.onSuccess(data.sale, data.state);
            return;
        } else {
            throw new Error('Falha no servidor');
        }
    } catch (e) {
        // Camada 3: Offline (localStorage)
        state.saleCounter = (state.saleCounter || 0) + 1;
        const seq = state.saleCounter;
        const code = `V${seq < 10 ? '0' + seq : seq}`;

        cart.forEach(cartItem => {
            const prod = (state.products || []).find(p => p.id === cartItem.productId);
            if (prod) prod.stock -= cartItem.qty;
        });

        const offlineSale = {
            id: code,
            seq,
            timestamp: new Date().toISOString(),
            dateFormatted: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            fullDateTime: new Date().toLocaleString('pt-BR'),
            ...salePayload,
            status: SALE_STATUS.CONCLUIDA
        };

        state.sales.unshift(offlineSale);
        if (state.activeShift) {
            if (!state.activeShift.sales) state.activeShift.sales = [];
            state.activeShift.sales.push(offlineSale);
        }

        showSuccessModal(offlineSale);
        if (params.onStateChanged) params.onStateChanged(state);
        if (params.onSuccess) params.onSuccess(offlineSale);
    }
}


// ────────────────────────────────────────────
// Modal de Comprovante
// ────────────────────────────────────────────

/**
 * Exibe o modal de comprovante pós-venda.
 * Reproduz showSuccessModal() do app.js (L643-L667).
 * Usa escapeHtml para prevenir XSS em nomes de operador e produtos.
 * 
 * @param {object} sale - Dados da venda concluída
 */
export function showSuccessModal(sale) {
    _lastSaleId = sale.id;

    const codeEl = document.getElementById('modal-sale-code');
    const codeText = document.getElementById('modal-code-text');
    if (codeEl) codeEl.innerText = sale.id;
    if (codeText) codeText.innerText = sale.id;

    const preview = document.getElementById('receipt-preview');
    if (preview) {
        const itemsList = (sale.items || [])
            .map(it => `&bull; ${it.qty}x ${escapeHtml(it.name)} (${formatCurrency(it.price * it.qty)})`)
            .join('<br>');

        const safeOperator = escapeHtml(sale.operatorName);
        const safePayment = escapeHtml((sale.paymentMethod || '').toUpperCase());
        const timeStr = sale.dateFormatted || formatTime(new Date());

        preview.innerHTML = `
            <strong>Comprovante da Lojinha (#${escapeHtml(sale.id)})</strong><br>
            ⏰ Horário: ${timeStr}<br>
            👤 <strong>Operador: ${safeOperator}</strong><br>
            💳 Pagamento: <strong>${safePayment}</strong><br>
            <hr style="margin: 6px 0; border: 0; border-top: 1px dashed #cbd5e1;">
            ${itemsList}<br>
            <hr style="margin: 6px 0; border: 0; border-top: 1px dashed #cbd5e1;">
            <strong style="color: #0f172a; font-size: 11pt;">TOTAL: ${formatCurrency(sale.total)}</strong>
        `;
    }

    const modal = document.getElementById('success-modal');
    if (modal) modal.classList.add('active');
}

/**
 * Fecha o modal de comprovante.
 * Reproduz closeSuccessModal() do app.js (L665-L667).
 */
export function closeSuccessModal() {
    const modal = document.getElementById('success-modal');
    if (modal) modal.classList.remove('active');
}


// ────────────────────────────────────────────
// Cancelamento Imediato
// ────────────────────────────────────────────

/**
 * Cancela a última venda com motivo obrigatório.
 * Reproduz cancelLastSale() do app.js (L669-L723).
 * 
 * @param {object} params
 * @param {object} params.currentUser - Usuário logado
 * @param {boolean} params.useSupabase - Se Supabase está habilitado
 * @param {string} params.apiBase - Base URL da API local
 * @param {string} params.authToken - Token JWT
 * @param {Function} params.onSyncSupabase - Callback para sync Supabase
 * @param {Function} params.onSyncServer - Callback para sync servidor
 * @param {Function} [params.onUnauthorized] - Callback para 401
 */
export async function cancelLastSale(params) {
    if (!_lastSaleId) return;

    const reason = prompt(
        `⚠️ Cancelar venda ${_lastSaleId}?\n\nDigite o motivo do cancelamento (ex: "erro de produto", "cliente desistiu"):`,
        'Erro de operação — cancelamento imediato'
    );
    if (!reason) return;

    const { currentUser, useSupabase, apiBase } = params;
    const opId = currentUser ? currentUser.id : 'f20729';
    const opName = currentUser ? `${currentUser.name} [${currentUser.code.toUpperCase()}]` : 'Luan [F20729]';
    const userIsAdmin = currentUser && currentUser.role === 'ADMIN';

    // Camada 1: Supabase
    if (useSupabase) {
        try {
            const { cancelSale } = await import('../services/data-service.js');
            const res = await cancelSale(_lastSaleId, opId, opName, reason, userIsAdmin);
            if (res && res.success) {
                alert(`✅ Venda ${_lastSaleId} cancelada com sucesso!\nEstoque devolvido no Supabase Cloud.`);
                _lastSaleId = null;
                closeSuccessModal();
                if (params.onSyncSupabase) await params.onSyncSupabase();
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

    // Camada 2: API local
    try {
        const { authFetch } = await import('../services/sync.js');
        const res = await authFetch(`${apiBase}/api/sale/cancel`, {
            method: 'POST',
            body: JSON.stringify({
                saleId: _lastSaleId,
                reason,
                immediateCancelByOperator: true
            })
        }, params.onUnauthorized);

        if (res.ok) {
            alert(`✅ Venda ${_lastSaleId} cancelada com sucesso!\nEstoque devolvido automaticamente.`);
            _lastSaleId = null;
            closeSuccessModal();
            if (params.onSyncServer) await params.onSyncServer();
        } else {
            const data = await res.json();
            alert(`❌ ${data.error || 'Erro ao cancelar.'}`);
        }
    } catch (e) {
        if (e.message === 'Sem permissão' || e.message.includes('ADMIN')) {
            alert('❌ Você não tem permissão para cancelar vendas. Peça ao gestor.');
        }
    }
}
