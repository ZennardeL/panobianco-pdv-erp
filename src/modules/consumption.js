/**
 * Panobianco PDV & ERP — Módulo de Consumo Interno & Vales
 * 
 * Gerencia retiradas e baixas de estoque que não passam pelo caixa de vendas:
 * - Retiradas de Sócios / Diretoria / Patrão (uso pessoal/cortesia)
 * - Vales de Colaboradores (para desconto em folha / pagar no salário / acerto avulso)
 * - Uso Interno da Academia / Avarias
 * 
 * Regra: Acesso estrito a ADMINISTRADORES.
 * Não gera receita no caixa nem afeta o fechamento de turnos/EVO.
 * 
 * @module modules/consumption
 */

import { escapeHtml, formatCurrency, formatDateTime, sanitizeCsvField } from '../core/helpers.js';
import { ROLES } from '../core/constants.js';

// ── Estado Privado ───────────────────────────
let _config = null;
let _periodFilter = 'all';      // 'all' | 'month' | 'today'
let _typeFilter = 'all';        // 'all' | 'DIRETORIA' | 'FUNCIONARIO' | 'USO_INTERNO'
let _paymentFilter = 'all';     // 'all' | 'PENDENTE' | 'PAGO'
let _userFilter = 'all';        // 'all' | userId / name
let _searchQuery = '';
let _pendingPaymentModalData = null; // { ids: [], beneficiaryName: '', totalValue: 0, itemsSummary: '' }

// ── Helpers de Formatação ────────────────────
export function formatPaymentMethodLabel(method) {
    const map = {
        'DINHEIRO': '💵 Dinheiro',
        'PIX': '⚡ Pix',
        'CARTAO_DEBITO': '💳 Débito',
        'CARTAO_CREDITO': '💳 Crédito',
        'FOLHA': '📑 Folha / Salário'
    };
    return map[method] || method || '—';
}

// ── Configuração ─────────────────────────────
export function configureConsumption(config) {
    _config = config;
}

// ── Helpers de Validação ─────────────────────
function checkAdminAccess() {
    const user = _config?.getCurrentUser();
    if (!user || user.role !== ROLES.ADMIN) {
        alert('⚠️ Acesso restrito: Apenas administradores têm permissão para registrar ou gerenciar baixas e quitações de consumo.');
        return false;
    }
    return true;
}

// ── Alternância de Tipo de Beneficiário ──────
export function setConsumptionType(type) {
    const radioDiretoria = document.getElementById('cons-type-diretoria');
    const radioFuncionario = document.getElementById('cons-type-funcionario');
    const radioUsoInterno = document.getElementById('cons-type-interno');

    if (radioDiretoria) radioDiretoria.checked = (type === 'DIRETORIA');
    if (radioFuncionario) radioFuncionario.checked = (type === 'FUNCIONARIO');
    if (radioUsoInterno) radioUsoInterno.checked = (type === 'USO_INTERNO');

    const wrapperFuncionario = document.getElementById('cons-wrapper-funcionario');
    const wrapperDiretoria = document.getElementById('cons-wrapper-diretoria');
    const wrapperCustom = document.getElementById('cons-wrapper-custom');

    if (type === 'FUNCIONARIO') {
        if (wrapperFuncionario) wrapperFuncionario.style.display = 'block';
        if (wrapperDiretoria) wrapperDiretoria.style.display = 'none';
        if (wrapperCustom) wrapperCustom.style.display = 'none';
    } else if (type === 'DIRETORIA') {
        if (wrapperFuncionario) wrapperFuncionario.style.display = 'none';
        if (wrapperDiretoria) wrapperDiretoria.style.display = 'block';
        if (wrapperCustom) wrapperCustom.style.display = 'none';
    } else {
        if (wrapperFuncionario) wrapperFuncionario.style.display = 'none';
        if (wrapperDiretoria) wrapperDiretoria.style.display = 'none';
        if (wrapperCustom) wrapperCustom.style.display = 'block';
    }
}

export function selectDiretoriaBeneficiary(name) {
    const customInput = document.getElementById('cons-diretoria-custom-name');
    if (customInput) {
        customInput.value = name;
    }
    document.querySelectorAll('.diretoria-quick-btn').forEach(btn => {
        btn.classList.toggle('active', btn.innerText.includes(name));
    });
}

// ── Atualização do Produto Selecionado ───────
export function onConsumptionProductChange() {
    const select = document.getElementById('cons-product-select');
    if (!select) return;

    const productId = select.value;
    const products = _config?.getState()?.products || [];
    const prod = products.find(p => p.id === productId);

    const priceInput = document.getElementById('cons-unit-price');
    const stockInfo = document.getElementById('cons-stock-available-info');
    const qtyInput = document.getElementById('cons-qty');

    if (prod) {
        if (priceInput) priceInput.value = prod.price.toFixed(2);
        if (stockInfo) {
            stockInfo.innerHTML = `Disponível em estoque: <strong>${prod.stock} un</strong>`;
            stockInfo.style.color = prod.stock > 0 ? '#10b981' : '#ef4444';
        }
        if (qtyInput) {
            qtyInput.max = Math.max(1, prod.stock);
            if (parseInt(qtyInput.value) > prod.stock) qtyInput.value = Math.max(1, prod.stock);
        }
    } else {
        if (priceInput) priceInput.value = '';
        if (stockInfo) stockInfo.innerText = '';
    }
}

// ── Submissão do Registro de Consumo ─────────
export async function submitConsumption() {
    if (!checkAdminAccess()) return;

    const typeRadio = document.querySelector('input[name="cons-type"]:checked');
    const type = typeRadio ? typeRadio.value : 'DIRETORIA';

    let beneficiaryName = '';
    let beneficiaryUserId = null;

    if (type === 'FUNCIONARIO') {
        const userSelect = document.getElementById('cons-employee-select');
        if (!userSelect || !userSelect.value) {
            alert('⚠️ Selecione o colaborador que está retirando o produto para desconto em folha.');
            return;
        }
        beneficiaryUserId = userSelect.value;
        const selectedOption = userSelect.options[userSelect.selectedIndex];
        beneficiaryName = selectedOption ? selectedOption.getAttribute('data-name') : 'Colaborador';
    } else if (type === 'DIRETORIA') {
        const customInput = document.getElementById('cons-diretoria-custom-name');
        beneficiaryName = customInput ? customInput.value.trim() : '';
        if (!beneficiaryName) {
            alert('⚠️ Indique quem da diretoria/proprietários retirou o produto (ex: Lucianna, Juliano).');
            return;
        }
    } else {
        const customName = document.getElementById('cons-custom-dest-name');
        beneficiaryName = customName ? customName.value.trim() : 'Uso Interno Academia';
    }

    const prodSelect = document.getElementById('cons-product-select');
    const productId = prodSelect ? prodSelect.value : '';
    if (!productId) {
        alert('⚠️ Selecione o produto que foi retirado.');
        return;
    }

    const qtyInput = document.getElementById('cons-qty');
    const qty = parseInt(qtyInput ? qtyInput.value : 1) || 1;
    if (qty <= 0) {
        alert('⚠️ Informe uma quantidade válida (mínimo 1).');
        return;
    }

    const priceInput = document.getElementById('cons-unit-price');
    const unitPrice = parseFloat(priceInput ? priceInput.value : 0) || 0;

    const dateInput = document.getElementById('cons-date');
    const consumedAt = (dateInput && dateInput.value) 
        ? new Date(dateInput.value).toISOString() 
        : new Date().toISOString();

    const notesInput = document.getElementById('cons-notes');
    const notes = notesInput ? notesInput.value.trim() : '';

    const currentUser = _config.getCurrentUser();
    const opId = currentUser ? currentUser.id : 'f20729';
    const opName = currentUser ? `${currentUser.name} [${currentUser.code.toUpperCase()}]` : 'Luan [F20729]';

    const confirmMsg = `📋 CONFIRMAR BAIXA DE CONSUMO INTERNO?\n\n` +
        `• Destinatário: ${beneficiaryName} (${type === 'DIRETORIA' ? 'Sócios / Patrão' : (type === 'FUNCIONARIO' ? 'Vale Colaborador' : 'Uso Interno')})\n` +
        `• Quantidade: ${qty} unidade(s)\n` +
        `• Valor Unitário: R$ ${unitPrice.toFixed(2).replace('.', ',')}\n` +
        `• Total: R$ ${(unitPrice * qty).toFixed(2).replace('.', ',')}\n\n` +
        `ℹ️ O estoque do produto será baixado imediatamente. Esta baixa NÃO entra no caixa nem no faturamento de vendas.${type === 'FUNCIONARIO' ? '\nO status ficará como PENDENTE de pagamento até acerto posterior.' : ''}`;

    if (!confirm(confirmMsg)) return;

    try {
        const { createInternalConsumption } = await import('../services/data-service.js');
        const res = await createInternalConsumption({
            type,
            beneficiaryName,
            beneficiaryUserId,
            productId,
            qty,
            unitPrice,
            notes,
            consumedAt,
            operatorId: opId,
            operatorName: opName
        });

        alert(`✅ Baixa registrada com sucesso!\nEstoque atualizado para ${res.newStock} un.`);
        
        // Resetar campos
        if (notesInput) notesInput.value = '';
        if (qtyInput) qtyInput.value = '1';
        
        await _config.syncWithSupabase(false);
        _config.renderAll();
    } catch (err) {
        console.error('❌ Erro ao registrar consumo:', err);
        alert(`❌ Erro ao registrar baixa: ${err.message || err}`);
    }
}

// ── Estorno de Baixa ─────────────────────────
export async function cancelConsumptionRecord(consumptionId) {
    if (!checkAdminAccess()) return;

    const reason = prompt('⚠️ Digite o motivo do estorno desta baixa (o estoque será devolvido ao produto):', 'Erro de digitação');
    if (!reason || !reason.trim()) return;

    const currentUser = _config.getCurrentUser();
    const opId = currentUser ? currentUser.id : 'f20729';
    const opName = currentUser ? `${currentUser.name} [${currentUser.code.toUpperCase()}]` : 'Luan [F20729]';

    try {
        const { cancelInternalConsumption } = await import('../services/data-service.js');
        await cancelInternalConsumption(consumptionId, reason.trim(), opId, opName);

        alert('✅ Baixa estornada com sucesso! O estoque foi devolvido ao catálogo.');
        await _config.syncWithSupabase(false);
        _config.renderAll();
    } catch (err) {
        console.error('❌ Erro no estorno de consumo:', err);
        alert(`❌ Erro ao estornar: ${err.message || err}`);
    }
}

// ── Modal & Quitação de Pagamento de Vales ───

export function openConsumptionPaymentModal(id) {
    if (!checkAdminAccess()) return;
    const state = _config?.getState() || {};
    const item = (state.consumptions || []).find(c => c.id === id);
    if (!item) {
        alert('Vale não encontrado.');
        return;
    }

    _pendingPaymentModalData = {
        ids: [item.id],
        beneficiaryName: item.beneficiaryName,
        totalValue: item.totalValue,
        itemsSummary: `1 item: ${item.qty}x ${item.productName} (${formatCurrency(item.totalValue)})`
    };

    populateAndShowPaymentModal();
}

export function openBatchPaymentModal(beneficiaryName) {
    if (!checkAdminAccess()) return;
    const state = _config?.getState() || {};
    const pendingItems = (state.consumptions || []).filter(c => 
        c.status === 'ATIVO' && 
        c.type === 'FUNCIONARIO' && 
        c.paymentStatus === 'PENDENTE' && 
        c.beneficiaryName.toLowerCase() === beneficiaryName.toLowerCase()
    );

    if (!pendingItems.length) {
        alert(`Não há vales pendentes para ${beneficiaryName}.`);
        return;
    }

    const totalValue = pendingItems.reduce((acc, c) => acc + c.totalValue, 0);
    const itemsSummary = `${pendingItems.length} itens: ` + 
        pendingItems.map(c => `${c.qty}x ${c.productName} (${formatCurrency(c.totalValue)})`).join(', ');

    _pendingPaymentModalData = {
        ids: pendingItems.map(c => c.id),
        beneficiaryName: pendingItems[0].beneficiaryName,
        totalValue,
        itemsSummary
    };

    populateAndShowPaymentModal();
}

function populateAndShowPaymentModal() {
    if (!_pendingPaymentModalData) return;

    const modal = document.getElementById('modal-consumption-payment');
    if (!modal) return;

    const elBeneficiary = document.getElementById('modal-pay-beneficiary');
    const elItemsSummary = document.getElementById('modal-pay-items-summary');
    const elTotalValue = document.getElementById('modal-pay-total-value');
    const dateInput = document.getElementById('modal-pay-date');
    const notesInput = document.getElementById('modal-pay-notes');
    const methodSelect = document.getElementById('modal-pay-method');

    if (elBeneficiary) elBeneficiary.textContent = _pendingPaymentModalData.beneficiaryName;
    if (elItemsSummary) elItemsSummary.textContent = _pendingPaymentModalData.itemsSummary;
    if (elTotalValue) elTotalValue.textContent = formatCurrency(_pendingPaymentModalData.totalValue);

    if (dateInput) {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        dateInput.value = now.toISOString().slice(0, 16);
    }
    if (notesInput) notesInput.value = '';
    if (methodSelect) methodSelect.value = 'DINHEIRO';

    modal.classList.add('active');
}

export function closeConsumptionPaymentModal() {
    const modal = document.getElementById('modal-consumption-payment');
    if (modal) modal.classList.remove('active');
    _pendingPaymentModalData = null;
}

export async function confirmConsumptionPayment() {
    if (!checkAdminAccess()) return;
    if (!_pendingPaymentModalData || !_pendingPaymentModalData.ids.length) {
        alert('Nenhum vale selecionado para confirmação.');
        return;
    }

    const methodSelect = document.getElementById('modal-pay-method');
    const paymentMethod = methodSelect ? methodSelect.value : 'DINHEIRO';

    const dateInput = document.getElementById('modal-pay-date');
    const paidAt = (dateInput && dateInput.value) 
        ? new Date(dateInput.value).toISOString() 
        : new Date().toISOString();

    const notesInput = document.getElementById('modal-pay-notes');
    const paymentNotes = notesInput ? notesInput.value.trim() : '';

    const currentUser = _config.getCurrentUser();
    const opId = currentUser ? currentUser.id : 'f20729';
    const opName = currentUser ? `${currentUser.name} [${currentUser.code.toUpperCase()}]` : 'Luan [F20729]';

    const count = _pendingPaymentModalData.ids.length;
    const totalStr = formatCurrency(_pendingPaymentModalData.totalValue);
    const benef = _pendingPaymentModalData.beneficiaryName;

    try {
        const { settleConsumptionPayment } = await import('../services/data-service.js');
        await settleConsumptionPayment({
            consumptionIds: _pendingPaymentModalData.ids,
            paymentMethod,
            paidAt,
            operatorId: opId,
            operatorName: opName,
            paymentNotes
        });

        closeConsumptionPaymentModal();
        alert(`✅ Pagamento confirmado com sucesso!\n\n${count} vale(s) de ${benef} (${totalStr}) quitado(s) via ${formatPaymentMethodLabel(paymentMethod)}.`);

        await _config.syncWithSupabase(false);
        _config.renderAll();
    } catch (err) {
        console.error('❌ Erro ao confirmar pagamento de vale:', err);
        alert(`❌ Erro ao confirmar pagamento: ${err.message || err}`);
    }
}

export async function undoConsumptionPayment(consumptionId) {
    if (!checkAdminAccess()) return;

    const reason = prompt('⚠️ Digite o motivo do estorno do pagamento (o vale voltará a constar como PENDENTE):', 'Recebimento lançado por engano');
    if (!reason || !reason.trim()) return;

    const currentUser = _config.getCurrentUser();
    const opId = currentUser ? currentUser.id : 'f20729';
    const opName = currentUser ? `${currentUser.name} [${currentUser.code.toUpperCase()}]` : 'Luan [F20729]';

    try {
        const { undoConsumptionPayment } = await import('../services/data-service.js');
        await undoConsumptionPayment(consumptionId, reason.trim(), opId, opName);

        alert('✅ Recebimento estornado com sucesso! O vale voltou para o status PENDENTE.');
        await _config.syncWithSupabase(false);
        _config.renderAll();
    } catch (err) {
        console.error('❌ Erro ao estornar pagamento:', err);
        alert(`❌ Erro ao estornar pagamento: ${err.message || err}`);
    }
}

// ── Filtros do Histórico ─────────────────────
export function setConsumptionPeriodFilter(period) {
    _periodFilter = period;
    document.querySelectorAll('.cons-period-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-period') === period);
    });
    renderConsumptionModule();
}

export function setConsumptionTypeFilter(type) {
    _typeFilter = type;
    document.querySelectorAll('.cons-type-filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-type') === type);
    });
    renderConsumptionModule();
}

export function setConsumptionPaymentFilter(status) {
    _paymentFilter = status;
    document.querySelectorAll('.cons-payment-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-payment') === status);
    });
    renderConsumptionModule();
}

export function setConsumptionUserFilter(userId) {
    _userFilter = userId;
    renderConsumptionModule();
}

export function searchConsumptions(query) {
    _searchQuery = (query || '').toLowerCase().trim();
    renderConsumptionModule();
}

// ── Exportação CSV ───────────────────────────
export function exportConsumptionsCSV() {
    if (!checkAdminAccess()) return;

    const consumptions = getFilteredConsumptions();
    if (consumptions.length === 0) {
        alert('Nenhum registro encontrado para exportar com os filtros atuais.');
        return;
    }

    const headers = [
        'ID', 'Data', 'Tipo', 'Beneficiário', 'Produto', 'Qtd', 
        'Preço Unitário', 'Valor Total', 'Status Pgto', 'Meio Pgto', 
        'Data Pgto', 'Recebido Por', 'Operador Baixa', 'Status Baixa', 'Observações'
    ];
    const rows = consumptions.map(c => [
        c.id,
        c.fullDateTime || c.dateFormatted,
        c.type === 'DIRETORIA' ? 'Sócios / Patrão' : (c.type === 'FUNCIONARIO' ? 'Vale Colaborador' : 'Uso Interno'),
        c.beneficiaryName,
        c.productName,
        c.qty,
        c.unitPrice.toFixed(2).replace('.', ','),
        c.totalValue.toFixed(2).replace('.', ','),
        c.paymentStatus || '—',
        c.paymentMethod ? formatPaymentMethodLabel(c.paymentMethod) : '—',
        c.paidAt ? new Date(c.paidAt).toLocaleString('pt-BR') : '—',
        c.paidOperatorName || '—',
        c.operatorName,
        c.status,
        c.notes || ''
    ]);

    let csvContent = '\uFEFF' + headers.map(sanitizeCsvField).join(';') + '\n';
    rows.forEach(r => {
        csvContent += r.map(sanitizeCsvField).join(';') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `consumo_vales_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

// ── Filtragem de Dados ───────────────────────
function getFilteredConsumptions() {
    const state = _config?.getState() || {};
    let list = state.consumptions || [];

    // Filtro de período
    const now = new Date();
    if (_periodFilter === 'today') {
        const todayStr = now.toLocaleDateString('pt-BR');
        list = list.filter(c => c.dateFormatted === todayStr || new Date(c.consumedAt).toLocaleDateString('pt-BR') === todayStr);
    } else if (_periodFilter === 'month') {
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        list = list.filter(c => {
            const d = new Date(c.consumedAt);
            return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        });
    }

    // Filtro de tipo
    if (_typeFilter !== 'all') {
        list = list.filter(c => c.type === _typeFilter);
    }

    // Filtro de status de pagamento
    if (_paymentFilter !== 'all') {
        list = list.filter(c => c.paymentStatus === _paymentFilter);
    }

    // Filtro de usuário/colaborador
    if (_userFilter !== 'all') {
        list = list.filter(c => c.beneficiaryUserId === _userFilter || c.beneficiaryName.toLowerCase().includes(_userFilter.toLowerCase()));
    }

    // Filtro de texto
    if (_searchQuery) {
        list = list.filter(c => 
            c.beneficiaryName.toLowerCase().includes(_searchQuery) ||
            c.productName.toLowerCase().includes(_searchQuery) ||
            (c.notes && c.notes.toLowerCase().includes(_searchQuery)) ||
            (c.paymentMethod && c.paymentMethod.toLowerCase().includes(_searchQuery))
        );
    }

    return list;
}

// ── Renderização Principal ───────────────────
export function renderConsumptionModule() {
    const viewContainer = document.getElementById('view-consumo');
    if (!viewContainer) return;

    const state = _config?.getState() || {};
    const currentUser = _config?.getCurrentUser();
    const isAdmin = currentUser && currentUser.role === ROLES.ADMIN;

    // Se não for admin, não renderiza
    if (!isAdmin) {
        return;
    }

    // 1. Preencher selects de produtos e colaboradores se vazios
    populateProductSelect(state.products || []);
    populateEmployeeSelect(state.users || []);

    // 2. Definir valor padrão do campo de data/hora se vazio
    const dateInput = document.getElementById('cons-date');
    if (dateInput && !dateInput.value) {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        dateInput.value = now.toISOString().slice(0, 16);
    }

    // 3. Calcular métricas
    const allConsumptions = state.consumptions || [];
    const activeConsumptions = allConsumptions.filter(c => c.status === 'ATIVO');

    let totalGeral = 0;
    let totalDiretoria = 0;
    let totalValesPendentes = 0;
    let totalValesPagos = 0;
    let totalItens = 0;

    activeConsumptions.forEach(c => {
        totalGeral += c.totalValue;
        totalItens += c.qty;
        if (c.type === 'DIRETORIA') {
            totalDiretoria += c.totalValue;
        } else if (c.type === 'FUNCIONARIO') {
            if (c.paymentStatus === 'PAGO') {
                totalValesPagos += c.totalValue;
            } else {
                totalValesPendentes += c.totalValue;
            }
        }
    });

    const elTotalGeral = document.getElementById('cons-metric-total-geral');
    const elTotalDiretoria = document.getElementById('cons-metric-total-diretoria');
    const elTotalVales = document.getElementById('cons-metric-total-vales');
    const elTotalValesPagos = document.getElementById('cons-metric-vales-pagos');
    const elTotalItens = document.getElementById('cons-metric-total-itens');

    if (elTotalGeral) elTotalGeral.innerText = formatCurrency(totalGeral);
    if (elTotalDiretoria) elTotalDiretoria.innerText = formatCurrency(totalDiretoria);
    if (elTotalVales) elTotalVales.innerText = formatCurrency(totalValesPendentes);
    if (elTotalValesPagos) elTotalValesPagos.innerText = formatCurrency(totalValesPagos);
    if (elTotalItens) elTotalItens.innerText = `${totalItens} un`;

    // 4. Banner de Quitação em Lote Dinâmico
    const pendingVales = activeConsumptions.filter(c => c.type === 'FUNCIONARIO' && c.paymentStatus === 'PENDENTE');
    const bannerEl = document.getElementById('cons-batch-settle-banner');
    if (bannerEl) {
        if (pendingVales.length > 0) {
            // Agrupar pendentes por colaborador
            const byBeneficiary = {};
            pendingVales.forEach(c => {
                const name = c.beneficiaryName;
                if (!byBeneficiary[name]) byBeneficiary[name] = { count: 0, total: 0 };
                byBeneficiary[name].count += 1;
                byBeneficiary[name].total += c.totalValue;
            });

            const buttonsHtml = Object.keys(byBeneficiary).map(name => {
                const { count, total } = byBeneficiary[name];
                return `
                    <button class="btn btn-sm" style="background: #10b981; color: white; border: none; padding: 6px 12px; font-weight: 700; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 6px;" 
                        onclick="app.openBatchPaymentModal('${escapeHtml(name)}')">
                        <span>💰</span> Quitar todos os ${count} vales de ${escapeHtml(name)} (${formatCurrency(total)})
                    </button>
                `;
            }).join(' ');

            bannerEl.style.display = 'block';
            bannerEl.innerHTML = `
                <div style="background: #ecfdf5; border: 1.5px solid #a7f3d0; border-radius: 10px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                    <div>
                        <strong style="color: #065f46; font-size: 9.5pt; display: flex; align-items: center; gap: 6px;">
                            <span>⚡</span> Quitação Rápida de Vales Pendentes:
                        </strong>
                        <span style="font-size: 8.5pt; color: #047857;">
                            Clique para registrar o recebimento integral ou acerto salarial do colaborador.
                        </span>
                    </div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        ${buttonsHtml}
                    </div>
                </div>
            `;
        } else {
            bannerEl.style.display = 'none';
            bannerEl.innerHTML = '';
        }
    }

    // 5. Renderizar Tabela do Histórico
    const tbody = document.getElementById('consumption-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filtered = getFilteredConsumptions();

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center" style="padding: 32px; color: #94a3b8;">
                    Nenhuma retirada ou vale encontrado com os filtros selecionados.
                </td>
            </tr>
        `;
        return;
    }

    filtered.forEach(item => {
        const tr = document.createElement('tr');
        if (item.status === 'ESTORNADO') {
            tr.style.opacity = '0.5';
            tr.style.textDecoration = 'line-through';
        }

        let typeBadge = '';
        if (item.type === 'DIRETORIA') {
            typeBadge = `<span class="badge-status" style="background: #f3e8ff; color: #7e22ce; border: 1px solid #d8b4fe;">👑 Sócios / Patrão</span>`;
        } else if (item.type === 'FUNCIONARIO') {
            typeBadge = `<span class="badge-status" style="background: #fff7ed; color: #c2410c; border: 1px solid #fdba74;">👤 Vale Colaborador</span>`;
        } else {
            typeBadge = `<span class="badge-status" style="background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;">🏢 Uso Interno</span>`;
        }

        const dateStr = item.dateFormatted || new Date(item.consumedAt).toLocaleDateString('pt-BR');
        const timeStr = item.timeFormatted || new Date(item.consumedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        const safeBeneficiary = escapeHtml(item.beneficiaryName);
        const safeProduct = escapeHtml(item.productName);
        const safeNotes = escapeHtml(item.notes || '—');

        // Status de Pagamento
        let paymentBadge = '';
        if (item.type === 'FUNCIONARIO') {
            if (item.paymentStatus === 'PAGO') {
                const paidDateStr = item.paidAt ? new Date(item.paidAt).toLocaleDateString('pt-BR') : '';
                paymentBadge = `
                    <span class="badge-status" style="background: #d1fae5; color: #047857; border: 1px solid #a7f3d0;" title="Recebido por ${escapeHtml(item.paidOperatorName || '')} via ${formatPaymentMethodLabel(item.paymentMethod)}">
                        🟢 PAGO • ${formatPaymentMethodLabel(item.paymentMethod)}
                    </span>
                    <div style="font-size: 7pt; color: #059669; margin-top: 2px;">
                        ${paidDateStr} ${item.paidOperatorName ? `• ${escapeHtml(item.paidOperatorName)}` : ''}
                    </div>
                `;
            } else {
                paymentBadge = `<span class="badge-status" style="background: #fef3c7; color: #b45309; border: 1px solid #fde68a;">🟡 PENDENTE</span>`;
            }
        } else {
            paymentBadge = `<span style="color: #94a3b8; font-size: 8pt;">— Isento</span>`;
        }

        // Ações
        let actionsHtml = '—';
        if (item.status === 'ATIVO' && isAdmin) {
            if (item.type === 'FUNCIONARIO') {
                if (item.paymentStatus === 'PENDENTE') {
                    actionsHtml = `
                        <div style="display: flex; gap: 4px; justify-content: flex-end;">
                            <button class="btn btn-sm" style="padding: 4px 8px; font-size: 8pt; background: #10b981; border: none; color: white; border-radius: 4px; cursor: pointer; font-weight: 600;" 
                                onclick="app.openConsumptionPaymentModal('${item.id}')" title="Confirmar recebimento / pagamento do vale">
                                💰 Receber
                            </button>
                            <button class="btn btn-outline" style="padding: 4px 8px; font-size: 8pt; color: #dc2626; border-color: #fca5a5; border-radius: 4px;" 
                                onclick="app.cancelConsumptionRecord('${item.id}')" title="Estornar baixa e devolver estoque">
                                ↩️ Estornar
                            </button>
                        </div>
                    `;
                } else {
                    actionsHtml = `
                        <div style="display: flex; gap: 4px; justify-content: flex-end;">
                            <button class="btn btn-outline" style="padding: 4px 8px; font-size: 7.5pt; color: #d97706; border-color: #fde68a; border-radius: 4px;" 
                                onclick="app.undoConsumptionPayment('${item.id}')" title="Desfazer quitação (voltar a constar como pendente)">
                                ↩️ Desfazer Pgto
                            </button>
                        </div>
                    `;
                }
            } else {
                actionsHtml = `
                    <button class="btn btn-outline" style="padding: 4px 8px; font-size: 8pt; color: #dc2626; border-color: #fca5a5; border-radius: 4px;" 
                        onclick="app.cancelConsumptionRecord('${item.id}')" title="Estornar baixa e devolver estoque">
                        ↩️ Estornar
                    </button>
                `;
            }
        } else if (item.status === 'ESTORNADO') {
            actionsHtml = `<span style="font-size: 7.5pt; color: #94a3b8;">Estornado</span>`;
        }

        tr.innerHTML = `
            <td style="font-size: 8.5pt;">
                <strong>${dateStr}</strong><br>
                <span style="color: #94a3b8; font-size: 7.5pt;">${timeStr}</span>
            </td>
            <td>${typeBadge}</td>
            <td>
                <strong>${safeBeneficiary}</strong>
                ${item.notes ? `<div style="font-size: 7.5pt; color: #64748b; font-style: italic;">Obs: ${safeNotes}</div>` : ''}
            </td>
            <td>
                <span>${safeProduct}</span>
                <span style="display: block; font-size: 7.5pt; color: #64748b;">${item.qty} un × ${formatCurrency(item.unitPrice)}</span>
            </td>
            <td style="font-weight: 700; color: #1e293b;">
                ${formatCurrency(item.totalValue)}
            </td>
            <td>
                ${paymentBadge}
            </td>
            <td style="font-size: 8pt; color: #64748b;">
                ${escapeHtml(item.operatorName)}
            </td>
            <td class="text-right">
                ${actionsHtml}
            </td>
        `;

        tbody.appendChild(tr);
    });
}

// ── Auxiliares de População de Selects ────────
function populateProductSelect(products) {
    const select = document.getElementById('cons-product-select');
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Selecione o Produto --</option>';

    // Apenas produtos ativos
    const activeProducts = products
        .filter(p => p.active !== false)
        .sort((a, b) => a.name.localeCompare(b.name));

    activeProducts.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.innerText = `${p.name} (Estoque: ${p.stock} un | R$ ${p.price.toFixed(2).replace('.', ',')})`;
        select.appendChild(opt);
    });

    if (currentVal) select.value = currentVal;
}

function populateEmployeeSelect(users) {
    const select = document.getElementById('cons-employee-select');
    const filterSelect = document.getElementById('cons-filter-employee');

    const activeUsers = users
        .filter(u => u.active !== false)
        .sort((a, b) => a.name.localeCompare(b.name));

    if (select) {
        const currentVal = select.value;
        select.innerHTML = '<option value="">-- Selecione o Colaborador --</option>';
        activeUsers.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.setAttribute('data-name', u.name);
            opt.innerText = `${u.name} [${u.code.toUpperCase()}] — ${u.title || (u.role === 'ADMIN' ? 'Gestor' : 'Recepção')}`;
            select.appendChild(opt);
        });
        if (currentVal) select.value = currentVal;
    }

    if (filterSelect) {
        const currentFilterVal = filterSelect.value;
        filterSelect.innerHTML = '<option value="all">Todos os Colaboradores</option>';
        activeUsers.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.innerText = `${u.name} [${u.code.toUpperCase()}]`;
            filterSelect.appendChild(opt);
        });
        if (currentFilterVal) filterSelect.value = currentFilterVal;
    }
}
