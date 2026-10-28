/**
 * Panobianco PDV & ERP — Inventory Module
 * 
 * Handles inventory visualization and restock.
 * 
 * @module modules/inventory
 */

import { escapeHtml, formatCurrency } from '../core/helpers.js';
import { getCategoryLabel, ROLES } from '../core/constants.js';

// ── Private State ───────────────────────────
let _config = null;
let _stockSearchQuery = '';

// ── Configuration ───────────────────────────
export function configureInventory(config) {
    _config = config;
}

// ── Public API ──────────────────────────────

export function filterStockTable(query) {
    _stockSearchQuery = (query || '').trim().toLowerCase();
    renderStockTable();
}

export function detectDuplicateProducts() {
    const products = _config.getState().products || [];
    const groups = {};

    const normalize = (str) => {
        return (str || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\b\d+\s*(ml|l|g|kg|mg|un|unidades|caps|doses)\b/gi, '')
            .replace(/[^\w\s]/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    };

    products.forEach(p => {
        const key = normalize(p.name);
        if (!key) return;
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
    });

    const duplicateGroups = [];
    for (const key in groups) {
        if (groups[key].length > 1) {
            duplicateGroups.push({
                normalizedKey: key,
                name: groups[key][0].name,
                items: groups[key]
            });
        }
    }

    return duplicateGroups;
}

export function renderStockTable() {
    const tbody = document.getElementById('stock-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const isAdmin = _config.getCurrentUser() && _config.getCurrentUser().role === ROLES.ADMIN;

    const thead = document.getElementById('stock-table-header');
    if (thead) {
        thead.innerHTML = `
            <th style="width: 50px;">Foto</th>
            <th>Produto</th>
            <th>Categoria</th>
            ${isAdmin ? '<th>Preço Custo</th>' : ''}
            <th>Preço Venda</th>
            ${isAdmin ? '<th>Margem</th>' : ''}
            <th>Estoque Atual</th>
            <th>Status</th>
            <th class="text-right">Ações</th>
        `;
    }

    const duplicateGroups = detectDuplicateProducts();
    const duplicatePill = document.getElementById('duplicate-alert-pill');
    const duplicateCountText = document.getElementById('duplicate-count-text');
    
    if (duplicatePill && duplicateCountText) {
        if (duplicateGroups.length > 0 && isAdmin) {
            const totalDuplicatesCount = duplicateGroups.reduce((acc, g) => acc + g.items.length, 0);
            duplicateCountText.innerText = `${duplicateGroups.length} grupo(s) (${totalDuplicatesCount} itens duplicados)`;
            duplicatePill.style.display = 'inline-flex';
        } else {
            duplicatePill.style.display = 'none';
        }
    }

    const duplicateIdSet = new Set(duplicateGroups.flatMap(g => g.items.map(i => i.id)));

    let totalProducts = (_config.getState().products || []).length;
    let criticalCount = 0;
    let totalCostValue = 0;
    let totalPotentialRevenue = 0;

    let filteredProducts = _config.getState().products || [];
    if (_stockSearchQuery) {
        filteredProducts = filteredProducts.filter(p => 
            (p.name || '').toLowerCase().includes(_stockSearchQuery) ||
            (p.category || '').toLowerCase().includes(_stockSearchQuery)
        );
    }

    (_config.getState().products || []).forEach(prod => {
        totalCostValue += prod.cost * prod.stock;
        totalPotentialRevenue += prod.price * prod.stock;
        if (prod.stock <= prod.minStock) criticalCount++;
    });

    if (filteredProducts.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="${isAdmin ? 9 : 7}" class="text-center" style="padding: 24px; color: #94a3b8;">
                    Nenhum produto encontrado com o filtro atual.
                </td>
            </tr>
        `;
    } else {
        filteredProducts.forEach(prod => {
            const margin = prod.price > 0 ? (((prod.price - prod.cost) / prod.price) * 100) : 0;
            const isDuplicate = duplicateIdSet.has(prod.id);
            const tr = document.createElement('tr');
            if (isDuplicate) tr.className = 'highlight-duplicate-tr';

            let statusBadge = `<span class="badge-status badge-ok">Normal (${prod.stock})</span>`;
            if (prod.stock <= 0) {
                statusBadge = `<span class="badge-status badge-cancel">Esgotado</span>`;
            } else if (prod.stock <= prod.minStock) {
                statusBadge = `<span class="badge-status" style="background:#fffbeb; color:#d97706;">Cr\u00edtico (${prod.stock})</span>`;
            }

            const photoCell = prod.image
                ? `<img src="${prod.image}" class="table-prod-photo-thumb" alt="${escapeHtml(prod.name)}">`
                : `<div class="table-prod-emoji-thumb">${prod.icon || '\uD83D\uDCE6'}</div>`;

            tr.innerHTML = `
                <td>${photoCell}</td>
                <td>
                    <strong>${escapeHtml(prod.name)}</strong>
                    ${isDuplicate ? '<span class="badge badge-red" style="margin-left:6px;" title="Existe outro produto com nome similar">\u26A0\uFE0F Duplicado</span>' : ''}
                </td>
                <td><span style="font-size:0.85em;font-weight:600;color:#475569;">${formatCategoryLabel(prod.category)}</span></td>
                ${isAdmin ? `<td>R\$ ${prod.cost.toFixed(2).replace('.', ',')}</td>` : ''}
                <td><strong>R\$ ${prod.price.toFixed(2).replace('.', ',')}</strong></td>
                ${isAdmin ? `<td style="color: #10b981; font-weight: 700;">${margin.toFixed(0)}%</td>` : ''}
                <td><strong>${prod.stock} un.</strong></td>
                <td>${statusBadge}</td>
                <td class="text-right">
                    <button class="btn btn-sm btn-secondary" onclick="app.openQuickPhotoModal('${prod.id}')" title="Alterar ou Remover Foto">\uD83D\uDCF7 Foto</button>
                    ${isAdmin ? `<button class="btn btn-sm btn-secondary" onclick="app.openRestockModal('${prod.id}')" title="Entrada de Estoque">\u2795 Entrada</button>` : ''}
                    ${isAdmin ? `<button class="btn btn-sm btn-secondary" onclick="app.editProduct('${prod.id}')" title="Editar Produto">\u270F\uFE0F</button>` : ''}
                    ${isAdmin ? `<button class="btn btn-sm btn-danger" onclick="app.confirmDeleteProduct('${prod.id}')" title="Excluir Produto">\uD83D\uDDD1\uFE0F</button>` : ''}
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    if (isAdmin) {
        const elTot = document.getElementById('st-total-products');
        const elCrit = document.getElementById('st-critical-count');
        const elCost = document.getElementById('st-total-cost');
        const elPot = document.getElementById('st-total-potential');

        if (elTot) elTot.innerText = totalProducts;
        if (elCrit) elCrit.innerText = criticalCount;
        if (elCost) elCost.innerText = `R\$ ${totalCostValue.toFixed(2).replace('.', ',')}`;
        if (elPot) elPot.innerText = `R\$ ${totalPotentialRevenue.toFixed(2).replace('.', ',')}`;
    }
}

export function formatCategoryLabel(cat) {
    switch ((cat || '').toLowerCase()) {
        case 'bebidas':
        case 'energeticos':
            return '\uD83E\uDD64 Bebidas & Energ\u00e9ticos';
        case 'proteicos':
            return '\uD83C\uDF6B Barrinhas & Whey';
        case 'suplementos':
            return '\uD83C\uDFCB\uFE0F Suplementos & Doses';
        case 'roupas':
        case 'vestuario':
            return '\uD83D\uDC55 Roupas & Vestu\u00e1rio';
        case 'acessorios':
            return '\uD83C\uDF92 Acess\u00f3rios & Brindes';
        default:
            return cat ? cat.toUpperCase() : '-';
    }
}

export function openRestockModal(productId) {
    if (!_config.getCurrentUser() || _config.getCurrentUser().role !== ROLES.ADMIN) {
        alert('\u26A0\uFE0F Acesso restrito: Apenas administradores podem dar entrada no estoque.');
        return;
    }
    const prod = (_config.getState().products || []).find(p => p.id === productId);
    if (!prod) return;
    document.getElementById('restock-prod-id').value = prod.id;
    document.getElementById('restock-prod-name').innerText = `Item: ${escapeHtml(prod.name)} (Estoque atual: ${prod.stock} un)`;
    document.getElementById('restock-qty').value = '';
    document.getElementById('restock-modal').classList.add('active');
}

export async function confirmRestock() {
    if (!_config.getCurrentUser() || _config.getCurrentUser().role !== ROLES.ADMIN) {
        alert('\u26A0\uFE0F Acesso restrito: Apenas administradores podem dar entrada no estoque.');
        return;
    }
    const id = document.getElementById('restock-prod-id').value;
    const qty = parseInt(document.getElementById('restock-qty').value) || 0;
    if (qty <= 0) {
        alert('\u26A0\uFE0F Digite uma quantidade v\u00e1lida para adicionar.');
        return;
    }

    if (_config.getUseSupabase()) {
        try {
            const opId = _config.getCurrentUser() ? _config.getCurrentUser().id : 'f20729';
            const opName = _config.getCurrentUser() ? `${_config.getCurrentUser().name} [${_config.getCurrentUser().code.toUpperCase()}]` : 'Luan [F20729]';
            const { restockProduct } = await import('../services/data-service.js');

            await restockProduct(id, qty, opId, opName);
            alert(`\u2705 Entrada de ${qty} unidades confirmada no Supabase Cloud!`);
            await _config.syncWithSupabase(false);
            closeRestockModal();
            _config.renderAll();
            return;
        } catch (e) {
            console.error('\u274C Erro na reposi\u00e7\u00e3o Supabase:', e);
            alert(`\u274C Erro na reposi\u00e7\u00e3o: ${e.message}`);
            return;
        }
    }

    try {
        const res = await fetch(`${_config.getApiBase()}/api/restock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: id, qty })
        });
        if (res.ok) {
            const data = await res.json();
            Object.assign(_config.getState(), data.state);
            _config.saveLocalState(data.state);
            alert(`\u2705 Entrada de ${qty} unidades confirmada em todas as m\u00e1quinas!`);
        }
    } catch (e) {
        const prod = _config.getState().products.find(p => p.id === id);
        if (prod) {
            prod.stock += qty;
            _config.saveLocalState(_config.getState());
            alert(`\u2705 Entrada de ${qty} unidades confirmada localmente!`);
        }
    }

    closeRestockModal();
    _config.renderAll();
}

export function closeRestockModal() {
    document.getElementById('restock-modal').classList.remove('active');
}

// ── Lista de Compras Inteligente para o Patrão (WhatsApp) ──

let _shoppingScope = 'critical'; // 'critical' | 'all_needed'
let _shoppingCustomQtys = {};
let _shoppingExcludedIds = new Set();

function calculateProductTurnover30d() {
    const state = _config.getState() || {};
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const turnoverByProd = {};

    (state.sales || []).forEach(sale => {
        if (sale.status === 'CANCELADA') return;
        const ts = new Date(sale.timestamp || sale.created_at || 0).getTime();
        if (ts >= thirtyDaysAgo) {
            (sale.items || []).forEach(it => {
                const pid = it.productId;
                if (pid) turnoverByProd[pid] = (turnoverByProd[pid] || 0) + (Number(it.qty) || 0);
            });
        }
    });

    (state.consumptions || []).forEach(cons => {
        if (cons.status !== 'ATIVO') return;
        const ts = new Date(cons.consumedAt || 0).getTime();
        if (ts >= thirtyDaysAgo && cons.productId) {
            turnoverByProd[cons.productId] = (turnoverByProd[cons.productId] || 0) + (Number(cons.qty) || 0);
        }
    });

    return turnoverByProd;
}

function getShoppingItemsList() {
    const products = (_config.getState().products || []).filter(p => p.active !== false && p.active !== 0);
    const turnover30d = calculateProductTurnover30d();

    const candidateItems = products.map(p => {
        const sold30d = turnover30d[p.id] || 0;
        const weeklyAvg = Math.ceil(sold30d / 4.3);
        const minStock = Number(p.minStock) || 5;
        const currentStock = Number(p.stock) || 0;

        // Meta ideal: cobrir pelo menos 2 semanas de giro ou 2x o estoque mínimo
        const targetStock = Math.max(minStock * 2, weeklyAvg * 2, 6);
        const defaultSuggestedQty = Math.max(1, targetStock - currentStock);
        const buyQty = _shoppingCustomQtys[p.id] !== undefined ? _shoppingCustomQtys[p.id] : defaultSuggestedQty;
        const isCritical = currentStock <= minStock;
        const isOut = currentStock <= 0;

        return {
            id: p.id,
            name: p.name,
            category: p.category,
            currentStock,
            minStock,
            sold30d,
            weeklyAvg,
            unitCost: Number(p.cost) || 0,
            unitPrice: Number(p.price) || 0,
            buyQty,
            subtotalCost: buyQty * (Number(p.cost) || 0),
            isOut,
            isCritical,
            included: !_shoppingExcludedIds.has(p.id)
        };
    });

    const filtered = candidateItems.filter(item => {
        if (_shoppingScope === 'critical') {
            return item.isOut || item.isCritical;
        }
        return item.isOut || item.isCritical || item.weeklyAvg > 0;
    });

    // Ordenar: Esgotados primeiro -> Críticos -> Maior giro semanal
    filtered.sort((a, b) => {
        if (a.isOut !== b.isOut) return a.isOut ? -1 : 1;
        if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
        return b.sold30d - a.sold30d;
    });

    return filtered;
}

function buildShoppingWhatsAppText(items) {
    const selected = items.filter(i => i.included && i.buyQty > 0);
    const dateStr = new Date().toLocaleDateString('pt-BR');
    const outItems = selected.filter(i => i.isOut);
    const lowItems = selected.filter(i => !i.isOut);

    const totalUnits = selected.reduce((s, i) => s + i.buyQty, 0);
    const totalCost = selected.reduce((s, i) => s + i.subtotalCost, 0);

    const lines = [];
    lines.push(`🛒 *LISTA DE COMPRAS & REPOSIÇÃO — PDV PANOBIANCO*`);
    lines.push(`📅 _Gerada em ${dateStr}_`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);

    if (selected.length === 0) {
        lines.push(`✅ Nenhum item selecionado para reposição.`);
        return lines.join('\n');
    }

    if (outItems.length > 0) {
        lines.push(`\n🚨 *ESGOTADOS / URGENTE (${outItems.length} itens):*`);
        outItems.forEach(i => {
            const costInfo = i.unitCost > 0 ? ` — Est. ${formatCurrency(i.subtotalCost)} (${formatCurrency(i.unitCost)}/un)` : '';
            lines.push(`• *${i.buyQty} un* — ${i.name} _(Estoque: 0 un | Giro: ~${i.weeklyAvg}/sem)_${costInfo}`);
        });
    }

    if (lowItems.length > 0) {
        lines.push(`\n⚠️ *ESTOQUE BAIXO / REPOSIÇÃO (${lowItems.length} itens):*`);
        lowItems.forEach(i => {
            const costInfo = i.unitCost > 0 ? ` — Est. ${formatCurrency(i.subtotalCost)} (${formatCurrency(i.unitCost)}/un)` : '';
            lines.push(`• *${i.buyQty} un* — ${i.name} _(Restam: ${i.currentStock} un | Giro: ~${i.weeklyAvg}/sem)_${costInfo}`);
        });
    }

    lines.push(`\n━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`📦 *Total a Comprar:* ${selected.length} produtos (${totalUnits} unidades)`);
    lines.push(`💰 *Custo Total Estimado:* *${formatCurrency(totalCost)}*`);

    return lines.join('\n');
}

export function openShoppingListModal() {
    if (!_config.getCurrentUser() || _config.getCurrentUser().role !== ROLES.ADMIN) {
        alert('⚠️ Acesso restrito: Apenas administradores podem gerar a lista de compras.');
        return;
    }
    _shoppingCustomQtys = {};
    _shoppingExcludedIds = new Set();
    _shoppingScope = 'critical';
    renderShoppingListModal();
    const modal = document.getElementById('shopping-list-modal');
    if (modal) modal.classList.add('active');
}

export function closeShoppingListModal() {
    const modal = document.getElementById('shopping-list-modal');
    if (modal) modal.classList.remove('active');
}

export function setShoppingListScope(scope) {
    _shoppingScope = scope;
    renderShoppingListModal();
}

export function toggleShoppingItem(productId) {
    if (_shoppingExcludedIds.has(productId)) {
        _shoppingExcludedIds.delete(productId);
    } else {
        _shoppingExcludedIds.add(productId);
    }
    renderShoppingListModal();
}

export function updateShoppingItemQty(productId, rawVal) {
    const qty = Math.max(0, parseInt(rawVal) || 0);
    _shoppingCustomQtys[productId] = qty;
    if (qty === 0) _shoppingExcludedIds.add(productId);
    else _shoppingExcludedIds.delete(productId);
    renderShoppingListModal();
}

export function renderShoppingListModal() {
    const items = getShoppingItemsList();
    const tbody = document.getElementById('shopping-list-tbody');
    const previewEl = document.getElementById('shopping-list-wa-preview');
    const totalCostEl = document.getElementById('shopping-list-total-cost');
    const totalItemsEl = document.getElementById('shopping-list-total-items');
    const btnCrit = document.getElementById('btn-shop-scope-crit');
    const btnAll = document.getElementById('btn-shop-scope-all');

    if (btnCrit) btnCrit.className = `btn btn-sm ${_shoppingScope === 'critical' ? 'btn-primary' : 'btn-secondary'}`;
    if (btnAll) btnAll.className = `btn btn-sm ${_shoppingScope === 'all_needed' ? 'btn-primary' : 'btn-secondary'}`;

    const selected = items.filter(i => i.included && i.buyQty > 0);
    const totalCost = selected.reduce((s, i) => s + i.subtotalCost, 0);
    const totalUnits = selected.reduce((s, i) => s + i.buyQty, 0);

    if (totalCostEl) totalCostEl.textContent = formatCurrency(totalCost);
    if (totalItemsEl) totalItemsEl.textContent = `${selected.length} produtos (${totalUnits} un)`;

    if (tbody) {
        if (items.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center" style="padding: 20px; color: #64748b;">
                        🎉 Nenhum produto em estado crítico no momento! Clique em "Todos com Giro" se quiser planejar compra antecipada.
                    </td>
                </tr>
            `;
        } else {
            tbody.innerHTML = items.map(item => `
                <tr style="${!item.included ? 'opacity: 0.45;' : ''}">
                    <td style="text-align: center;">
                        <input type="checkbox" ${item.included ? 'checked' : ''} onchange="app.toggleShoppingItem('${item.id}')" style="cursor: pointer; width: 16px; height: 16px;">
                    </td>
                    <td>
                        <strong>${escapeHtml(item.name)}</strong><br>
                        <small style="color: #64748b;">Giro 30d: ${item.sold30d} un (~${item.weeklyAvg}/sem)</small>
                    </td>
                    <td>
                        ${item.isOut 
                            ? `<span class="badge-status badge-cancel">Esgotado (0)</span>` 
                            : `<span class="badge-status" style="background:#fffbeb; color:#d97706;">${item.currentStock} un (Mín: ${item.minStock})</span>`}
                    </td>
                    <td>
                        <input type="number" min="0" value="${item.buyQty}" 
                            onchange="app.updateShoppingItemQty('${item.id}', this.value)"
                            style="width: 72px; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-weight: 700; text-align: center;">
                    </td>
                    <td>${formatCurrency(item.unitCost)}</td>
                    <td style="font-weight: 800; color: #0f172a;">${formatCurrency(item.subtotalCost)}</td>
                </tr>
            `).join('');
        }
    }

    if (previewEl) {
        previewEl.value = buildShoppingWhatsAppText(items);
    }
}

export function copyShoppingListWhatsApp() {
    const previewEl = document.getElementById('shopping-list-wa-preview');
    if (!previewEl || !previewEl.value) return;
    navigator.clipboard.writeText(previewEl.value);
    alert('📋 Lista de compras copiada para a área de transferência! Agora é só colar no WhatsApp do Patrão.');
}

export function sendShoppingListWhatsApp() {
    const previewEl = document.getElementById('shopping-list-wa-preview');
    if (!previewEl || !previewEl.value) return;
    const url = `https://wa.me/?text=${encodeURIComponent(previewEl.value)}`;
    window.open(url, '_blank');
}
