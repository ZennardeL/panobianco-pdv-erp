/**
 * ==========================================================================
 * PANOBIANCO PDV & ERP - MOTOR CLIENT-SIDE (v2.1.0 — Autenticação por Token)
 * ==========================================================================
 */

class PanobiancoApp {
    constructor() {
        this.STORAGE_KEY = 'panobianco_pos_erp_v5';
        this.API_BASE = window.location.origin.includes('http') ? window.location.origin : 'http://localhost:3000';
        this.isOnline = true;
        this.state = this.loadLocalState();
        this.currentUser = null;
        this.authToken = sessionStorage.getItem('panobianco_token') || null;
        this.cart = [];
        this.selectedPaymentMethod = 'pix';
        this.activeCategory = 'todas';
        this.tempQuickPhotoBase64 = null;
        this.tempProductPhotoBase64 = null;
        this.syncInterval = null;
        
        this.init();
    }

    async init() {
        // Tentar recuperar sessão existente
        if (this.authToken) {
            const ok = await this.syncWithServer(false);
            if (ok) {
                // Sessão válida — recuperar dados do usuário do sessionStorage
                const savedUser = sessionStorage.getItem('panobianco_user');
                if (savedUser) {
                    try {
                        this.currentUser = JSON.parse(savedUser);
                        this.onLoginSuccess(this.currentUser);
                        this.renderAll();
                        this.startPolling();
                        return;
                    } catch (e) { /* fallthrough para login */ }
                }
            }
            // Token inválido/expirado — limpar e mostrar login
            this.clearSession();
        }

        this.showLoginModal();
        this.renderAll();
    }

    startPolling() {
        if (this.syncInterval) clearInterval(this.syncInterval);
        this.syncInterval = setInterval(() => {
            this.syncWithServer(false);
        }, 2500);
    }

    /**
     * Helper para todas as requisições autenticadas.
     * Envia o token no header Authorization.
     * Trata 401 (sessão expirada) automaticamente.
     */
    async authFetch(url, options = {}) {
        if (!options.headers) options.headers = {};
        if (this.authToken) {
            options.headers['Authorization'] = `Bearer ${this.authToken}`;
        }
        options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';

        const res = await fetch(url, options);

        if (res.status === 401) {
            // Sessão expirada — forçar relogin
            this.clearSession();
            this.showLoginModal();
            throw new Error('Sessão expirada. Faça login novamente.');
        }

        if (res.status === 403) {
            const data = await res.json();
            alert(`🔒 ${data.error || 'Acesso restrito a gestores (ADMIN).'}`);
            throw new Error('Sem permissão');
        }

        return res;
    }

    clearSession() {
        this.authToken = null;
        this.currentUser = null;
        sessionStorage.removeItem('panobianco_token');
        sessionStorage.removeItem('panobianco_user');
    }

    async syncWithServer(showFeedback = true) {
        try {
            const headers = { 'Cache-Control': 'no-store' };
            if (this.authToken) {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }
            const res = await fetch(`${this.API_BASE}/api/state`, { headers });
            if (res.status === 401) {
                // Token expirado durante polling — forçar relogin silenciosamente
                this.clearSession();
                this.showLoginModal();
                return false;
            }
            if (res.ok) {
                const serverState = await res.json();
                this.state = serverState;
                this.saveLocalState(serverState);
                this.isOnline = true;
                this.updateSyncBadge(true);
                this.renderAll();
                return true;
            } else {
                throw new Error('Servidor indisponível');
            }
        } catch (e) {
            this.isOnline = false;
            this.updateSyncBadge(false);
            if (showFeedback) console.warn('Modo Offline: Operando com dados locais.');
            return false;
        }
    }

    updateSyncBadge(online) {
        let badge = document.getElementById('sync-status-badge');
        if (badge) {
            if (online) {
                badge.innerHTML = '🟢 PC Recepção 24h Ativo';
                badge.className = 'sync-badge online';
                badge.title = 'Conectado e sincronizado com o PC da Recepção 24h';
            } else {
                badge.innerHTML = '🟡 Modo Local';
                badge.className = 'sync-badge offline';
                badge.title = 'Operando localmente. Sincronizará com o PC 24h.';
            }
        }
    }

    loadLocalState() {
        const saved = localStorage.getItem(this.STORAGE_KEY);
        if (saved) {
            try { return JSON.parse(saved); } catch (e) {}
        }
        return this.getDefaultSeedData();
    }

    saveLocalState(data) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    }

    getDefaultSeedData() {
        return {
            saleCounter: 0,
            users: [
                { id: 'f20729', code: 'f20729', name: 'Luan', role: 'ADMIN', title: 'Auxiliar Administrativo / Gestor', avatar: '💼' },
                { id: 'f30188', code: 'f30188', name: 'Letícia Santos', role: 'OPERADOR', title: 'Recepção / Balcão', avatar: '👩‍💼' },
                { id: 'f00101', code: 'f00101', name: 'Gerente Geral', role: 'ADMIN', title: 'Gerente de Unidade', avatar: '👑' },
                { id: 'f10452', code: 'f10452', name: 'Marcos Oliveira', role: 'OPERADOR', title: 'Recepção Manhã', avatar: '👤' }
            ],
            products: [],
            sales: [],
            shifts: [],
            activeShift: {
                id: 'shift_init',
                shiftCode: 'T01',
                operatorId: 'f20729',
                operatorName: 'Luan [F20729]',
                startTime: new Date().toISOString(),
                sales: [],
                status: 'OPEN'
            }
        };
    }

    /* ==================== AUTENTICAÇÃO PRIVADA ==================== */
    showLoginModal() {
        document.getElementById('login-modal').classList.add('active');
        const codeInput = document.getElementById('login-employee-code');
        if (codeInput) {
            codeInput.value = '';
            codeInput.focus();
        }
        const err = document.getElementById('login-error');
        if (err) err.style.display = 'none';
    }

    async handleEmployeeLogin() {
        const codeInput = document.getElementById('login-employee-code').value.trim().toLowerCase();
        const errorEl = document.getElementById('login-error');

        if (!codeInput) {
            errorEl.innerText = '⚠️ Digite seu código de funcionário para entrar.';
            errorEl.style.display = 'block';
            return;
        }

        try {
            const res = await fetch(`${this.API_BASE}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: codeInput })
            });

            if (res.ok) {
                const data = await res.json();
                // Salvar token e dados do usuário
                this.authToken = data.token;
                this.currentUser = data.user;
                sessionStorage.setItem('panobianco_token', data.token);
                sessionStorage.setItem('panobianco_user', JSON.stringify(data.user));
                this.onLoginSuccess(data.user);
                this.startPolling();
                await this.syncWithServer(false);
                return;
            } else {
                const errData = await res.json();
                throw new Error(errData.error || 'Código não encontrado.');
            }
        } catch (e) {
            // Fallback offline
            const localUser = (this.state.users || []).find(u => u.code.toLowerCase() === codeInput);
            if (localUser) {
                this.currentUser = localUser;
                this.onLoginSuccess(localUser);
                this.startPolling();
                return;
            }

            errorEl.innerText = `❌ ${e.message || 'Código não cadastrado no sistema!'}`;
            errorEl.style.display = 'block';
        }
    }

    onLoginSuccess(user) {
        document.getElementById('login-modal').classList.remove('active');
        
        document.getElementById('current-user-avatar').innerText = user.avatar || (user.role === 'ADMIN' ? '💼' : '👤');
        document.getElementById('current-user-name').innerText = `${user.name} [${user.code.toUpperCase()}]`;
        document.getElementById('current-user-role').innerText = user.title || (user.role === 'ADMIN' ? 'Gestor Master' : 'Operador de Caixa');
        
        const tag = document.getElementById('cart-operator-tag');
        if (tag) tag.innerText = `Operador: ${user.name} [${user.code.toUpperCase()}]`;

        const isAdmin = user.role === 'ADMIN';
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = isAdmin ? '' : 'none';
        });

        const stockDesc = document.getElementById('stock-view-desc');
        if (stockDesc) {
            stockDesc.innerText = isAdmin 
                ? 'Acompanhamento de saldos, custos, margens e cadastro de fotos' 
                : 'Consulta rápida de preços, estoque e fotos dos produtos no balcão';
        }

        this.navigate('pdv');
    }

    async logout() {
        // Notificar servidor para invalidar token
        if (this.authToken) {
            try {
                await fetch(`${this.API_BASE}/api/auth/logout`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${this.authToken}` }
                });
            } catch (e) { /* ignorar erros de rede no logout */ }
        }
        if (this.syncInterval) clearInterval(this.syncInterval);
        this.clearSession();
        this.cart = [];
        this.showLoginModal();
    }

    /* ==================== NAVEGAÇÃO ==================== */
    navigate(viewId) {
        document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
        document.querySelectorAll('.view-content').forEach(view => view.classList.remove('active'));
        
        const targetBtn = document.getElementById(`tab-btn-${viewId}`);
        const targetView = document.getElementById(`view-${viewId}`);
        
        if (targetBtn) targetBtn.classList.add('active');
        if (targetView) targetView.classList.add('active');

        this.renderAll();
    }

    /* ==================== MÓDULO 1: PDV (VENDAS COM FOTOS) ==================== */
    filterCategory(category) {
        this.activeCategory = category;
        document.querySelectorAll('.cat-pill').forEach(btn => {
            btn.classList.toggle('active', btn.innerText.toLowerCase().includes(category) || (category === 'todas' && btn.innerText.includes('Todos')));
        });
        this.renderProductsGrid();
    }

    searchProducts(query) {
        this.searchQuery = query.toLowerCase().trim();
        this.renderProductsGrid();
    }

    renderProductsGrid() {
        const grid = document.getElementById('products-grid');
        if (!grid) return;
        grid.innerHTML = '';

        let filtered = this.state.products || [];

        if (this.activeCategory && this.activeCategory !== 'todas') {
            filtered = filtered.filter(p => p.category === this.activeCategory);
        }

        if (this.searchQuery) {
            filtered = filtered.filter(p => p.name.toLowerCase().includes(this.searchQuery));
        }

        filtered.forEach(prod => {
            const card = document.createElement('div');
            card.className = `prod-card ${prod.stock <= 0 ? 'out-of-stock' : ''}`;
            card.onclick = () => this.addToCart(prod.id);

            let stockClass = 'stock-high';
            let stockLabel = `${prod.stock} em estoque`;
            if (prod.stock === 0) {
                stockClass = 'stock-zero';
                stockLabel = 'Esgotado';
            } else if (prod.stock <= prod.minStock) {
                stockClass = 'stock-low';
                stockLabel = `Restam apenas ${prod.stock}`;
            } else if (prod.stock <= 15) {
                stockClass = 'stock-med';
            }

            // Exibe Foto Real se houver, ou Emoji
            const mediaHtml = prod.image 
                ? `<div class="prod-card-media"><img src="${prod.image}" class="prod-card-photo" alt="${prod.name}"></div>`
                : `<div class="prod-card-media"><span class="prod-card-icon">${prod.icon || '📦'}</span></div>`;

            card.innerHTML = `
                ${mediaHtml}
                <div class="prod-card-name">${prod.name}</div>
                <div class="prod-card-price">R$ ${prod.price.toFixed(2).replace('.', ',')}</div>
                <div><span class="prod-card-stock ${stockClass}">${stockLabel}</span></div>
            `;
            grid.appendChild(card);
        });

        const nextSeq = (this.state.saleCounter || (this.state.sales || []).length) + 1;
        const nextTag = document.getElementById('next-sale-code-tag');
        if (nextTag) {
            nextTag.innerText = `Próxima: V${nextSeq < 10 ? '0' + nextSeq : nextSeq}`;
        }
    }

    addToCart(productId) {
        const product = (this.state.products || []).find(p => p.id === productId);
        if (!product || product.stock <= 0) return;

        const cartItem = this.cart.find(item => item.productId === productId);
        const currentQtyInCart = cartItem ? cartItem.qty : 0;

        if (currentQtyInCart + 1 > product.stock) {
            alert(`⚠️ Estoque insuficiente! Existem apenas ${product.stock} unidades disponíveis.`);
            return;
        }

        if (cartItem) {
            cartItem.qty += 1;
        } else {
            this.cart.push({
                productId: product.id,
                name: product.name,
                price: product.price,
                cost: product.cost,
                qty: 1
            });
        }
        this.renderCart();
    }

    updateCartQty(productId, delta) {
        const cartItem = this.cart.find(item => item.productId === productId);
        const product = (this.state.products || []).find(p => p.id === productId);
        if (!cartItem) return;

        const newQty = cartItem.qty + delta;
        if (newQty <= 0) {
            this.cart = this.cart.filter(item => item.productId !== productId);
        } else {
            if (newQty > product.stock) {
                alert(`⚠️ Estoque máximo atingido (${product.stock} un).`);
                return;
            }
            cartItem.qty = newQty;
        }
        this.renderCart();
    }

    clearCart() {
        this.cart = [];
        this.renderCart();
    }

    renderCart() {
        const container = document.getElementById('cart-items');
        if (!container) return;

        if (this.cart.length === 0) {
            container.innerHTML = `
                <div class="empty-cart">
                    <div class="empty-cart-icon">🛒</div>
                    <p>Nenhum item selecionado</p>
                    <small>Clique nos produtos ao lado para adicionar ao cupom</small>
                </div>
            `;
            document.getElementById('cart-total-qty').innerText = '0 un.';
            document.getElementById('cart-total-val').innerText = 'R$ 0,00';
            return;
        }

        container.innerHTML = '';
        let totalQty = 0;
        let totalVal = 0;

        this.cart.forEach(item => {
            const subtotal = item.price * item.qty;
            totalQty += item.qty;
            totalVal += subtotal;

            const row = document.createElement('div');
            row.className = 'cart-row';
            row.innerHTML = `
                <div class="cart-row-details">
                    <div class="cart-row-name">${item.name}</div>
                    <div class="cart-row-unit-price">R$ ${item.price.toFixed(2).replace('.', ',')} un.</div>
                </div>
                <div class="cart-qty-ctrl">
                    <button class="qty-btn" onclick="app.updateCartQty('${item.productId}', -1)">-</button>
                    <span class="cart-qty-val">${item.qty}</span>
                    <button class="qty-btn" onclick="app.updateCartQty('${item.productId}', 1)">+</button>
                </div>
                <div class="cart-row-subtotal">R$ ${subtotal.toFixed(2).replace('.', ',')}</div>
            `;
            container.appendChild(row);
        });

        document.getElementById('cart-total-qty').innerText = `${totalQty} un.`;
        document.getElementById('cart-total-val').innerText = `R$ ${totalVal.toFixed(2).replace('.', ',')}`;
        this.calculateChange();
    }

    selectPaymentMethod(method) {
        this.selectedPaymentMethod = method;
        document.querySelectorAll('.pay-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.method === method);
        });

        const cashContainer = document.getElementById('cash-change-container');
        if (method === 'dinheiro') {
            cashContainer.style.display = 'block';
        } else {
            cashContainer.style.display = 'none';
        }
    }

    calculateChange() {
        if (this.selectedPaymentMethod !== 'dinheiro') return;
        const totalVal = this.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
        const received = parseFloat(document.getElementById('cash-received').value) || 0;
        const change = Math.max(0, received - totalVal);
        document.getElementById('change-value').innerText = `R$ ${change.toFixed(2).replace('.', ',')}`;
    }

    async finalizeSale() {
        if (this.cart.length === 0) {
            alert('⚠️ O cupom de venda está vazio!');
            return;
        }

        const totalVal = this.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
        const totalCost = this.cart.reduce((sum, item) => sum + (item.cost * item.qty), 0);
        const profit = totalVal - totalCost;

        const opCode = this.currentUser ? this.currentUser.code.toUpperCase() : 'F20729';
        const opName = this.currentUser ? `${this.currentUser.name} [${opCode}]` : 'Luan [F20729]';

        const salePayload = {
            items: [...this.cart],
            total: totalVal,
            cost: totalCost,
            profit: profit,
            paymentMethod: this.selectedPaymentMethod,
            operatorId: this.currentUser ? this.currentUser.id : 'f20729',
            operatorName: opName,
            operatorCode: opCode
        };

        try {
            const res = await fetch(`${this.API_BASE}/api/sale`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(salePayload)
            });

            if (res.ok) {
                const data = await res.json();
                this.state = data.state;
                this.saveLocalState(data.state);
                this.showSuccessModal(data.sale);
            } else {
                throw new Error('Falha no servidor');
            }
        } catch (e) {
            this.state.saleCounter = (this.state.saleCounter || 0) + 1;
            const seq = this.state.saleCounter;
            const code = `V${seq < 10 ? '0' + seq : seq}`;

            this.cart.forEach(cartItem => {
                const prod = this.state.products.find(p => p.id === cartItem.productId);
                if (prod) prod.stock -= cartItem.qty;
            });

            const offlineSale = {
                id: code,
                seq,
                timestamp: new Date().toISOString(),
                dateFormatted: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                fullDateTime: new Date().toLocaleString('pt-BR'),
                ...salePayload,
                status: 'CONCLUIDA'
            };

            this.state.sales.unshift(offlineSale);
            if (this.state.activeShift) {
                if (!this.state.activeShift.sales) this.state.activeShift.sales = [];
                this.state.activeShift.sales.push(offlineSale);
            }
            this.saveLocalState(this.state);
            this.showSuccessModal(offlineSale);
        }

        this.cart = [];
        this.renderCart();
        this.renderAll();
    }

    showSuccessModal(sale) {
        this.lastSaleId = sale.id;
        document.getElementById('modal-sale-code').innerText = sale.id;
        document.getElementById('modal-code-text').innerText = sale.id;

        const preview = document.getElementById('receipt-preview');
        let itemsList = sale.items.map(it => `&bull; ${it.qty}x ${it.name} (R$ ${(it.price * it.qty).toFixed(2).replace('.', ',')})`).join('<br>');
        
        preview.innerHTML = `
            <strong>Comprovante da Lojinha (#${sale.id})</strong><br>
            ⏰ Horário: ${sale.dateFormatted || new Date().toLocaleTimeString('pt-BR')}<br>
            👤 <strong>Operador: ${sale.operatorName}</strong><br>
            💳 Pagamento: <strong>${sale.paymentMethod.toUpperCase()}</strong><br>
            <hr style="margin: 6px 0; border: 0; border-top: 1px dashed #cbd5e1;">
            ${itemsList}<br>
            <hr style="margin: 6px 0; border: 0; border-top: 1px dashed #cbd5e1;">
            <strong style="color: #0f172a; font-size: 11pt;">TOTAL: R$ ${sale.total.toFixed(2).replace('.', ',')}</strong>
        `;

        document.getElementById('success-modal').classList.add('active');
    }

    closeSuccessModal() {
        document.getElementById('success-modal').classList.remove('active');
    }

    async cancelLastSale() {
        if (!this.lastSaleId) return;

        const reason = prompt(`⚠️ Cancelar venda ${this.lastSaleId}?\n\nDigite o motivo do cancelamento (ex: "erro de produto", "cliente desistiu"):`, 'Erro de operação — cancelamento imediato');
        
        if (!reason) return; // Cancelou o prompt

        try {
            const res = await this.authFetch(`${this.API_BASE}/api/sale/cancel`, {
                method: 'POST',
                body: JSON.stringify({
                    saleId: this.lastSaleId,
                    reason: reason,
                    immediateCancelByOperator: true
                })
            });

            if (res.ok) {
                alert(`✅ Venda ${this.lastSaleId} cancelada com sucesso!\nEstoque devolvido automaticamente.`);
                this.lastSaleId = null;
                this.closeSuccessModal();
                await this.syncWithServer(false);
            } else {
                const data = await res.json();
                alert(`❌ ${data.error || 'Erro ao cancelar.'}`);
            }
        } catch (e) {
            if (e.message === 'Sem permissão') {
                alert('❌ Você não tem permissão para cancelar vendas. Peça ao gestor.');
            }
        }
    }

    /* ==================== MÓDULO 2: ESTOQUE & CADASTRO DE FOTOS ==================== */
    renderStockTable() {
        const tbody = document.getElementById('stock-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        const isAdmin = this.currentUser && this.currentUser.role === 'ADMIN';

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

        let totalProducts = (this.state.products || []).length;
        let criticalCount = 0;
        let totalCostValue = 0;
        let totalPotentialRevenue = 0;

        (this.state.products || []).forEach(prod => {
            totalCostValue += prod.cost * prod.stock;
            totalPotentialRevenue += prod.price * prod.stock;
            if (prod.stock <= prod.minStock) criticalCount++;

            const margin = ((prod.price - prod.cost) / prod.price) * 100;
            const tr = document.createElement('tr');

            let statusBadge = `<span class="badge-status badge-ok">Normal (${prod.stock})</span>`;
            if (prod.stock <= 0) {
                statusBadge = `<span class="badge-status badge-cancel">Esgotado</span>`;
            } else if (prod.stock <= prod.minStock) {
                statusBadge = `<span class="badge-status" style="background:#fffbeb; color:#d97706;">Crítico (${prod.stock})</span>`;
            }

            const photoCell = prod.image
                ? `<img src="${prod.image}" class="table-prod-photo-thumb" alt="${prod.name}">`
                : `<div class="table-prod-emoji-thumb">${prod.icon || '📦'}</div>`;

            tr.innerHTML = `
                <td>${photoCell}</td>
                <td><strong>${prod.name}</strong></td>
                <td>${prod.category.toUpperCase()}</td>
                ${isAdmin ? `<td>R$ ${prod.cost.toFixed(2).replace('.', ',')}</td>` : ''}
                <td><strong>R$ ${prod.price.toFixed(2).replace('.', ',')}</strong></td>
                ${isAdmin ? `<td style="color: #10b981; font-weight: 700;">${margin.toFixed(0)}%</td>` : ''}
                <td><strong>${prod.stock} un.</strong></td>
                <td>${statusBadge}</td>
                <td class="text-right">
                    <button class="btn btn-sm btn-secondary" onclick="app.openQuickPhotoModal('${prod.id}')" title="Alterar Foto">📷 Foto</button>
                    <button class="btn btn-sm btn-secondary" onclick="app.openRestockModal('${prod.id}')">➕ Entrada</button>
                    ${isAdmin ? `<button class="btn btn-sm btn-secondary" onclick="app.editProduct('${prod.id}')">✏️</button>` : ''}
                </td>
            `;
            tbody.appendChild(tr);
        });

        if (isAdmin) {
            const elTot = document.getElementById('st-total-products');
            const elCrit = document.getElementById('st-critical-count');
            const elCost = document.getElementById('st-total-cost');
            const elPot = document.getElementById('st-total-potential');

            if (elTot) elTot.innerText = totalProducts;
            if (elCrit) elCrit.innerText = criticalCount;
            if (elCost) elCost.innerText = `R$ ${totalCostValue.toFixed(2).replace('.', ',')}`;
            if (elPot) elPot.innerText = `R$ ${totalPotentialRevenue.toFixed(2).replace('.', ',')}`;
        }
    }

    // Modal de Upload Rápido de Foto (Aberto para Todos os Colaboradores)
    openQuickPhotoModal(productId) {
        const prod = (this.state.products || []).find(p => p.id === productId);
        if (!prod) return;

        this.tempQuickPhotoBase64 = prod.image || null;
        document.getElementById('quick-photo-prod-id').value = prod.id;
        document.getElementById('quick-photo-prod-name').innerText = `Produto: ${prod.name}`;
        
        const previewImg = document.getElementById('quick-photo-preview-img');
        const placeholder = document.getElementById('quick-photo-placeholder');
        const fileInput = document.getElementById('quick-photo-file-input');
        if (fileInput) fileInput.value = '';

        if (prod.image) {
            previewImg.src = prod.image;
            previewImg.style.display = 'block';
            placeholder.style.display = 'none';
        } else {
            previewImg.src = '';
            previewImg.style.display = 'none';
            placeholder.style.display = 'block';
        }

        document.getElementById('quick-photo-modal').classList.add('active');
    }

    closeQuickPhotoModal() {
        document.getElementById('quick-photo-modal').classList.remove('active');
    }

    previewQuickPhoto(input) {
        if (input.files && input.files[0]) {
            const file = input.files[0];
            const reader = new FileReader();
            reader.onload = (e) => {
                // Comprime a imagem levemente em canvas para salvar espaço e transferir rápido
                this.compressImage(e.target.result, 300, 300, (compressedBase64) => {
                    this.tempQuickPhotoBase64 = compressedBase64;
                    const previewImg = document.getElementById('quick-photo-preview-img');
                    const placeholder = document.getElementById('quick-photo-placeholder');
                    previewImg.src = compressedBase64;
                    previewImg.style.display = 'block';
                    placeholder.style.display = 'none';
                });
            };
            reader.readAsDataURL(file);
        }
    }

    async saveQuickPhoto() {
        const prodId = document.getElementById('quick-photo-prod-id').value;
        if (!this.tempQuickPhotoBase64) {
            alert('⚠️ Selecione uma foto antes de salvar.');
            return;
        }

        try {
            const res = await fetch(`${this.API_BASE}/api/product/photo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    productId: prodId,
                    imageBase64: this.tempQuickPhotoBase64
                })
            });

            if (res.ok) {
                const data = await res.json();
                this.state = data.state;
                this.saveLocalState(data.state);
                alert('✅ Foto cadastrada com sucesso em todas as máquinas!');
            }
        } catch (e) {
            const prod = this.state.products.find(p => p.id === prodId);
            if (prod) {
                prod.image = this.tempQuickPhotoBase64;
                this.saveLocalState(this.state);
                alert('✅ Foto salva localmente com sucesso!');
            }
        }

        this.closeQuickPhotoModal();
        this.renderAll();
    }

    compressImage(srcBase64, maxWidth, maxHeight, callback) {
        const img = new Image();
        img.src = srcBase64;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width = Math.round((width * maxHeight) / height);
                    height = maxHeight;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            callback(canvas.toDataURL('image/jpeg', 0.85));
        };
    }

    openNewProductModal() {
        document.getElementById('modal-product-title').innerText = 'Cadastrar Novo Produto';
        document.getElementById('edit-prod-id').value = '';
        document.getElementById('edit-prod-image').value = '';
        document.getElementById('prod-name').value = '';
        document.getElementById('prod-icon').value = '📦';
        document.getElementById('prod-cost').value = '';
        document.getElementById('prod-price').value = '';
        document.getElementById('prod-stock').value = '';
        document.getElementById('prod-min-stock').value = '5';
        
        const previewImg = document.getElementById('prod-photo-preview-img');
        const placeholder = document.getElementById('prod-photo-placeholder');
        previewImg.style.display = 'none';
        placeholder.style.display = 'block';
        this.tempProductPhotoBase64 = null;

        document.getElementById('product-modal').classList.add('active');
    }

    editProduct(productId) {
        const prod = (this.state.products || []).find(p => p.id === productId);
        if (!prod) return;

        document.getElementById('modal-product-title').innerText = 'Editar Produto';
        document.getElementById('edit-prod-id').value = prod.id;
        document.getElementById('edit-prod-image').value = prod.image || '';
        document.getElementById('prod-name').value = prod.name;
        document.getElementById('prod-category').value = prod.category;
        document.getElementById('prod-icon').value = prod.icon || '📦';
        document.getElementById('prod-cost').value = prod.cost;
        document.getElementById('prod-price').value = prod.price;
        document.getElementById('prod-stock').value = prod.stock;
        document.getElementById('prod-min-stock').value = prod.minStock;
        
        const previewImg = document.getElementById('prod-photo-preview-img');
        const placeholder = document.getElementById('prod-photo-placeholder');
        if (prod.image) {
            previewImg.src = prod.image;
            previewImg.style.display = 'block';
            placeholder.style.display = 'none';
            this.tempProductPhotoBase64 = prod.image;
        } else {
            previewImg.style.display = 'none';
            placeholder.style.display = 'block';
            this.tempProductPhotoBase64 = null;
        }

        document.getElementById('product-modal').classList.add('active');
    }

    previewProductPhoto(input) {
        if (input.files && input.files[0]) {
            const file = input.files[0];
            const reader = new FileReader();
            reader.onload = (e) => {
                this.compressImage(e.target.result, 300, 300, (compressedBase64) => {
                    this.tempProductPhotoBase64 = compressedBase64;
                    const previewImg = document.getElementById('prod-photo-preview-img');
                    const placeholder = document.getElementById('prod-photo-placeholder');
                    previewImg.src = compressedBase64;
                    previewImg.style.display = 'block';
                    placeholder.style.display = 'none';
                });
            };
            reader.readAsDataURL(file);
        }
    }

    async saveProduct() {
        const id = document.getElementById('edit-prod-id').value;
        const name = document.getElementById('prod-name').value.trim();
        const category = document.getElementById('prod-category').value;
        const icon = document.getElementById('prod-icon').value.trim() || '📦';
        const cost = parseFloat(document.getElementById('prod-cost').value) || 0;
        const price = parseFloat(document.getElementById('prod-price').value) || 0;
        const stock = parseInt(document.getElementById('prod-stock').value) || 0;
        const minStock = parseInt(document.getElementById('prod-min-stock').value) || 5;
        const image = this.tempProductPhotoBase64 || document.getElementById('edit-prod-image').value || '';

        if (!name || price <= 0) {
            alert('⚠️ Preencha o nome e o preço de venda corretamente.');
            return;
        }

        const productPayload = { id, name, category, icon, cost, price, stock, minStock, image };

        try {
            const res = await fetch(`${this.API_BASE}/api/product`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(productPayload)
            });
            if (res.ok) {
                const data = await res.json();
                this.state = data.state;
            }
        } catch (e) {
            if (id) {
                const prod = this.state.products.find(p => p.id === id);
                if (prod) Object.assign(prod, productPayload);
            } else {
                this.state.products.push({ id: 'prod_' + Date.now(), ...productPayload });
            }
        }

        this.saveLocalState(this.state);
        this.closeProductModal();
        this.renderAll();
    }

    closeProductModal() {
        document.getElementById('product-modal').classList.remove('active');
    }

    openRestockModal(productId) {
        const prod = (this.state.products || []).find(p => p.id === productId);
        if (!prod) return;
        document.getElementById('restock-prod-id').value = prod.id;
        document.getElementById('restock-prod-name').innerText = `Item: ${prod.name} (Estoque atual: ${prod.stock} un)`;
        document.getElementById('restock-qty').value = '';
        document.getElementById('restock-modal').classList.add('active');
    }

    async confirmRestock() {
        const id = document.getElementById('restock-prod-id').value;
        const qty = parseInt(document.getElementById('restock-qty').value) || 0;
        if (qty <= 0) {
            alert('⚠️ Digite uma quantidade válida para adicionar.');
            return;
        }

        try {
            const res = await fetch(`${this.API_BASE}/api/restock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productId: id, qty })
            });
            if (res.ok) {
                const data = await res.json();
                this.state = data.state;
                this.saveLocalState(data.state);
                alert(`✅ Entrada de ${qty} unidades confirmada em todas as máquinas!`);
            }
        } catch (e) {
            const prod = this.state.products.find(p => p.id === id);
            if (prod) {
                prod.stock += qty;
                this.saveLocalState(this.state);
                alert(`✅ Entrada de ${qty} unidades confirmada localmente!`);
            }
        }

        this.closeRestockModal();
        this.renderAll();
    }

    closeRestockModal() {
        document.getElementById('restock-modal').classList.remove('active');
    }

    /* ==================== MÓDULO 3: FECHAMENTO & CONFERÊNCIA EVO ==================== */
    renderShiftModule() {
        const shift = this.state.activeShift;
        if (!shift) return;

        const currentName = this.currentUser ? `${this.currentUser.name} [${this.currentUser.code.toUpperCase()}]` : 'Luan [F20729]';
        document.getElementById('shift-operator-name').innerText = currentName;
        document.getElementById('shift-start-time').innerText = new Date(shift.startTime).toLocaleString('pt-BR');
        
        const shiftSales = shift.sales || [];
        document.getElementById('shift-sales-count').innerText = `${shiftSales.length} vendas registradas`;

        let pix = 0, card = 0, cash = 0;
        let cardPixCount = 0;

        shiftSales.forEach(sale => {
            if (sale.status !== 'CANCELADA') {
                if (sale.paymentMethod === 'pix') {
                    pix += sale.total;
                    cardPixCount++;
                } else if (sale.paymentMethod === 'dinheiro') {
                    cash += sale.total;
                } else {
                    card += sale.total;
                    cardPixCount++;
                }
            }
        });

        const total = pix + card + cash;

        document.getElementById('shift-val-pix').innerText = `R$ ${pix.toFixed(2).replace('.', ',')}`;
        document.getElementById('shift-val-card').innerText = `R$ ${card.toFixed(2).replace('.', ',')}`;
        document.getElementById('shift-val-cash').innerText = `R$ ${cash.toFixed(2).replace('.', ',')}`;
        document.getElementById('shift-val-total').innerText = `R$ ${total.toFixed(2).replace('.', ',')}`;

        const slipsBody = document.getElementById('shift-slips-table-body');
        const slipsCounter = document.getElementById('slips-card-counter');
        
        if (slipsCounter) {
            slipsCounter.innerText = `${cardPixCount} via(s) de Cartão/Pix para grampear no EVO`;
        }

        if (slipsBody) {
            slipsBody.innerHTML = '';
            if (shiftSales.length === 0) {
                slipsBody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:#94a3b8; padding: 14px;">Nenhuma venda realizada neste turno até o momento.</td></tr>';
            } else {
                shiftSales.forEach(s => {
                    const tr = document.createElement('tr');
                    const itemsText = s.items.map(it => `${it.qty}x ${it.name}`).join(', ');
                    const isCardOrPix = s.paymentMethod !== 'dinheiro';

                    tr.innerHTML = `
                        <td><span class="slip-code-tag">${s.id}</span></td>
                        <td>${s.dateFormatted || '--:--'}</td>
                        <td><strong>${s.paymentMethod.toUpperCase()}</strong></td>
                        <td><strong>R$ ${s.total.toFixed(2).replace('.', ',')}</strong></td>
                        <td><small>${itemsText}</small></td>
                        <td>${s.operatorName}</td>
                        <td>
                            ${isCardOrPix 
                                ? `<span class="badge badge-blue">📎 Grampear Via #${s.id}</span>` 
                                : `<span class="badge" style="background:#e2e8f0; color:#475569;">💵 Dinheiro (Gaveta)</span>`}
                        </td>
                    `;
                    slipsBody.appendChild(tr);
                });
            }
        }

        this.renderShiftHistory();
    }

    async reconcileShift() {
        const countedCash = parseFloat(document.getElementById('blind-cash-input').value) || 0;
        const opCode = this.currentUser ? this.currentUser.code.toUpperCase() : 'F20729';
        const opName = this.currentUser ? `${this.currentUser.name} [${opCode}]` : 'Luan [F20729]';

        try {
            const res = await fetch(`${this.API_BASE}/api/shift/close`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    countedCash,
                    operatorId: this.currentUser ? this.currentUser.id : 'f20729',
                    operatorName: opName
                })
            });

            if (res.ok) {
                const data = await res.json();
                this.state = data.state;
                this.saveLocalState(data.state);
                
                const resultBox = document.getElementById('blind-result-box');
                resultBox.style.display = 'block';
                const diff = data.closedShift.diff;
                
                if (Math.abs(diff) < 0.05) {
                    resultBox.className = 'reconcile-box match';
                    resultBox.innerHTML = `✅ <strong>Turno Fechado e Conferido com Sucesso!</strong><br>Operador: ${opName}<br>Dinheiro em Gaveta: R$ ${countedCash.toFixed(2).replace('.', ',')} (Divergência: R$ 0,00).`;
                } else {
                    resultBox.className = 'reconcile-box diff';
                    resultBox.innerHTML = `⚠️ <strong>Divergência Registrada no Fechamento:</strong><br>Operador: ${opName}<br>Diferença: ${diff > 0 ? '+R$ ' + diff.toFixed(2).replace('.', ',') + ' (Sobra)' : '-R$ ' + Math.abs(diff).toFixed(2).replace('.', ',') + ' (Falta)'}`;
                }
            }
        } catch (e) {
            alert('⚠️ Fechamento gravado localmente.');
        }

        this.renderAll();
    }

    renderShiftHistory() {
        const container = document.getElementById('shift-history-list');
        if (!container) return;
        container.innerHTML = '';

        if (!this.state.shifts || this.state.shifts.length === 0) {
            container.innerHTML = '<p style="color:#94a3b8; font-size:8.5pt;">Nenhum turno fechado anteriormente.</p>';
            return;
        }

        this.state.shifts.slice(0, 8).forEach(sh => {
            const item = document.createElement('div');
            item.className = 'shift-history-item';
            item.innerHTML = `
                <div class="sh-header">
                    <span>${sh.shiftCode || 'Turno'} - ${sh.operatorName}</span>
                    <span style="color: #ea580c;">R$ ${sh.totalRevenue.toFixed(2).replace('.', ',')}</span>
                </div>
                <div style="color: #64748b; font-size: 7.5pt;">
                    📅 Fechamento: ${new Date(sh.endTime).toLocaleString('pt-BR')}<br>
                    Vendas: ${sh.totalSales} | Gaveta: R$ ${sh.countedCash.toFixed(2).replace('.', ',')} 
                    (${sh.diff === 0 ? 'Exato' : (sh.diff > 0 ? '+R$' + sh.diff.toFixed(2) : '-R$' + Math.abs(sh.diff).toFixed(2))})
                </div>
            `;
            container.appendChild(item);
        });
    }

    printCashReport() {
        window.print();
    }

    /* ==================== MÓDULO 4: AUDITORIA & LOGS ==================== */
    renderAuditLogs() {
        const tbody = document.getElementById('audit-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        let sales = this.state.sales || [];
        if (this.auditQuery) {
            sales = sales.filter(s => 
                s.id.toLowerCase().includes(this.auditQuery) ||
                s.operatorName.toLowerCase().includes(this.auditQuery) ||
                (s.operatorCode && s.operatorCode.toLowerCase().includes(this.auditQuery)) ||
                s.paymentMethod.toLowerCase().includes(this.auditQuery) ||
                s.items.some(it => it.name.toLowerCase().includes(this.auditQuery))
            );
        }

        sales.forEach(sale => {
            const tr = document.createElement('tr');
            const itemsSummary = sale.items.map(it => `${it.qty}x ${it.name}`).join(', ');

            tr.innerHTML = `
                <td><span class="slip-code-tag">${sale.id}</span></td>
                <td>${sale.fullDateTime || sale.dateFormatted}</td>
                <td><strong>${sale.operatorName}</strong></td>
                <td>${itemsSummary}</td>
                <td><span class="badge badge-gray">${sale.paymentMethod.toUpperCase()}</span></td>
                <td><strong>R$ ${sale.total.toFixed(2).replace('.', ',')}</strong></td>
                <td>
                    <span class="badge-status ${sale.status === 'CANCELADA' ? 'badge-cancel' : 'badge-ok'}">
                        ${sale.status}
                    </span>
                    ${sale.cancelReason ? `<br><small style="color:#ef4444;">${sale.cancelReason}</small>` : ''}
                </td>
                <td class="text-right">
                    ${sale.status !== 'CANCELADA' && this.currentUser && this.currentUser.role === 'ADMIN' ? `
                        <button class="btn btn-sm btn-danger" onclick="app.openCancelModal('${sale.id}')">Cancelar</button>
                    ` : '-'}
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    filterAudit(query) {
        this.auditQuery = query.toLowerCase().trim();
        this.renderAuditLogs();
    }

    openCancelModal(saleId) {
        document.getElementById('cancel-sale-id').value = saleId;
        document.getElementById('cancel-reason').value = '';
        document.getElementById('cancel-modal').classList.add('active');
    }

    closeCancelModal() {
        document.getElementById('cancel-modal').classList.remove('active');
    }

    async confirmCancelSale() {
        const saleId = document.getElementById('cancel-sale-id').value;
        const reason = document.getElementById('cancel-reason').value.trim();

        if (!reason) {
            alert('⚠️ A justificativa de cancelamento é obrigatória para a auditoria.');
            return;
        }

        const adminTitle = this.currentUser ? `${this.currentUser.name} [${this.currentUser.code.toUpperCase()}]` : 'Luan [F20729]';

        try {
            const res = await fetch(`${this.API_BASE}/api/sale/cancel`, {
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
                this.state = data.state;
                this.saveLocalState(data.state);
                alert(`✅ Venda ${saleId} cancelada e itens devolvidos ao estoque em todas as máquinas!`);
            }
        } catch (e) {
            alert('⚠️ Erro ao comunicar cancelamento.');
        }

        this.closeCancelModal();
        this.renderAll();
    }

    exportAuditLogs() {
        let csv = 'CodigoVenda;DataHora;Operador;CodigoOperador;Itens;FormaPagamento;Total;Lucro;Status;Justificativa\n';
        (this.state.sales || []).forEach(s => {
            const items = s.items.map(it => `${it.qty}x ${it.name}`).join(' | ');
            csv += `"${s.id}";"${s.fullDateTime || s.dateFormatted}";"${s.operatorName}";"${s.operatorCode || ''}";"${items}";"${s.paymentMethod}";"${s.total.toFixed(2)}";"${s.profit ? s.profit.toFixed(2) : 0}";"${s.status}";"${s.cancelReason || ''}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Auditoria_Lojinha_Panobianco_ViasEVO_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
    }

    // ==================== AUDIT: SUB-ABAS E EVENTOS ====================

    switchAuditTab(tab) {
        const isVendas = tab === 'vendas';

        // Toggle visibilidade
        document.getElementById('audit-view-vendas').style.display = isVendas ? '' : 'none';
        document.getElementById('audit-view-eventos').style.display = isVendas ? 'none' : '';
        document.getElementById('audit-filters-vendas').style.display = isVendas ? '' : 'none';
        document.getElementById('audit-filters-eventos').style.display = isVendas ? 'none' : '';

        // Toggle estilo dos botões
        const btnVendas = document.getElementById('audit-tab-vendas');
        const btnEventos = document.getElementById('audit-tab-eventos');
        if (btnVendas && btnEventos) {
            btnVendas.className = isVendas ? 'btn btn-sm' : 'btn btn-sm btn-secondary';
            btnVendas.style.fontWeight = isVendas ? 'bold' : 'normal';
            btnEventos.className = isVendas ? 'btn btn-sm btn-secondary' : 'btn btn-sm';
            btnEventos.style.fontWeight = isVendas ? 'normal' : 'bold';
        }

        // Carregar eventos do servidor na primeira vez
        if (!isVendas) {
            this.loadAuditEvents();
        }

        this.currentAuditTab = tab;
    }

    async loadAuditEvents() {
        try {
            const search = document.getElementById('audit-event-search')?.value || '';
            const action = document.getElementById('audit-action-filter')?.value || '';
            const dateFrom = document.getElementById('audit-date-from')?.value || '';
            const dateTo = document.getElementById('audit-date-to')?.value || '';

            const params = new URLSearchParams();
            if (search) params.set('search', search);
            if (action) params.set('action', action);
            if (dateFrom) params.set('dateFrom', dateFrom);
            if (dateTo) params.set('dateTo', dateTo + 'T23:59:59');

            const res = await this.authFetch(`${this.API_BASE}/api/audit?${params.toString()}`);
            if (!res.ok) return;

            const data = await res.json();
            this.auditEvents = data.logs || [];

            // Atualizar select de ações
            const select = document.getElementById('audit-action-filter');
            if (select && data.actionTypes) {
                const currentValue = select.value;
                select.innerHTML = '<option value="">Todas as ações</option>';
                data.actionTypes.forEach(a => {
                    const opt = document.createElement('option');
                    opt.value = a;
                    opt.textContent = this.formatActionLabel(a);
                    select.appendChild(opt);
                });
                select.value = currentValue;
            }

            this.renderAuditEvents();
        } catch (e) {
            console.error('Erro ao carregar audit log:', e);
        }
    }

    filterAuditEvents() {
        this.loadAuditEvents();
    }

    renderAuditEvents() {
        const tbody = document.getElementById('audit-events-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        const events = this.auditEvents || [];

        if (events.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:32px;">Nenhum evento encontrado.</td></tr>';
            return;
        }

        events.forEach(ev => {
            const tr = document.createElement('tr');
            const dateStr = ev.created_at ? new Date(ev.created_at.includes('T') ? ev.created_at : ev.created_at + 'Z').toLocaleString('pt-BR') : '-';
            const actionBadge = this.getActionBadge(ev.action);

            tr.innerHTML = `
                <td style="font-size:0.85em;color:#6b7280;white-space:nowrap;">${dateStr}</td>
                <td>${actionBadge}</td>
                <td><code style="font-size:0.8em;">${ev.entity_type || '-'}</code></td>
                <td><code style="font-size:0.8em;">${ev.entity_id || '-'}</code></td>
                <td><strong>${ev.operator_name || '-'}</strong></td>
                <td style="font-size:0.9em;color:#4b5563;">${ev.details || '-'}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    formatActionLabel(action) {
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

    getActionBadge(action) {
        const colors = {
            'LOGIN': '#22c55e', 'LOGOUT': '#6b7280',
            'VENDA': '#3b82f6', 'CANCELAMENTO': '#ef4444',
            'REPOSICAO': '#f59e0b', 'PRODUTO_ATUALIZADO': '#8b5cf6',
            'FOTO_ATUALIZADA': '#06b6d4', 'USUARIO_ATUALIZADO': '#ec4899',
            'FECHAMENTO_TURNO': '#f97316'
        };
        const color = colors[action] || '#6b7280';
        const label = this.formatActionLabel(action);
        return `<span style="background:${color}15;color:${color};padding:2px 8px;border-radius:6px;font-size:0.8em;font-weight:600;white-space:nowrap;">${label}</span>`;
    }

    /* ==================== MÓDULO 5: GESTÃO DE EQUIPE ==================== */
    renderUsersTable() {
        const tbody = document.getElementById('users-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        (this.state.users || []).forEach(u => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><code><strong>${u.code.toUpperCase()}</strong></code></td>
                <td><strong>${u.avatar || '👤'} ${u.name}</strong></td>
                <td>${u.title || '-'}</td>
                <td><span class="badge ${u.role === 'ADMIN' ? 'badge-red' : 'badge-blue'}">${u.role}</span></td>
                <td class="text-right">
                    <button class="btn btn-sm btn-secondary" onclick="app.editUser('${u.code}')">✏️ Editar</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    openNewUserModal() {
        document.getElementById('user-code-input').value = '';
        document.getElementById('user-name-input').value = '';
        document.getElementById('user-title-input').value = '';
        document.getElementById('user-role-input').value = 'OPERADOR';
        document.getElementById('user-modal').classList.add('active');
    }

    editUser(userCode) {
        const user = (this.state.users || []).find(u => u.code.toLowerCase() === userCode.toLowerCase());
        if (!user) return;

        document.getElementById('user-code-input').value = user.code;
        document.getElementById('user-name-input').value = user.name;
        document.getElementById('user-title-input').value = user.title || '';
        document.getElementById('user-role-input').value = user.role;
        document.getElementById('user-modal').classList.add('active');
    }

    async saveUser() {
        const code = document.getElementById('user-code-input').value.trim().toLowerCase();
        const name = document.getElementById('user-name-input').value.trim();
        const title = document.getElementById('user-title-input').value.trim();
        const role = document.getElementById('user-role-input').value;

        if (!code || !name) {
            alert('⚠️ Preencha o código e o nome do colaborador.');
            return;
        }

        const userPayload = {
            id: code,
            code,
            name,
            title: title || (role === 'ADMIN' ? 'Gestor' : 'Recepção'),
            role,
            avatar: role === 'ADMIN' ? '💼' : '👩‍💼'
        };

        try {
            const res = await fetch(`${this.API_BASE}/api/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userPayload)
            });
            if (res.ok) {
                const data = await res.json();
                this.state = data.state;
                this.saveLocalState(data.state);
            }
        } catch (e) {
            const idx = this.state.users.findIndex(u => u.code.toLowerCase() === code);
            if (idx !== -1) {
                this.state.users[idx] = userPayload;
            } else {
                this.state.users.push(userPayload);
            }
            this.saveLocalState(this.state);
        }

        this.closeUserModal();
        this.renderAll();
        alert(`✅ Colaborador ${name} (${code.toUpperCase()}) salvo com sucesso!`);
    }

    closeUserModal() {
        document.getElementById('user-modal').classList.remove('active');
    }

    /* ==================== MÓDULO 6: DASHBOARD ERP (v2.3.0) ==================== */
    renderDashboard() {
        const allSales = this.state.sales || [];
        const activeSales = allSales.filter(s => s.status !== 'CANCELADA');
        const cancelledSales = allSales.filter(s => s.status === 'CANCELADA');
        
        let grossRevenue = 0;
        let totalCost = 0;
        let unitsSold = 0;
        let productMap = {};      // nome → { qty, revenue, cost }
        let operatorMap = {};     // nome → { salesCount, revenue, cost }
        let payMap = { pix: 0, cartao_debito: 0, cartao_credito: 0, dinheiro: 0 };

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
        const fmt = v => `R$ ${v.toFixed(2).replace('.', ',')}`;
        this.setDashEl('dash-gross-revenue', fmt(grossRevenue));
        this.setDashEl('dash-cmv', fmt(totalCost));
        this.setDashEl('dash-net-profit', fmt(netProfit));
        this.setDashEl('dash-avg-margin', `${avgMargin.toFixed(1)}%`);

        // KPIs Linha 2: Operacional
        this.setDashEl('dash-ticket-medio', fmt(ticketMedio));
        this.setDashEl('dash-total-sales', `${activeSales.length}`);
        this.setDashEl('dash-units-sold', `${unitsSold} un.`);
        this.setDashEl('dash-cancel-rate', `${cancelledSales.length} (${cancelRate.toFixed(0)}%)`);

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
                        <span><strong>#${index + 1}</strong> ${name}</span>
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
                <div class="pay-dist-row"><span>💠 Pix:</span><strong>${fmt(payMap.pix || 0)}${pct(payMap.pix || 0)}</strong></div>
                <div class="pay-dist-row"><span>💳 Cartão Débito:</span><strong>${fmt(payMap.cartao_debito || 0)}${pct(payMap.cartao_debito || 0)}</strong></div>
                <div class="pay-dist-row"><span>💳 Cartão Crédito:</span><strong>${fmt(payMap.cartao_credito || 0)}${pct(payMap.cartao_credito || 0)}</strong></div>
                <div class="pay-dist-row"><span>💵 Dinheiro:</span><strong>${fmt(payMap.dinheiro || 0)}${pct(payMap.dinheiro || 0)}</strong></div>
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
                    const opProfit = data.revenue - data.cost;
                    const row = document.createElement('div');
                    row.className = 'top-prod-row';
                    row.style.flexWrap = 'wrap';
                    row.innerHTML = `
                        <span style="flex:1;"><strong>#${index + 1}</strong> ${name}</span>
                        <span style="font-size:0.85em;color:#6b7280;">${data.salesCount} vendas</span>
                        <span style="font-size:0.85em;color:#3b82f6;margin-left:8px;">Ticket: ${fmt(opTicket)}</span>
                        <strong style="color:#16a34a;margin-left:8px;">${fmt(data.revenue)}</strong>
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
                        <span><strong>#${index + 1}</strong> ${prod.name} <small style="color:#9ca3af;">(${prod.qty}un)</small></span>
                        <span><strong style="color:#16a34a;">${fmt(prod.profit)}</strong> <small style="color:#6b7280;">${margin}%</small></span>
                    `;
                    profitContainer.appendChild(row);
                });
            }
        }
    }

    setDashEl(id, value) {
        const el = document.getElementById(id);
        if (el) el.innerText = value;
    }

    backupDatabase() {
        const json = JSON.stringify(this.state, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Backup_Panobianco_PDV_${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
    }

    renderAll() {
        this.renderProductsGrid();
        this.renderStockTable();
        this.renderShiftModule();
        this.renderAuditLogs();
        this.renderUsersTable();
        this.renderDashboard();
        this.updateStockAlerts();
    }

    updateStockAlerts() {
        const banner = document.getElementById('stock-alert-banner');
        if (!banner) return;

        const products = this.state.products || [];
        const outOfStock = products.filter(p => p.stock <= 0);
        const critical = products.filter(p => p.stock > 0 && p.stock <= p.minStock);

        if (outOfStock.length === 0 && critical.length === 0) {
            banner.style.display = 'none';
            return;
        }

        banner.style.display = 'flex';
        const titleEl = document.getElementById('stock-alert-title');
        const detailEl = document.getElementById('stock-alert-detail');

        const parts = [];
        if (outOfStock.length > 0) {
            const names = outOfStock.slice(0, 3).map(p => p.name).join(', ');
            const extra = outOfStock.length > 3 ? ` e mais ${outOfStock.length - 3}` : '';
            parts.push(`🔴 ${outOfStock.length} esgotado(s): ${names}${extra}`);
        }
        if (critical.length > 0) {
            const names = critical.slice(0, 3).map(p => `${p.name} (${p.stock}un)`).join(', ');
            const extra = critical.length > 3 ? ` e mais ${critical.length - 3}` : '';
            parts.push(`🟡 ${critical.length} crítico(s): ${names}${extra}`);
        }

        if (titleEl) {
            titleEl.textContent = outOfStock.length > 0 ? '⚠️ Atenção: Produtos Esgotados!' : '⚠️ Estoque Crítico';
            titleEl.style.color = outOfStock.length > 0 ? '#dc2626' : '#d97706';
        }
        if (detailEl) detailEl.textContent = parts.join(' | ');
    }
}

const app = new PanobiancoApp();
