/**
 * Panobianco PDV & ERP — Reports Module
 * 
 * Handles EVO print sheet and cash report generation.
 * 
 * @module modules/reports
 */

import { escapeHtml } from '../core/helpers.js';
import { SALE_STATUS, PAYMENT_METHODS } from '../core/constants.js';

// ── Private State ───────────────────────────
let _config = null;

// ── Configuration ───────────────────────────

/**
 * Configure this module with app-level dependencies.
 * @param {Object} config
 */
export function configureReports(config) {
    _config = config;
}

// ── Public API ──────────────────────────────

/**
 * Renders the EVO print sheet for a given shift.
 * @param {Object|null} targetShift - The shift to print. Defaults to the active shift.
 */
export function renderEvoPrintSheet(targetShift = null) {
    const sheet = document.getElementById('evo-print-sheet');
    if (!sheet) return;

    const isPastShift = !!targetShift;
    const shift = targetShift || _config.getState().activeShift || {};
    const shiftSales = (shift.sales || []).filter(s => s.status !== SALE_STATUS.CANCELADA && s.status !== 'CANCELADA');
    
    let pixTotal = 0, pixCount = 0;
    let debitTotal = 0, debitCount = 0;
    let creditTotal = 0, creditCount = 0;
    let cashTotal = 0, cashCount = 0;

    shiftSales.forEach(s => {
        const tot = Number(s.total) || 0;
        if (s.paymentMethod === PAYMENT_METHODS.PIX || s.paymentMethod === 'pix') {
            pixTotal += tot;
            pixCount++;
        } else if (s.paymentMethod === PAYMENT_METHODS.DEBITO || s.paymentMethod === 'cartao_debito') {
            debitTotal += tot;
            debitCount++;
        } else if (s.paymentMethod === PAYMENT_METHODS.CREDITO || s.paymentMethod === 'cartao_credito' || s.paymentMethod === 'cartao') {
            creditTotal += tot;
            creditCount++;
        } else if (s.paymentMethod === PAYMENT_METHODS.DINHEIRO || s.paymentMethod === 'dinheiro') {
            cashTotal += tot;
            cashCount++;
        }
    });

    const grossTotal = pixTotal + debitTotal + creditTotal + cashTotal;
    const totalVendas = shiftSales.length;

    const countedCashVal = isPastShift 
        ? (Number(shift.countedCash) || 0)
        : (parseFloat(document.getElementById('blind-cash-input')?.value) || 0);
    const diffVal = isPastShift 
        ? (Number(shift.diff) || 0)
        : (countedCashVal - cashTotal);

    let diffStatus = 'CONFERIDO / SEM DIVERGÊNCIA';
    if (diffVal > 0.05) diffStatus = `SOBRA DE R$ ${diffVal.toFixed(2).replace('.', ',')}`;
    else if (diffVal < -0.05) diffStatus = `FALTA DE R$ ${Math.abs(diffVal).toFixed(2).replace('.', ',')}`;

    const cardPixSlips = shiftSales.filter(s => s.paymentMethod !== PAYMENT_METHODS.DINHEIRO && s.paymentMethod !== 'dinheiro');
    
    const slipsRowsHtml = cardPixSlips.length === 0 
        ? '<tr><td colspan="6" class="text-center" style="padding: 8px;">Nenhuma via de cartão/Pix registrada neste turno.</td></tr>'
        : cardPixSlips.map(s => {
            const itemsText = escapeHtml((s.items || []).map(it => `${it.qty}x ${it.name}`).join(', '));
            const payLabel = escapeHtml((s.paymentMethod || '').toUpperCase().replace('_', ' '));
            return `
                <tr>
                    <td class="text-center" style="font-weight: bold; width: 35px;">[ ]</td>
                    <td><strong>${escapeHtml(String(s.id))}</strong></td>
                    <td>${escapeHtml(s.dateFormatted || (s.timestamp ? new Date(s.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-'))}</td>
                    <td><strong>${payLabel}</strong></td>
                    <td><small>${itemsText}</small></td>
                    <td class="text-right"><strong>R$ ${Number(s.total).toFixed(2).replace('.', ',')}</strong></td>
                </tr>
            `;
        }).join('');

    const currentUser = _config.getCurrentUser();
    const currentOpName = isPastShift 
        ? (shift.operatorName || 'Operador') 
        : (currentUser ? `${currentUser.name} [${currentUser.code.toUpperCase()}]` : (shift.operatorName || 'Operador'));
        
    const startTimeStr = shift.startTime ? new Date(shift.startTime).toLocaleString('pt-BR') : '-';
    const endTimeStr = shift.endTime ? new Date(shift.endTime).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR');
    const nowStr = new Date().toLocaleString('pt-BR');

    sheet.innerHTML = `
        <div class="evo-receipt">
            <div class="evo-receipt-header">
                <h2>PANOBIANCO ACADEMIAS — CONTROLE DE LOJINHA & PDV</h2>
                <h3>COMPROVANTE DE FECHAMENTO DE TURNO / ESPELHO DE CAIXA</h3>
                <div class="divider-double"></div>
            </div>

            <div class="evo-meta-grid">
                <div><strong>Unidade:</strong> Panobianco Academias</div>
                <div><strong>Data/Hora Emissão:</strong> ${escapeHtml(nowStr)}</div>
                <div><strong>Código do Turno:</strong> ${escapeHtml(shift.shiftCode || 'T01')}${isPastShift ? ' (REIMPRESSÃO)' : ''}</div>
                <div><strong>Operador do Turno:</strong> ${escapeHtml(currentOpName)}</div>
                <div><strong>Abertura do Turno:</strong> ${escapeHtml(startTimeStr)}</div>
                <div><strong>Fechamento / Emissão:</strong> ${escapeHtml(endTimeStr)}</div>
            </div>

            <div class="divider-line"></div>
            <div class="evo-section-title">1. RESUMO FINANCEIRO DO TURNO POR FORMA DE PAGAMENTO</div>
            <table class="evo-print-table">
                <thead>
                    <tr>
                        <th>Forma de Pagamento</th>
                        <th class="text-center" style="width: 100px;">Qtd Vendas</th>
                        <th class="text-right" style="width: 160px;">Valor Total (R$)</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>DINHEIRO (Espécie / Gaveta)</td>
                        <td class="text-center">${cashCount}</td>
                        <td class="text-right">R$ ${cashTotal.toFixed(2).replace('.', ',')}</td>
                    </tr>
                    <tr>
                        <td>CARTÃO DE DÉBITO</td>
                        <td class="text-center">${debitCount}</td>
                        <td class="text-right">R$ ${debitTotal.toFixed(2).replace('.', ',')}</td>
                    </tr>
                    <tr>
                        <td>CARTÃO DE CRÉDITO</td>
                        <td class="text-center">${creditCount}</td>
                        <td class="text-right">R$ ${creditTotal.toFixed(2).replace('.', ',')}</td>
                    </tr>
                    <tr>
                        <td>PIX</td>
                        <td class="text-center">${pixCount}</td>
                        <td class="text-right">R$ ${pixTotal.toFixed(2).replace('.', ',')}</td>
                    </tr>
                </tbody>
                <tfoot>
                    <tr class="evo-table-total">
                        <th>TOTAL GERAL BRUTO DO TURNO</th>
                        <th class="text-center">${totalVendas}</th>
                        <th class="text-right">R$ ${grossTotal.toFixed(2).replace('.', ',')}</th>
                    </tr>
                </tfoot>
            </table>

            <div class="divider-line"></div>
            <div class="evo-section-title">2. CONFERÊNCIA DA GAVETA DE DINHEIRO (CONTAGEM FÍSICA)</div>
            <table class="evo-print-table">
                <tr>
                    <td style="width: 70%;">Valor Contado pelo Operador em Espécie (Gaveta):</td>
                    <td class="text-right"><strong>R$ ${countedCashVal.toFixed(2).replace('.', ',')}</strong></td>
                </tr>
                <tr>
                    <td>Valor Registrado no Sistema (Vendas em Dinheiro):</td>
                    <td class="text-right"><strong>R$ ${cashTotal.toFixed(2).replace('.', ',')}</strong></td>
                </tr>
                <tr>
                    <td>Diferença de Caixa Apurada:</td>
                    <td class="text-right"><strong>R$ ${diffVal.toFixed(2).replace('.', ',')} (${escapeHtml(diffStatus)})</strong></td>
                </tr>
            </table>

            <div class="divider-line"></div>
            <div class="evo-section-title">3. VIAS DE CARTÃO / PIX PARA GRAMPEAR NO FECHAMENTO DO SISTEMA EVO</div>
            <p class="evo-instruction">
                Instrução de Auditoria: Confira cada filipeta impressa da maquininha com a lista abaixo, marque [x] e grampeie junto ao fechamento de caixa do EVO.
            </p>
            <table class="evo-print-table">
                <thead>
                    <tr>
                        <th style="width: 35px;" class="text-center">[ ]</th>
                        <th style="width: 80px;">Nº Venda</th>
                        <th style="width: 70px;">Horário</th>
                        <th style="width: 120px;">Forma Pagto</th>
                        <th>Itens Vendidos</th>
                        <th class="text-right" style="width: 100px;">Valor (R$)</th>
                    </tr>
                </thead>
                <tbody>
                    ${slipsRowsHtml}
                </tbody>
                <tfoot>
                    <tr class="evo-table-total">
                        <th colspan="5">TOTAL DE COMPROVANTES FÍSICOS DE CARTÃO/PIX A GRAMPEAR</th>
                        <th class="text-right">${cardPixSlips.length} via(s)</th>
                    </tr>
                </tfoot>
            </table>

            <div class="evo-signatures">
                <div class="sig-block">
                    <div class="sig-line"></div>
                    <p><strong>Assinatura do Operador</strong><br><small>${escapeHtml(currentOpName)}</small></p>
                </div>
                <div class="sig-block">
                    <div class="sig-line"></div>
                    <p><strong>Assinatura do Supervisor / Gerência</strong><br><small>Conferência de Caixa Panobianco</small></p>
                </div>
            </div>

            <div class="evo-receipt-footer">
                Documento de Auditoria e Controle Interno &mdash; Panobianco Academias | Sistema PDV & Mini-ERP v3.0
            </div>
        </div>
    `;
}

/**
 * Prints the cash report for a given shift.
 * @param {Object|null} targetShift - The shift to print. Defaults to the active shift.
 */
export function printCashReport(targetShift = null) {
    renderEvoPrintSheet(targetShift);
    window.print();
}
