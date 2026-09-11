/**
 * Panobianco PDV & ERP — Dashboard Module
 * 
 * Handles ERP dashboard and analytics.
 * 
 * @module modules/dashboard
 */

import { escapeHtml, formatCurrency } from '../core/helpers.js';
import { SALE_STATUS, PAYMENT_METHODS } from '../core/constants.js';

// ── Private State ───────────────────────────
let _config = null;

// ── Configuration ───────────────────────────

/**
 * Configure this module with app-level dependencies.
 * @param {Object} config
 */
export function configureDashboard(config) {
    _config = config;
}

export function renderDashboard() {
    const state = _config.getState();
    const allSales = state.sales || [];
    const activeSales = allSales.filter(s => s.status !== SALE_STATUS.CANCELADA);
    const cancelledSales = allSales.filter(s => s.status === SALE_STATUS.CANCELADA);
    
    let grossRevenue = 0;
    let totalCost = 0;
    let unitsSold = 0;
    let productMap = {};      // nome → { qty, revenue, cost }
    let operatorMap = {};     // nome → { salesCount, revenue, cost }
    let payMap = {
        [PAYMENT_METHODS.PIX]: 0,
        [PAYMENT_METHODS.DEBITO]: 0,
        [PAYMENT_METHODS.CREDITO]: 0,
        [PAYMENT_METHODS.DINHEIRO]: 0
    };

    activeSales.forEach(sale => {
        grossRevenue += sale.total;
        totalCost += sale.cost || 0;
        
        payMap[sale.paymentMethod] = (payMap[sale.paymentMethod] || 0) + sale.total;

        // Operador
        const opName = sale.operatorName || 'Desconhecido';
        if (!operatorMap[opName]) operatorMap[opName] = { salesCount: 0, revenue: 0, cost: 0 };
        operatorMap[opName].salesCount += 1;
        operatorMap[opName].revenue += sale.total;
        operatorMap[opName].cost += sale.cost || 0;

        sale.items.forEach(it => {
            unitsSold += it.qty;
            if (!productMap[it.name]) productMap[it.name] = { qty: 0, revenue: 0, cost: 0 };
            productMap[it.name].qty += it.qty;
            productMap[it.name].revenue += it.price * it.qty;
            productMap[it.name].cost += (it.cost || 0) * it.qty;
        });
    });

    const netProfit = grossRevenue - totalCost;
    const avgMargin = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;
    const ticketMedio = activeSales.length > 0 ? grossRevenue / activeSales.length : 0;
    const cancelRate = allSales.length > 0 ? (cancelledSales.length / allSales.length) * 100 : 0;

    // KPIs Linha 1: Financeiro
    setDashEl('dash-gross-revenue', formatCurrency(grossRevenue));
    setDashEl('dash-cmv', formatCurrency(totalCost));
    setDashEl('dash-net-profit', formatCurrency(netProfit));
    setDashEl('dash-avg-margin', `${avgMargin.toFixed(1)}%`);

    // KPIs Linha 2: Operacional
    setDashEl('dash-ticket-medio', formatCurrency(ticketMedio));
    setDashEl('dash-total-sales', `${activeSales.length}`);
    setDashEl('dash-units-sold', `${unitsSold} un.`);
    setDashEl('dash-cancel-rate', `${cancelledSales.length} (${cancelRate.toFixed(0)}%)`);

    // Top 5 Produtos por Quantidade
    const topContainer = document.getElementById('dash-top-products');
    if (topContainer) {
        topContainer.innerHTML = '';
        const sortedProds = Object.entries(productMap).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5);
        
        if (sortedProds.length === 0) {
            topContainer.innerHTML = '<p style="color:#94a3b8; font-size:8.5pt;">Nenhuma venda registrada.</p>';
        } else {
            sortedProds.forEach(([name, data], index) => {
                const row = document.createElement('div');
                row.className = 'top-prod-row';
                row.innerHTML = `
                    <span><strong>#${index + 1}</strong> ${escapeHtml(name)}</span>
                    <strong style="color: #ea580c;">${data.qty} vendidos</strong>
                `;
                topContainer.appendChild(row);
            });
        }
    }

    // Pagamentos
    const payContainer = document.getElementById('dash-pay-distribution');
    if (payContainer) {
        const payTotal = Object.values(payMap).reduce((a, b) => a + b, 0);
        const pct = v => payTotal > 0 ? ` (${((v / payTotal) * 100).toFixed(0)}%)` : '';
        payContainer.innerHTML = `
            <div class="pay-dist-row"><span>💠 Pix:</span><strong>${formatCurrency(payMap[PAYMENT_METHODS.PIX] || 0)}${pct(payMap[PAYMENT_METHODS.PIX] || 0)}</strong></div>
            <div class="pay-dist-row"><span>💳 Cartão Débito:</span><strong>${formatCurrency(payMap[PAYMENT_METHODS.DEBITO] || 0)}${pct(payMap[PAYMENT_METHODS.DEBITO] || 0)}</strong></div>
            <div class="pay-dist-row"><span>💳 Cartão Crédito:</span><strong>${formatCurrency(payMap[PAYMENT_METHODS.CREDITO] || 0)}${pct(payMap[PAYMENT_METHODS.CREDITO] || 0)}</strong></div>
            <div class="pay-dist-row"><span>💵 Dinheiro:</span><strong>${formatCurrency(payMap[PAYMENT_METHODS.DINHEIRO] || 0)}${pct(payMap[PAYMENT_METHODS.DINHEIRO] || 0)}</strong></div>
        `;
    }

    // Ranking de Operadores
    const opContainer = document.getElementById('dash-operator-ranking');
    if (opContainer) {
        opContainer.innerHTML = '';
        const sortedOps = Object.entries(operatorMap).sort((a, b) => b[1].revenue - a[1].revenue);
        
        if (sortedOps.length === 0) {
            opContainer.innerHTML = '<p style="color:#94a3b8; font-size:8.5pt;">Nenhuma venda registrada.</p>';
        } else {
            sortedOps.forEach(([name, data], index) => {
                const opTicket = data.salesCount > 0 ? data.revenue / data.salesCount : 0;
                const row = document.createElement('div');
                row.className = 'top-prod-row';
                row.style.flexWrap = 'wrap';
                row.innerHTML = `
                    <span style="flex:1;"><strong>#${index + 1}</strong> ${escapeHtml(name)}</span>
                    <span style="font-size:0.85em;color:#6b7280;">${data.salesCount} vendas</span>
                    <span style="font-size:0.85em;color:#3b82f6;margin-left:8px;">Ticket: ${formatCurrency(opTicket)}</span>
                    <strong style="color:#16a34a;margin-left:8px;">${formatCurrency(data.revenue)}</strong>
                `;
                opContainer.appendChild(row);
            });
        }
    }

    // Top 5 Produtos por Lucro
    const profitContainer = document.getElementById('dash-top-profit');
    if (profitContainer) {
        profitContainer.innerHTML = '';
        const sortedByProfit = Object.entries(productMap)
            .map(([name, data]) => ({ name, profit: data.revenue - data.cost, revenue: data.revenue, qty: data.qty }))
            .sort((a, b) => b.profit - a.profit)
            .slice(0, 5);
        
        if (sortedByProfit.length === 0) {
            profitContainer.innerHTML = '<p style="color:#94a3b8; font-size:8.5pt;">Nenhuma venda registrada.</p>';
        } else {
            sortedByProfit.forEach((prod, index) => {
                const margin = prod.revenue > 0 ? ((prod.profit / prod.revenue) * 100).toFixed(0) : 0;
                const row = document.createElement('div');
                row.className = 'top-prod-row';
                row.innerHTML = `
                    <span><strong>#${index + 1}</strong> ${escapeHtml(prod.name)} <small style="color:#9ca3af;">(${prod.qty}un)</small></span>
                    <span><strong style="color:#16a34a;">${formatCurrency(prod.profit)}</strong> <small style="color:#6b7280;">${margin}%</small></span>
                `;
                profitContainer.appendChild(row);
            });
        }
    }
}

export function setDashEl(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}
