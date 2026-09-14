/**
 * Panobianco PDV & ERP — Shifts Module
 * 
 * Handles shift management, cash register reconciliation, sales history within shifts,
 * and shift details modal.
 * 
 * @module modules/shifts
 */

import { escapeHtml, formatCurrency, sanitizeCsvField } from '../core/helpers.js';
import { SALE_STATUS, SHIFT_STATUS, PAYMENT_METHODS, CASH_DIFF_TOLERANCE } from '../core/constants.js';

// ── Private State ───────────────────────────
let _config = null;
let _slipsViewScope = 'all';
let _slipsSortOrder = 'desc';
let _slipsFilterQuery = '';
let _currentModalShift = null;
let _shiftModalFilterQuery = '';

// ── Configuration ───────────────────────────

/**
 * Configure this module with app-level dependencies.
 * @param {Object} config
 */
export function configureShifts(config) {
    _config = config;
}

// ── Public API ──────────────────────────────

/**
 * Sets the view scope for sales slips (e.g. 'all' or 'shift').
 * @param {string} scope 
 */
export function setSlipsViewScope(scope) {
    _slipsViewScope = scope;
    renderShiftModule();
}

/**
 * Toggles the sort order of sales slips.
 */
export function toggleSlipsOrder() {
    _slipsSortOrder = (_slipsSortOrder === 'asc') ? 'desc' : 'asc';
    renderShiftModule();
}

/**
 * Filters the sales slips by a query.
 * @param {string} query 
 */
export function filterShiftSlips(query) {
    _slipsFilterQuery = (query || '').toLowerCase().trim();
    renderShiftModule();
}

/**
 * Toggles the expansion of the slips table.
 */
export function toggleSlipsExpand() {
    const wrapper = document.querySelector('.slips-table-wrapper');
    const btn = document.getElementById('toggle-slips-expand-btn');
    if (wrapper) {
        wrapper.classList.toggle('expanded');
        if (btn) {
            btn.innerText = wrapper.classList.contains('expanded') ? '🔼 Recolher' : '↕️ Expandir';
        }
    }
}

/**
 * Renders the main shift module view including active shift stats and slips table.
 */
export function renderShiftModule() {
    const state = _config.getState();
    const currentUser = _config.getCurrentUser();
    const shift = state.activeShift || {};
    const currentName = currentUser ? `${currentUser.name} [${currentUser.code.toUpperCase()}]` : (shift.operatorName || 'Luan [F20729]');
    
    const elOpName = document.getElementById('shift-operator-name');
    if (elOpName) elOpName.innerText = currentName;
    
    const elStartTime = document.getElementById('shift-start-time');
    if (elStartTime) elStartTime.innerText = shift.startTime ? new Date(shift.startTime).toLocaleString('pt-BR') : '-';

    // 1. Resumo Financeiro do Turno Ativo
    const activeSales = shift.sales || [];
    const salesCountEl = document.getElementById('shift-sales-count');
    if (salesCountEl) salesCountEl.innerText = `${activeSales.length} vendas registradas`;

    let pix = 0, card = 0, cash = 0;
    let cardPixCount = 0;

    activeSales.forEach(sale => {
        if (sale.status !== SALE_STATUS.CANCELADA) {
            if (sale.paymentMethod === PAYMENT_METHODS.PIX) {
                pix += sale.total;
                cardPixCount++;
            } else if (sale.paymentMethod === PAYMENT_METHODS.DINHEIRO) {
                cash += sale.total;
            } else {
                card += sale.total;
                cardPixCount++;
            }
        }
    });

    const total = pix + card + cash;
    const pixEl = document.getElementById('shift-val-pix');
    if (pixEl) pixEl.innerText = formatCurrency(pix);
    const cardEl = document.getElementById('shift-val-card');
    if (cardEl) cardEl.innerText = formatCurrency(card);
    const cashEl = document.getElementById('shift-val-cash');
    if (cashEl) cashEl.innerText = formatCurrency(cash);
    const totalEl = document.getElementById('shift-val-total');
    if (totalEl) totalEl.innerText = formatCurrency(total);

    // 2. Mapear Shift ID para Código amigável (T01, T18, T75, T94...)
    const shiftCodeMap = {};
    (state.shifts || []).forEach(sh => {
        if (sh.id) shiftCodeMap[sh.id] = sh.shiftCode || 'Turno';
    });
    if (state.activeShift && state.activeShift.id) {
        shiftCodeMap[state.activeShift.id] = state.activeShift.shiftCode || 'Turno Atual';
    }

    // 3. Determinar Escopo de Vendas (Padrão: Todas as Vendas V01 ao mais recente)
    const scope = _slipsViewScope || 'all';
    const allSales = state.sales || [];
    let displayedSales = scope === 'all' ? [...allSales] : [...activeSales];

    // 4. Ordenação (Recente -> V01 ou V01 -> Recente)
    const sortOrder = _slipsSortOrder || 'desc';
    if (sortOrder === 'asc') {
        displayedSales.sort((a, b) => (a.seq || 0) - (b.seq || 0));
    } else {
        displayedSales.sort((a, b) => (b.seq || 0) - (a.seq || 0));
    }

    // 5. Filtro de Busca
    if (_slipsFilterQuery) {
        const q = _slipsFilterQuery;
        displayedSales = displayedSales.filter(s => 
            s.id.toLowerCase().includes(q) ||
            (s.paymentMethod && s.paymentMethod.toLowerCase().includes(q)) ||
            (s.operatorName && s.operatorName.toLowerCase().includes(q)) ||
            (shiftCodeMap[s.shiftId] && shiftCodeMap[s.shiftId].toLowerCase().includes(q)) ||
            (s.items || []).some(it => it.name.toLowerCase().includes(q))
        );
    }

    // Atualizar Botões de Escopo e Ordem
    const btnAll = document.getElementById('btn-view-all-sales');
    const btnShift = document.getElementById('btn-view-shift-sales');
    if (btnAll && btnShift) {
        if (scope === 'all') {
            btnAll.className = 'btn btn-sm btn-primary';
            btnShift.className = 'btn btn-sm btn-secondary';
        } else {
            btnAll.className = 'btn btn-sm btn-secondary';
            btnShift.className = 'btn btn-sm btn-primary';
        }
    }

    const btnOrder = document.getElementById('btn-slips-order');
    if (btnOrder) {
        btnOrder.innerText = sortOrder === 'asc' ? '⬆️ V01 → Recente' : '⬇️ Recente → V01';
    }

    const slipsCounter = document.getElementById('slips-card-counter');
    if (slipsCounter) {
        if (scope === 'all') {
            const newestId = allSales.length ? allSales[0].id : 'V01';
            slipsCounter.innerText = `Exibindo ${displayedSales.length} de ${allSales.length} vendas (V01 a ${newestId})`;
        } else {
            slipsCounter.innerText = `${displayedSales.length} vendas deste turno (${shift.shiftCode || 'T94'})`;
        }
    }

    // 6. Renderizar Linhas da Tabela
    const slipsBody = document.getElementById('shift-slips-table-body');
    if (slipsBody) {
        slipsBody.innerHTML = '';
        if (displayedSales.length === 0) {
            slipsBody.innerHTML = `<tr><td colspan="8" class="text-center" style="color:#94a3b8; padding: 16px;">
                ${_slipsFilterQuery ? 'Nenhuma venda encontrada para o filtro buscado.' : 'Nenhuma venda registrada no sistema.'}
            </td></tr>`;
        } else {
            displayedSales.forEach(s => {
                const tr = document.createElement('tr');
                const itemsText = (s.items || []).map(it => `${it.qty}x ${it.name}`).join(', ');
                const isCardOrPix = s.paymentMethod !== PAYMENT_METHODS.DINHEIRO;
                const sCode = shiftCodeMap[s.shiftId] || 'T??';

                let dateStr = '--:--';
                if (s.timestamp) {
                    const d = new Date(s.timestamp);
                    dateStr = `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
                } else if (s.dateFormatted) {
                    dateStr = escapeHtml(s.dateFormatted);
                }

                tr.innerHTML = `
                    <td><span class="slip-code-tag">${escapeHtml(s.id)}</span></td>
                    <td><span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700;">${escapeHtml(sCode)}</span></td>
                    <td>${dateStr}</td>
                    <td><strong>${escapeHtml((s.paymentMethod || '').toUpperCase().replace('_', ' '))}</strong></td>
                    <td><strong>${formatCurrency(s.total)}</strong></td>
                    <td><small>${escapeHtml(itemsText)}</small></td>
                    <td>${escapeHtml(s.operatorName || '-')}</td>
                    <td>
                        ${isCardOrPix 
                            ? `<span class="badge badge-blue">📎 Grampear Via #${escapeHtml(s.id)}</span>` 
                            : `<span class="badge" style="background:#e2e8f0; color:#475569;">💵 Dinheiro (Gaveta)</span>`}
                    </td>
                `;
                slipsBody.appendChild(tr);
            });
        }
    }

    renderShiftHistory();
}

/**
 * Reconciles and closes the active shift.
 */
export async function reconcileShift() {
    const currentUser = _config.getCurrentUser();
    const useSupabase = _config.getUseSupabase();
    
    const blindCashInput = document.getElementById('blind-cash-input');
    const countedCash = blindCashInput ? (parseFloat(blindCashInput.value) || 0) : 0;
    
    const opCode = currentUser ? currentUser.code.toUpperCase() : 'F20729';
    const opName = currentUser ? `${currentUser.name} [${opCode}]` : 'Luan [F20729]';

    // ── Confirmação Prévia ──────────────────────
    if (countedCash === 0) {
        const zeroConfirm = confirm(
            '⚠️ ATENÇÃO: Você está fechando o caixa com R$ 0,00 em espécie na gaveta.\n\n' +
            'Tem certeza que deseja prosseguir com a conferência zerada?\n\n' +
            'Operador: ' + opName
        );
        if (!zeroConfirm) return;
    } else {
        const confirmMsg = confirm(
            '🔒 CONFIRMAÇÃO DE FECHAMENTO DE CAIXA\n\n' +
            'Operador: ' + opName + '\n' +
            'Valor contado na gaveta: R$ ' + countedCash.toFixed(2).replace('.', ',') + '\n\n' +
            'Deseja confirmar o fechamento do turno com este valor?'
        );
        if (!confirmMsg) return;
    }

    // ── Fechamento via Supabase ─────────────────
    if (useSupabase) {
        try {
            const opId = currentUser ? currentUser.id : 'f20729';
            const { closeShift } = await import('../services/data-service.js');
            const res = await closeShift(countedCash, opId, opName);
            
            await _config.syncWithSupabase(false);
            
            showShiftClosedModal({
                shiftCode: res.shiftCode || _config.getState().activeShift?.shiftCode || 'N/A',
                operatorName: opName,
                totalSales: res.totalSales || 0,
                totalRevenue: res.totalRevenue || 0,
                countedCash: countedCash,
                systemCash: res.systemCash || 0,
                diff: res.diff || 0,
                endTime: new Date().toISOString()
            });
            
            if (blindCashInput) blindCashInput.value = '';
            return;
        } catch (e) {
            console.error('❌ Erro ao fechar turno no Supabase:', e);
            alert(`❌ Erro ao fechar turno: ${e.message}`);
            return;
        }
    }

    // ── Fechamento via API Local ─────────────────
    try {
        const res = await _config.authFetch(`${_config.getApiBase()}/api/shift/close`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                countedCash,
                operatorId: currentUser ? currentUser.id : 'f20729',
                operatorName: opName
            })
        });

        if (res.ok) {
            const data = await res.json();
            Object.assign(_config.getState(), data.state);
            _config.saveLocalState(data.state);
            
            showShiftClosedModal({
                shiftCode: data.closedShift?.shiftCode || 'N/A',
                operatorName: opName,
                totalSales: data.closedShift?.totalSales || 0,
                totalRevenue: data.closedShift?.totalRevenue || 0,
                countedCash: countedCash,
                systemCash: data.closedShift?.systemCash || 0,
                diff: data.closedShift?.diff || 0,
                endTime: new Date().toISOString()
            });
            
            if (blindCashInput) blindCashInput.value = '';
        }
    } catch (e) {
        alert('⚠️ Fechamento gravado localmente.');
    }

    _config.renderAll();
}

/**
 * Shows the shift closed success modal with financial details.
 * @param {Object} shiftData - Closed shift data
 */
export function showShiftClosedModal(shiftData) {
    const modal = document.getElementById('shift-closed-modal');
    if (!modal) return;

    const diff = shiftData.diff || 0;
    let diffBannerClass, diffIcon, diffText;
    
    if (Math.abs(diff) < CASH_DIFF_TOLERANCE) {
        diffBannerClass = 'match';
        diffIcon = '✅';
        diffText = 'Gaveta Conferida — Sem Divergência';
    } else if (diff > 0) {
        diffBannerClass = 'diff-over';
        diffIcon = '🔼';
        diffText = `Sobra de ${formatCurrency(diff)} na gaveta`;
    } else {
        diffBannerClass = 'diff-under';
        diffIcon = '🔻';
        diffText = `Falta de ${formatCurrency(Math.abs(diff))} na gaveta`;
    }

    const endTimeFormatted = new Date(shiftData.endTime).toLocaleString('pt-BR');

    document.getElementById('sc-shift-code').innerText = shiftData.shiftCode;
    document.getElementById('sc-operator').innerText = shiftData.operatorName;
    document.getElementById('sc-end-time').innerText = endTimeFormatted;
    document.getElementById('sc-total-sales').innerText = shiftData.totalSales;
    document.getElementById('sc-total-revenue').innerText = formatCurrency(shiftData.totalRevenue);
    document.getElementById('sc-system-cash').innerText = formatCurrency(shiftData.systemCash);
    document.getElementById('sc-counted-cash').innerText = formatCurrency(shiftData.countedCash);
    
    const diffBanner = document.getElementById('sc-diff-banner');
    diffBanner.className = 'shift-diff-banner ' + diffBannerClass;
    diffBanner.innerHTML = `<span>${diffIcon} ${diffText}</span>`;

    modal.classList.add('active');
}

/**
 * Closes the shift closed success modal.
 */
export function closeShiftClosedModal() {
    const modal = document.getElementById('shift-closed-modal');
    if (modal) modal.classList.remove('active');
}

/**
 * Closes modal and navigates to POS for next shift.
 */
export function finishShiftAndGoToPDV() {
    closeShiftClosedModal();
    // Navigate to Frente de Caixa tab
    const navFn = window.app?.navigateTo;
    if (navFn) navFn('pos');
}

/**
 * Renders the shift history list.
 */
export function renderShiftHistory() {
    const container = document.getElementById('shift-history-list');
    if (!container) return;
    container.innerHTML = '';

    const state = _config.getState();
    const shifts = state.shifts || [];
    if (shifts.length === 0) {
        container.innerHTML = '<p style="color:#94a3b8; font-size:8.5pt;">Nenhum turno fechado anteriormente.</p>';
        return;
    }

    shifts.forEach(sh => {
        const item = document.createElement('div');
        item.className = 'shift-history-item';
        item.style.cursor = 'pointer';
        item.title = `Clique para abrir todas as vendas e detalhes do Turno ${escapeHtml(sh.shiftCode || '')}`;
        item.onclick = () => openShiftDetailsModal(sh.id);

        const salesCount = (sh.sales && sh.sales.length) || sh.totalSales || 0;
        const diffText = sh.diff === 0 
            ? 'Exato' 
            : (sh.diff > 0 ? '+' + formatCurrency(sh.diff) : '-' + formatCurrency(Math.abs(sh.diff)));

        item.innerHTML = `
            <div class="sh-header">
                <span>${escapeHtml(sh.shiftCode || 'Turno')} — ${escapeHtml(sh.operatorName)}</span>
                <span style="color: #ea580c; font-weight: 800;">${formatCurrency(Number(sh.totalRevenue))}</span>
            </div>
            <div style="color: #64748b; font-size: 7.5pt; margin-bottom: 6px;">
                📅 Fechamento: ${new Date(sh.endTime).toLocaleString('pt-BR')}<br>
                Vendas: <strong>${salesCount}</strong> | Gaveta: ${formatCurrency(Number(sh.countedCash || 0))} (${diffText})
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed #e2e8f0; padding-top: 5px;">
                <span class="badge badge-blue" style="font-size: 7.5pt;">🔍 Ver ${salesCount} Vendas & Detalhes</span>
                <span style="font-size: 7.5pt; color: #ea580c; font-weight: 700;">🖨️ Reimprimir EVO</span>
            </div>
        `;
        container.appendChild(item);
    });
}

/**
 * Opens the shift details modal.
 * @param {string} shiftId 
 */
export function openShiftDetailsModal(shiftId) {
    const state = _config.getState();
    let shift = null;
    
    if (shiftId === 'active') {
        shift = state.activeShift;
    } else {
        shift = (state.shifts || []).find(s => s.id === shiftId);
        if (!shift && state.activeShift && state.activeShift.id === shiftId) {
            shift = state.activeShift;
        }
    }

    if (!shift) {
        alert('⚠️ Turno não encontrado.');
        return;
    }

    _currentModalShift = shift;
    _shiftModalFilterQuery = '';

    const titleEl = document.getElementById('shift-modal-title');
    const subtitleEl = document.getElementById('shift-modal-subtitle');
    const searchInput = document.getElementById('shift-modal-search');
    if (searchInput) searchInput.value = '';

    const isClosed = shift.status === SHIFT_STATUS.CLOSED;
    if (titleEl) {
        titleEl.innerHTML = `📋 Turno <strong>${escapeHtml(shift.shiftCode || 'T01')}</strong> — ${escapeHtml(shift.operatorName)}`;
    }
    if (subtitleEl) {
        const startStr = shift.startTime ? new Date(shift.startTime).toLocaleString('pt-BR') : '-';
        const endStr = shift.endTime ? new Date(shift.endTime).toLocaleString('pt-BR') : 'Turno em Aberto (Ativo)';
        subtitleEl.innerHTML = `Início: <strong>${startStr}</strong> | Fechamento: <strong>${endStr}</strong> | Status: <span class="badge ${isClosed ? 'badge-ok' : 'badge-blue'}">${isClosed ? 'Fechado' : 'Aberto'}</span>`;
    }

    // Totais e KPIs
    const sales = shift.sales || [];
    let pixTotal = 0, cardTotal = 0, cashTotal = 0;
    let cardPixCount = 0;

    sales.forEach(s => {
        if (s.status !== SALE_STATUS.CANCELADA) {
            const tot = Number(s.total) || 0;
            if (s.paymentMethod === PAYMENT_METHODS.PIX) {
                pixTotal += tot;
                cardPixCount++;
            } else if (s.paymentMethod === PAYMENT_METHODS.DINHEIRO) {
                cashTotal += tot;
            } else {
                cardTotal += tot;
                cardPixCount++;
            }
        }
    });

    const grossTotal = pixTotal + cardTotal + cashTotal;
    const countedCashVal = shift.countedCash !== null && shift.countedCash !== undefined ? Number(shift.countedCash) : cashTotal;
    const diffVal = Number(shift.diff) || 0;

    const elKpiTotal = document.getElementById('shift-modal-kpi-total');
    const elKpiCount = document.getElementById('shift-modal-kpi-sales-count');
    const elKpiCash = document.getElementById('shift-modal-kpi-cash');
    const elKpiDiff = document.getElementById('shift-modal-kpi-diff');
    const elKpiCardPix = document.getElementById('shift-modal-kpi-cardpix');

    if (elKpiTotal) elKpiTotal.innerText = formatCurrency(grossTotal);
    if (elKpiCount) elKpiCount.innerText = `${sales.length} vendas`;
    if (elKpiCash) elKpiCash.innerText = formatCurrency(countedCashVal);
    if (elKpiDiff) {
        elKpiDiff.innerText = `Registrado: ${formatCurrency(cashTotal)} | Dif: ${diffVal === 0 ? 'R$ 0,00' : (diffVal > 0 ? '+' + formatCurrency(diffVal) : '-' + formatCurrency(Math.abs(diffVal)))}`;
    }
    if (elKpiCardPix) elKpiCardPix.innerText = `${formatCurrency(cardTotal + pixTotal)} (${cardPixCount} vias)`;

    renderShiftModalSalesTable();
    const modal = document.getElementById('shift-details-modal');
    if (modal) modal.classList.add('active');
}

/**
 * Renders the sales table inside the shift modal.
 */
export function renderShiftModalSalesTable() {
    const tbody = document.getElementById('shift-modal-sales-tbody');
    if (!tbody || !_currentModalShift) return;
    tbody.innerHTML = '';

    let sales = _currentModalShift.sales || [];
    if (_shiftModalFilterQuery) {
        const q = _shiftModalFilterQuery;
        sales = sales.filter(s => 
            s.id.toLowerCase().includes(q) ||
            (s.paymentMethod && s.paymentMethod.toLowerCase().includes(q)) ||
            (s.items || []).some(it => it.name.toLowerCase().includes(q))
        );
    }

    if (sales.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 16px; color: #94a3b8;">
            ${_shiftModalFilterQuery ? 'Nenhuma venda encontrada para esta busca.' : 'Nenhuma venda registrada neste turno.'}
        </td></tr>`;
        return;
    }

    sales.forEach(s => {
        const tr = document.createElement('tr');
        const itemsText = (s.items || []).map(it => `<strong>${it.qty}x</strong> ${escapeHtml(it.name)}`).join('<br>');
        const isCardOrPix = s.paymentMethod !== PAYMENT_METHODS.DINHEIRO;
        const payLabel = (s.paymentMethod || '').toUpperCase().replace('_', ' ');

        tr.innerHTML = `
            <td><span class="slip-code-tag">${escapeHtml(s.id)}</span></td>
            <td>${s.dateFormatted ? escapeHtml(s.dateFormatted) : (s.timestamp ? new Date(s.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-')}</td>
            <td>
                <span class="badge ${isCardOrPix ? 'badge-blue' : ''}" style="${!isCardOrPix ? 'background:#e2e8f0; color:#475569;' : ''}">
                    ${escapeHtml(payLabel)}
                </span>
            </td>
            <td><strong>${formatCurrency(s.total)}</strong></td>
            <td style="font-size: 8.5pt; color: #334155; line-height: 1.3;">${itemsText}</td>
            <td>
                <span class="badge-status ${s.status === SALE_STATUS.CANCELADA ? 'badge-cancel' : 'badge-ok'}">
                    ${escapeHtml(s.status)}
                </span>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * Filters the sales in the shift modal.
 * @param {string} query 
 */
export function filterShiftModalSales(query) {
    _shiftModalFilterQuery = (query || '').toLowerCase().trim();
    renderShiftModalSalesTable();
}

/**
 * Closes the shift details modal.
 */
export function closeShiftDetailsModal() {
    const modal = document.getElementById('shift-details-modal');
    if (modal) modal.classList.remove('active');
    _currentModalShift = null;
}

/**
 * Prints the currently opened shift in the modal.
 */
export function printCurrentModalShift() {
    if (!_currentModalShift) return;
    _config.printCashReport(_currentModalShift);
}

/**
 * Exports the currently opened shift to a CSV file.
 */
export function exportCurrentModalShiftCSV() {
    if (!_currentModalShift) return;
    const shift = _currentModalShift;
    const sales = shift.sales || [];

    let csv = '\uFEFF'; // UTF-8 BOM
    csv += 'Turno;Codigo_Venda;Data_Hora;Operador;Forma_Pagamento;Total_Venda;Itens_Vendidos;Status\n';

    sales.forEach(s => {
        const itemsStr = (s.items || []).map(it => `${it.qty}x ${it.name}`).join(' + ');
        const dateTime = s.fullDateTime || (s.timestamp ? new Date(s.timestamp).toLocaleString('pt-BR') : '');
        const line = [
            shift.shiftCode || 'Turno',
            s.id,
            `"${sanitizeCsvField(dateTime)}"`,
            `"${sanitizeCsvField(s.operatorName || '')}"`,
            `"${sanitizeCsvField((s.paymentMethod || '').toUpperCase())}"`,
            `"${formatCurrency(s.total)}"`,
            `"${sanitizeCsvField(itemsStr).replace(/"/g, '""')}"`,
            s.status
        ].join(';');
        csv += line + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = (shift.operatorName || 'Turno').replace(/[^a-zA-Z0-9]/g, '_');
    link.download = `Vendas_Turno_${shift.shiftCode || 'T01'}_${safeName}.csv`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
}
