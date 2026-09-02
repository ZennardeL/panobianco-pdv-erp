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
        this.useSupabase = false;
        this.state = this.loadLocalState();
        this.currentUser = null;
        this.authToken = sessionStorage.getItem('panobianco_token') || null;
        this.cart = [];
        this.selectedPaymentMethod = 'pix';
        this.activeCategory = 'todas';
        this.tempQuickPhotoBase64 = null;
        this.tempProductPhotoBase64 = null;
        this.stockSearchQuery = '';
        this.syncInterval = null;
        this.editingUserOriginalCode = null;
        
        this.init();
    }

    async init() {
        // 1. Tentar conectar ao Supabase Cloud (se configurado)
        if (typeof supabaseAdapter !== 'undefined' && supabaseAdapter.init()) {
            this.useSupabase = true;
            console.log('⚡ Modo Supabase Cloud Realtime Ativado.');
            await this.syncWithSupabase(false);
            supabaseAdapter.subscribeRealtime((type, payload) => this.handleRealtimeUpdate(type, payload));
            this.updateSyncBadge(true, true);
        } else {
            this.useSupabase = false;
        }

        // 2. Tentar recuperar sessão existente
        const savedUser = sessionStorage.getItem('panobianco_user');
        if (savedUser) {
            try {
                this.currentUser = JSON.parse(savedUser);
                this.onLoginSuccess(this.currentUser);
                this.renderAll();
                if (!this.useSupabase) this.startPolling();
                return;
            } catch (e) { /* fallthrough para login */ }
        }

        if (this.authToken && !this.useSupabase) {
            const ok = await this.syncWithServer(false);
            if (ok && savedUser) {
                this.currentUser = JSON.parse(savedUser);
                this.onLoginSuccess(this.currentUser);
                this.renderAll();
                this.startPolling();
                return;
            }
            this.clearSession();
        }

        this.showLoginModal();
        this.renderAll();
    }

    startPolling() {
        if (this.syncInterval) clearInterval(this.syncInterval);
        if (this.useSupabase) return; // Supabase usa WebSockets Realtime nativos!
        this.syncInterval = setInterval(() => {
            this.syncWithServer(false);
        }, 2500);
    }

    async syncWithSupabase(showFeedback = true) {
        try {
            const cloudState = await supabaseAdapter.getFullState();
            this.state = cloudState;
            this.saveLocalState(cloudState);
            this.isOnline = true;
            this.updateSyncBadge(true, true);
            this.renderAll();
            return true;
        } catch (e) {
            console.warn('⚠️ Falha ao sincronizar com Supabase Cloud:', e);
            this.isOnline = false;
            this.updateSyncBadge(false, true);
            return false;
        }
    }

    handleRealtimeUpdate(type, payload) {
        console.log(`⚡ [Realtime Push Recebido: ${type}] Atualizando tela instantaneamente...`);
        this.syncWithSupabase(false);
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
        if (this.useSupabase) return this.syncWithSupabase(showFeedback);
        try {
            const headers = { 'Cache-Control': 'no-store' };
            if (this.authToken) {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }
            const res = await fetch(`${this.API_BASE}/api/state`, { headers });
            if (res.status === 401) {
                this.clearSession();
                this.showLoginModal();
                return false;
            }
            if (res.ok) {
                const serverState = await res.json();
                this.state = serverState;
                this.saveLocalState(serverState);
                this.isOnline = true;
                this.updateSyncBadge(true, false);
                this.renderAll();
                return true;
            } else {
                throw new Error('Servidor indisponível');
            }
        } catch (e) {
            this.isOnline = false;
            this.updateSyncBadge(false, false);
            if (showFeedback) console.warn('Modo Offline: Operando com dados locais.');
            return false;
        }
    }

    updateSyncBadge(online, isSupabase = this.useSupabase) {
        let badge = document.getElementById('sync-status-badge');
        if (badge) {
            if (isSupabase) {
                if (online) {
                    badge.innerHTML = '⚡ Supabase Cloud Realtime';
                    badge.className = 'sync-badge online';
                    badge.title = 'Conectado em tempo real com o Supabase Cloud (WebSockets ativos)';
                } else {
                    badge.innerHTML = '🟡 Supabase Reconectando...';
                    badge.className = 'sync-badge offline';
                    badge.title = 'Tentando reconectar com a nuvem Supabase.';
                }
            } else {
                if (online) {
                    badge.innerHTML = '🟢 PC Recepção 24h';
                    badge.className = 'sync-badge online';
                    badge.title = 'Conectado e sincronizado com o PC da Recepção 24h';
                } else {
                    badge.innerHTML = '🟡 Modo Local';
                    badge.className = 'sync-badge offline';
                    badge.title = 'Operando localmente. Sincronizará com o PC 24h.';
                }
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

        if (this.useSupabase) {
            const user = (this.state.users || []).find(u => u.code.toLowerCase() === codeInput);
            if (user && user.active !== false) {
                this.currentUser = user;
                sessionStorage.setItem('panobianco_user', JSON.stringify(user));
                this.onLoginSuccess(user);
                await this.syncWithSupabase(false);
                return;
            } else {
                errorEl.innerText = '❌ Código de colaborador não encontrado no sistema!';
                errorEl.style.display = 'block';
                return;
            }
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
            const onclickAttr = btn.getAttribute('onclick') || '';
            btn.classList.toggle('active', onclickAttr.includes(`'${category}'`));
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
            if (this.activeCategory === 'bebidas') {
                filtered = filtered.filter(p => p.category === 'bebidas' || p.category === 'energeticos');
            } else {
                filtered = filtered.filter(p => p.category === this.activeCategory);
            }
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

        if (this.useSupabase) {
            try {
                const result = await supabaseAdapter.processSale(salePayload);
                if (result && result.success) {
                    this.showSuccessModal(result.sale);
                    this.cart = [];
                    this.renderCart();
                    await this.syncWithSupabase(false);
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
        let itemsList = (sale.items || []).map(it => `&bull; ${it.qty}x ${it.name} (R$ ${(it.price * it.qty).toFixed(2).replace('.', ',')})`).join('<br>');
        
        preview.innerHTML = `
            <strong>Comprovante da Lojinha (#${sale.id})</strong><br>
            ⏰ Horário: ${sale.dateFormatted || new Date().toLocaleTimeString('pt-BR')}<br>
            👤 <strong>Operador: ${sale.operatorName}</strong><br>
            💳 Pagamento: <strong>${(sale.paymentMethod || '').toUpperCase()}</strong><br>
            <hr style="margin: 6px 0; border: 0; border-top: 1px dashed #cbd5e1;">
            ${itemsList}<br>
            <hr style="margin: 6px 0; border: 0; border-top: 1px dashed #cbd5e1;">
            <strong style="color: #0f172a; font-size: 11pt;">TOTAL: R$ ${Number(sale.total).toFixed(2).replace('.', ',')}</strong>
        `;

        document.getElementById('success-modal').classList.add('active');
    }

    closeSuccessModal() {
        document.getElementById('success-modal').classList.remove('active');
    }

    async cancelLastSale() {
        if (!this.lastSaleId) return;

        const reason = prompt(`⚠️ Cancelar venda ${this.lastSaleId}?\n\nDigite o motivo do cancelamento (ex: "erro de produto", "cliente desistiu"):`, 'Erro de operação — cancelamento imediato');
        
        if (!reason) return;

        if (this.useSupabase) {
            try {
                const opId = this.currentUser ? this.currentUser.id : 'f20729';
                const opName = this.currentUser ? `${this.currentUser.name} [${this.currentUser.code.toUpperCase()}]` : 'Luan [F20729]';
                const isAdmin = this.currentUser && this.currentUser.role === 'ADMIN';

                const res = await supabaseAdapter.cancelSale(this.lastSaleId, opId, opName, reason, isAdmin);
                if (res && res.success) {
                    alert(`✅ Venda ${this.lastSaleId} cancelada com sucesso!\nEstoque devolvido no Supabase Cloud.`);
                    this.lastSaleId = null;
                    this.closeSuccessModal();
                    await this.syncWithSupabase(false);
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
    filterStockTable(query) {
        this.stockSearchQuery = (query || '').trim().toLowerCase();
        this.renderStockTable();
    }

    detectDuplicateProducts() {
        const products = this.state.products || [];
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

        const duplicateGroups = this.detectDuplicateProducts();
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

        let totalProducts = (this.state.products || []).length;
        let criticalCount = 0;
        let totalCostValue = 0;
        let totalPotentialRevenue = 0;

        let filteredProducts = this.state.products || [];
        if (this.stockSearchQuery) {
            filteredProducts = filteredProducts.filter(p => 
                (p.name || '').toLowerCase().includes(this.stockSearchQuery) ||
                (p.category || '').toLowerCase().includes(this.stockSearchQuery)
            );
        }

        (this.state.products || []).forEach(prod => {
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
                    statusBadge = `<span class="badge-status" style="background:#fffbeb; color:#d97706;">Crítico (${prod.stock})</span>`;
                }

                const photoCell = prod.image
                    ? `<img src="${prod.image}" class="table-prod-photo-thumb" alt="${prod.name}">`
                    : `<div class="table-prod-emoji-thumb">${prod.icon || '📦'}</div>`;

                tr.innerHTML = `
                    <td>${photoCell}</td>
                    <td>
                        <strong>${prod.name}</strong>
                        ${isDuplicate ? '<span class="badge badge-red" style="margin-left:6px;" title="Existe outro produto com nome similar">⚠️ Duplicado</span>' : ''}
                    </td>
                    <td><span style="font-size:0.85em;font-weight:600;color:#475569;">${this.formatCategoryLabel(prod.category)}</span></td>
                    ${isAdmin ? `<td>R$ ${prod.cost.toFixed(2).replace('.', ',')}</td>` : ''}
                    <td><strong>R$ ${prod.price.toFixed(2).replace('.', ',')}</strong></td>
                    ${isAdmin ? `<td style="color: #10b981; font-weight: 700;">${margin.toFixed(0)}%</td>` : ''}
                    <td><strong>${prod.stock} un.</strong></td>
                    <td>${statusBadge}</td>
                    <td class="text-right">
                        <button class="btn btn-sm btn-secondary" onclick="app.openQuickPhotoModal('${prod.id}')" title="Alterar ou Remover Foto">📷 Foto</button>
                        <button class="btn btn-sm btn-secondary" onclick="app.openRestockModal('${prod.id}')" title="Entrada de Estoque">➕ Entrada</button>
                        ${isAdmin ? `<button class="btn btn-sm btn-secondary" onclick="app.editProduct('${prod.id}')" title="Editar Produto">✏️</button>` : ''}
                        ${isAdmin ? `<button class="btn btn-sm btn-danger" onclick="app.confirmDeleteProduct('${prod.id}')" title="Excluir Produto">🗑️</button>` : ''}
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
            if (elCost) elCost.innerText = `R$ ${totalCostValue.toFixed(2).replace('.', ',')}`;
            if (elPot) elPot.innerText = `R$ ${totalPotentialRevenue.toFixed(2).replace('.', ',')}`;
        }
    }

    formatCategoryLabel(cat) {
        switch ((cat || '').toLowerCase()) {
            case 'bebidas':
            case 'energeticos':
                return '🥤 Bebidas & Energéticos';
            case 'proteicos':
                return '🍫 Barrinhas & Whey';
            case 'suplementos':
                return '🏋️ Suplementos & Doses';
            case 'roupas':
            case 'vestuario':
                return '👕 Roupas & Vestuário';
            case 'acessorios':
                return '🎒 Acessórios & Brindes';
            default:
                return cat ? cat.toUpperCase() : '-';
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
        const removeBtn = document.getElementById('btn-quick-remove-photo');
        if (fileInput) fileInput.value = '';

        if (prod.image) {
            previewImg.src = prod.image;
            previewImg.style.display = 'block';
            placeholder.style.display = 'none';
            if (removeBtn) removeBtn.style.display = 'inline-flex';
        } else {
            previewImg.src = '';
            previewImg.style.display = 'none';
            placeholder.style.display = 'block';
            if (removeBtn) removeBtn.style.display = 'none';
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
                this.compressImage(e.target.result, 300, 300, (compressedBase64) => {
                    this.tempQuickPhotoBase64 = compressedBase64;
                    const previewImg = document.getElementById('quick-photo-preview-img');
                    const placeholder = document.getElementById('quick-photo-placeholder');
                    const removeBtn = document.getElementById('btn-quick-remove-photo');
                    previewImg.src = compressedBase64;
                    previewImg.style.display = 'block';
                    placeholder.style.display = 'none';
                    if (removeBtn) removeBtn.style.display = 'inline-flex';
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

        if (this.useSupabase) {
            try {
                await supabaseAdapter.uploadProductPhoto(prodId, this.tempQuickPhotoBase64);
                alert('✅ Foto cadastrada e salva na Nuvem Supabase com sucesso!');
                await this.syncWithSupabase(false);
                this.closeQuickPhotoModal();
                this.renderAll();
                return;
            } catch (e) {
                console.error('❌ Erro no upload de foto Supabase:', e);
                alert(`❌ Erro ao salvar foto no Supabase: ${e.message}`);
                return;
            }
        }

        try {
            const res = await this.authFetch(`${this.API_BASE}/api/product/photo`, {
                method: 'POST',
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

    async removeQuickPhoto() {
        const prodId = document.getElementById('quick-photo-prod-id').value;
        const prod = (this.state.products || []).find(p => p.id === prodId);
        if (!prod) return;

        if (!confirm(`🗑️ Deseja remover a foto de "${prod.name}" e voltar a exibir o ícone padrão?`)) return;

        const opName = this.currentUser ? `${this.currentUser.name} [${this.currentUser.code.toUpperCase()}]` : 'Luan [F20729]';

        if (this.useSupabase) {
            try {
                await supabaseAdapter.removeProductPhoto(prodId, prod.name, opName);
                alert('✅ Foto removida com sucesso no Supabase Cloud!');
                await this.syncWithSupabase(false);
                this.closeQuickPhotoModal();
                this.renderAll();
                return;
            } catch (e) {
                console.error('❌ Erro ao remover foto:', e);
                alert(`❌ Erro ao remover foto: ${e.message}`);
                return;
            }
        }

        try {
            const res = await this.authFetch(`${this.API_BASE}/api/product/photo/remove`, {
                method: 'POST',
                body: JSON.stringify({ productId: prodId })
            });

            if (res.ok) {
                const data = await res.json();
                this.state = data.state;
                this.saveLocalState(data.state);
                alert('✅ Foto removida com sucesso!');
            }
        } catch (e) {
            if (prod) {
                prod.image = '';
                this.saveLocalState(this.state);
                alert('✅ Foto removida localmente com sucesso!');
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
        const removePhotoBtn = document.getElementById('btn-remove-prod-photo');
        const deleteProdBtn = document.getElementById('btn-modal-delete-prod');

        previewImg.style.display = 'none';
        placeholder.style.display = 'block';
        if (removePhotoBtn) removePhotoBtn.style.display = 'none';
        if (deleteProdBtn) deleteProdBtn.style.display = 'none';
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
        const removePhotoBtn = document.getElementById('btn-remove-prod-photo');
        const deleteProdBtn = document.getElementById('btn-modal-delete-prod');

        if (deleteProdBtn) deleteProdBtn.style.display = 'inline-flex';

        if (prod.image) {
            previewImg.src = prod.image;
            previewImg.style.display = 'block';
            placeholder.style.display = 'none';
            if (removePhotoBtn) removePhotoBtn.style.display = 'inline-flex';
            this.tempProductPhotoBase64 = prod.image;
        } else {
            previewImg.style.display = 'none';
            placeholder.style.display = 'block';
            if (removePhotoBtn) removePhotoBtn.style.display = 'none';
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
                    const removePhotoBtn = document.getElementById('btn-remove-prod-photo');
                    previewImg.src = compressedBase64;
                    previewImg.style.display = 'block';
                    placeholder.style.display = 'none';
                    if (removePhotoBtn) removePhotoBtn.style.display = 'inline-flex';
                });
            };
            reader.readAsDataURL(file);
        }
    }

    removeProductPhotoFromModal() {
        this.tempProductPhotoBase64 = '';
        document.getElementById('edit-prod-image').value = '';
        const fileInput = document.getElementById('prod-photo-input');
        if (fileInput) fileInput.value = '';

        const previewImg = document.getElementById('prod-photo-preview-img');
        const placeholder = document.getElementById('prod-photo-placeholder');
        const removeBtn = document.getElementById('btn-remove-prod-photo');

        if (previewImg) {
            previewImg.src = '';
            previewImg.style.display = 'none';
        }
        if (placeholder) placeholder.style.display = 'block';
        if (removeBtn) removeBtn.style.display = 'none';
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
        const image = this.tempProductPhotoBase64 !== null ? this.tempProductPhotoBase64 : (document.getElementById('edit-prod-image').value || '');

        if (!name || price <= 0) {
            alert('⚠️ Preencha o nome e o preço de venda corretamente.');
            return;
        }

        const prodId = id || ('prod_' + Date.now());
        const productPayload = { id: prodId, name, category, icon, cost, price, stock, minStock, image };

        if (this.useSupabase) {
            try {
                let imageUrl = image;
                if (this.tempProductPhotoBase64 && this.tempProductPhotoBase64.startsWith('data:')) {
                    imageUrl = await supabaseAdapter.uploadProductPhoto(prodId, this.tempProductPhotoBase64);
                }
                productPayload.image = imageUrl;
                await supabaseAdapter.upsertProduct(productPayload);
                alert('✅ Produto salvo com sucesso no Supabase Cloud!');
                await this.syncWithSupabase(false);
                this.closeProductModal();
                this.renderAll();
                return;
            } catch (e) {
                console.error('❌ Erro ao salvar produto no Supabase:', e);
                alert(`❌ Erro ao salvar produto: ${e.message}`);
                return;
            }
        }

        try {
            const res = await this.authFetch(`${this.API_BASE}/api/product`, {
                method: 'POST',
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
                this.state.products.push(productPayload);
            }
        }

        this.saveLocalState(this.state);
        this.closeProductModal();
        this.renderAll();
    }

    async confirmDeleteProduct(productId) {
        const prod = (this.state.products || []).find(p => p.id === productId);
        if (!prod) return;

        const confirmMsg = `⚠️ ATENÇÃO: Deseja EXCLUIR o produto abaixo?\n\n` +
            `📦 ${prod.name}\n` +
            `💰 Preço: R$ ${prod.price.toFixed(2).replace('.', ',')} | Estoque: ${prod.stock} un.\n\n` +
            `Esta ação removerá o produto do catálogo e da frente de caixa.`;

        if (!confirm(confirmMsg)) return;

        await this.deleteProductById(productId, prod.name);
    }

    async deleteCurrentEditingProduct() {
        const id = document.getElementById('edit-prod-id').value;
        const name = document.getElementById('prod-name').value;
        if (!id) return;

        if (!confirm(`⚠️ Deseja excluir permanentemente o produto "${name}"?`)) return;

        this.closeProductModal();
        await this.deleteProductById(id, name);
    }

    async deleteProductById(productId, productName = '') {
        const opName = this.currentUser ? `${this.currentUser.name} [${this.currentUser.code.toUpperCase()}]` : 'Luan [F20729]';

        if (this.useSupabase) {
            try {
                await supabaseAdapter.deleteProduct(productId, productName, opName);
                alert(`✅ Produto "${productName || productId}" excluído com sucesso do Supabase Cloud!`);
                await this.syncWithSupabase(false);
                this.renderAll();
                return;
            } catch (err) {
                console.error('❌ Erro ao excluir produto no Supabase:', err);
                alert(`❌ Erro ao excluir produto: ${err.message || err}`);
                return;
            }
        }

        try {
            const res = await this.authFetch(`${this.API_BASE}/api/product/delete`, {
                method: 'POST',
                body: JSON.stringify({ productId })
            });

            if (res.ok) {
                const data = await res.json();
                this.state = data.state;
                this.saveLocalState(data.state);
                alert(`✅ Produto "${productName}" excluído com sucesso!`);
            } else {
                const data = await res.json();
                alert(`❌ ${data.error || 'Erro ao excluir produto.'}`);
            }
        } catch (e) {
            this.state.products = (this.state.products || []).filter(p => p.id !== productId);
            this.saveLocalState(this.state);
            alert(`✅ Produto excluído localmente com sucesso!`);
        }

        this.renderAll();
    }

    /* ==================== GESTÃO DE DUPLICADOS ==================== */
    openDuplicatesModal() {
        this.renderDuplicatesList();
        document.getElementById('duplicates-modal').classList.add('active');
    }

    closeDuplicatesModal() {
        document.getElementById('duplicates-modal').classList.remove('active');
    }

    renderDuplicatesList() {
        const container = document.getElementById('duplicates-list-container');
        if (!container) return;

        const duplicateGroups = this.detectDuplicateProducts();

        if (duplicateGroups.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 28px; color: #64748b;">
                    <div style="font-size: 32pt; margin-bottom: 8px;">✨</div>
                    <strong style="color: #0f172a; font-size: 11pt;">Nenhum produto duplicado encontrado!</strong>
                    <p style="font-size: 9pt; margin-top: 4px;">Seu catálogo está organizado e sem redundâncias.</p>
                </div>
            `;
            return;
        }

        let html = '';
        duplicateGroups.forEach((group, gIdx) => {
            html += `
                <div class="duplicate-group-card">
                    <div class="duplicate-group-header">
                        <div class="duplicate-group-title">
                            📌 Grupo ${gIdx + 1}: <span>"${group.name}"</span> (${group.items.length} itens)
                        </div>
                    </div>
            `;

            group.items.forEach((item, itemIdx) => {
                const isFirst = itemIdx === 0;
                const photoDisplay = item.image 
                    ? `<img src="${item.image}" class="table-prod-photo-thumb" style="width:28px;height:28px;" alt="${item.name}">` 
                    : `<span style="font-size: 14pt;">${item.icon || '📦'}</span>`;

                html += `
                    <div class="duplicate-item-row" style="${isFirst ? 'border-left: 4px solid var(--primary);' : ''}">
                        <div class="duplicate-item-info">
                            ${photoDisplay}
                            <div>
                                <strong style="color: #0f172a; font-size: 9pt;">${item.name}</strong> ${isFirst ? '<span class="badge badge-blue">Principal</span>' : ''}
                                <div style="font-size: 7.5pt; color: #64748b; margin-top: 2px;">
                                    ID: <code>${item.id}</code> &bull; Estoque: <strong>${item.stock} un</strong> &bull; Venda: <strong>R$ ${item.price.toFixed(2).replace('.', ',')}</strong>
                                </div>
                            </div>
                        </div>
                        <div class="duplicate-item-actions">
                            ${!isFirst ? `
                                <button class="btn btn-sm btn-primary" onclick="app.mergeDuplicateItem('${group.items[0].id}', '${item.id}')" title="Somar estoque deste item no principal e excluí-lo">
                                    🔄 Mesclar c/ Principal
                                </button>
                            ` : ''}
                            <button class="btn btn-sm btn-danger" onclick="app.deleteDuplicateItem('${item.id}', '${item.name}')" title="Excluir este item duplicado">
                                🗑️ Excluir
                            </button>
                        </div>
                    </div>
                `;
            });

            html += `</div>`;
        });

        container.innerHTML = html;
    }

    async deleteDuplicateItem(productId, productName) {
        if (!confirm(`🗑️ Excluir a duplicata "${productName}" (ID: ${productId})?`)) return;
        await this.deleteProductById(productId, productName);
        this.renderDuplicatesList();
    }

    async mergeDuplicateItem(primaryId, duplicateId) {
        const primary = (this.state.products || []).find(p => p.id === primaryId);
        const duplicate = (this.state.products || []).find(p => p.id === duplicateId);
        if (!primary || !duplicate) return;

        const confirmMsg = `🔄 Deseja MESCLAR "${duplicate.name}" no produto principal "${primary.name}"?\n\n` +
            `• O estoque de ${duplicate.stock} unidades será SOMADO ao produto principal (novo estoque: ${primary.stock + duplicate.stock} un).\n` +
            `• A duplicata (ID: ${duplicate.id}) será excluída automaticamente.`;

        if (!confirm(confirmMsg)) return;

        const addedQty = duplicate.stock;
        primary.stock += addedQty;

        if (!primary.image && duplicate.image) {
            primary.image = duplicate.image;
        }

        if (this.useSupabase) {
            await supabaseAdapter.upsertProduct(primary);
            await supabaseAdapter.deleteProduct(duplicateId, duplicate.name, this.currentUser ? this.currentUser.name : 'ADMIN');
            await this.syncWithSupabase(false);
        } else {
            try {
                await this.authFetch(`${this.API_BASE}/api/product`, {
                    method: 'POST',
                    body: JSON.stringify(primary)
                });
                await this.authFetch(`${this.API_BASE}/api/product/delete`, {
                    method: 'POST',
                    body: JSON.stringify({ productId: duplicateId })
                });
            } catch (e) {
                this.state.products = this.state.products.filter(p => p.id !== duplicateId);
                this.saveLocalState(this.state);
            }
        }

        alert(`✅ Mesclagem concluída com sucesso!\nEstoque atual do produto principal: ${primary.stock} unidades.`);
        this.renderAll();
        this.renderDuplicatesList();
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

        if (this.useSupabase) {
            try {
                const opId = this.currentUser ? this.currentUser.id : 'f20729';
                const opName = this.currentUser ? `${this.currentUser.name} [${this.currentUser.code.toUpperCase()}]` : 'Luan [F20729]';
                await supabaseAdapter.restockProduct(id, qty, opId, opName);
                alert(`✅ Entrada de ${qty} unidades confirmada no Supabase Cloud!`);
                await this.syncWithSupabase(false);
                this.closeRestockModal();
                this.renderAll();
                return;
            } catch (e) {
                console.error('❌ Erro na reposição Supabase:', e);
                alert(`❌ Erro na reposição: ${e.message}`);
                return;
            }
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

        if (this.useSupabase) {
            try {
                const opId = this.currentUser ? this.currentUser.id : 'f20729';
                const res = await supabaseAdapter.closeShift(countedCash, opId, opName);
                const resultBox = document.getElementById('blind-result-box');
                if (resultBox) {
                    resultBox.style.display = 'block';
                    const diff = res.diff;
                    if (Math.abs(diff) < 0.05) {
                        resultBox.className = 'reconcile-box match';
                        resultBox.innerHTML = `✅ <strong>Turno Fechado e Conferido com Sucesso no Supabase Cloud!</strong><br>Operador: ${opName}<br>Dinheiro em Gaveta: R$ ${countedCash.toFixed(2).replace('.', ',')} (Divergência: R$ 0,00).`;
                    } else {
                        resultBox.className = 'reconcile-box diff';
                        resultBox.innerHTML = `⚠️ <strong>Divergência Registrada no Fechamento:</strong><br>Operador: ${opName}<br>Diferença: ${diff > 0 ? '+R$ ' + diff.toFixed(2).replace('.', ',') + ' (Sobra)' : '-R$ ' + Math.abs(diff).toFixed(2).replace('.', ',') + ' (Falta)'}`;
                    }
                }
                await this.syncWithSupabase(false);
                return;
            } catch (e) {
                console.error('❌ Erro ao fechar turno no Supabase:', e);
                alert(`❌ Erro ao fechar turno: ${e.message}`);
                return;
            }
        }

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

    renderEvoPrintSheet() {
        const sheet = document.getElementById('evo-print-sheet');
        if (!sheet) return;

        const shift = this.state.activeShift || {};
        const shiftSales = (shift.sales || []).filter(s => s.status !== 'CANCELADA');
        
        let pixTotal = 0, pixCount = 0;
        let debitTotal = 0, debitCount = 0;
        let creditTotal = 0, creditCount = 0;
        let cashTotal = 0, cashCount = 0;

        shiftSales.forEach(s => {
            const tot = Number(s.total) || 0;
            if (s.paymentMethod === 'pix') {
                pixTotal += tot;
                pixCount++;
            } else if (s.paymentMethod === 'cartao_debito') {
                debitTotal += tot;
                debitCount++;
            } else if (s.paymentMethod === 'cartao_credito' || s.paymentMethod === 'cartao') {
                creditTotal += tot;
                creditCount++;
            } else if (s.paymentMethod === 'dinheiro') {
                cashTotal += tot;
                cashCount++;
            }
        });

        const grossTotal = pixTotal + debitTotal + creditTotal + cashTotal;
        const totalVendas = shiftSales.length;

        const countedCashVal = parseFloat(document.getElementById('blind-cash-input')?.value) || 0;
        const diffVal = countedCashVal - cashTotal;
        let diffStatus = 'CONFERIDO / SEM DIVERGÊNCIA';
        if (diffVal > 0.05) diffStatus = `SOBRA DE R$ ${diffVal.toFixed(2).replace('.', ',')}`;
        else if (diffVal < -0.05) diffStatus = `FALTA DE R$ ${Math.abs(diffVal).toFixed(2).replace('.', ',')}`;

        const cardPixSlips = shiftSales.filter(s => s.paymentMethod !== 'dinheiro');
        
        const slipsRowsHtml = cardPixSlips.length === 0 
            ? '<tr><td colspan="6" class="text-center" style="padding: 8px;">Nenhuma via de cartão/Pix registrada neste turno.</td></tr>'
            : cardPixSlips.map(s => {
                const itemsText = (s.items || []).map(it => `${it.qty}x ${it.name}`).join(', ');
                const payLabel = (s.paymentMethod || '').toUpperCase().replace('_', ' ');
                return `
                    <tr>
                        <td class="text-center" style="font-weight: bold; width: 35px;">[ ]</td>
                        <td><strong>${s.id}</strong></td>
                        <td>${s.dateFormatted || (s.timestamp ? new Date(s.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-')}</td>
                        <td><strong>${payLabel}</strong></td>
                        <td><small>${itemsText}</small></td>
                        <td class="text-right"><strong>R$ ${Number(s.total).toFixed(2).replace('.', ',')}</strong></td>
                    </tr>
                `;
            }).join('');

        const currentOpName = this.currentUser ? `${this.currentUser.name} [${this.currentUser.code.toUpperCase()}]` : (shift.operatorName || 'Operador');
        const startTimeStr = shift.startTime ? new Date(shift.startTime).toLocaleString('pt-BR') : '-';
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
                    <div><strong>Data/Hora Emissão:</strong> ${nowStr}</div>
                    <div><strong>Código do Turno:</strong> ${shift.shiftCode || 'T01'}</div>
                    <div><strong>Operador do Turno:</strong> ${currentOpName}</div>
                    <div><strong>Abertura do Turno:</strong> ${startTimeStr}</div>
                    <div><strong>Fechamento / Emissão:</strong> ${nowStr}</div>
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
                        <td class="text-right"><strong>R$ ${diffVal.toFixed(2).replace('.', ',')} (${diffStatus})</strong></td>
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
                        <p><strong>Assinatura do Operador</strong><br><small>${currentOpName}</small></p>
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

    printCashReport() {
        this.renderEvoPrintSheet();
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

        if (this.useSupabase) {
            try {
                const opId = this.currentUser ? this.currentUser.id : 'f20729';
                const isAdmin = this.currentUser && this.currentUser.role === 'ADMIN';
                const res = await supabaseAdapter.cancelSale(saleId, opId, adminTitle, reason, isAdmin);
                if (res && res.success) {
                    alert(`✅ Venda ${saleId} cancelada e itens devolvidos ao estoque no Supabase Cloud!`);
                    await this.syncWithSupabase(false);
                    this.closeCancelModal();
                    this.renderAll();
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

            if (this.useSupabase) {
                const data = await supabaseAdapter.getAuditLogs({ search, action, dateFrom, dateTo });
                this.auditEvents = data.logs || [];
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
                return;
            }

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

        const currentCode = this.currentUser ? this.currentUser.code.toLowerCase() : '';

        (this.state.users || []).forEach(u => {
            const isSelf = u.code.toLowerCase() === currentCode;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><code><strong>${u.code.toUpperCase()}</strong></code></td>
                <td><strong>${u.avatar || (u.role === 'ADMIN' ? '💼' : '👩‍💼')} ${u.name}</strong></td>
                <td>${u.title || '-'}</td>
                <td><span class="badge ${u.role === 'ADMIN' ? 'badge-red' : 'badge-blue'}">${u.role}</span></td>
                <td class="text-right">
                    <button class="btn btn-sm btn-secondary" onclick="app.editUser('${u.code}')">✏️ Editar</button>
                    ${!isSelf ? `<button class="btn btn-sm" style="background:#fef2f2;color:#dc2626;border:1px solid #fca5a5;margin-left:6px;" onclick="app.deleteUser('${u.code}', '${u.name}')" title="Excluir Colaborador">🗑️ Excluir</button>` : `<span style="font-size:0.8em;color:#94a3b8;margin-left:6px;">(Você)</span>`}
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    openNewUserModal() {
        this.editingUserOriginalCode = null;
        const titleEl = document.getElementById('user-modal-title');
        if (titleEl) titleEl.textContent = '➕ Cadastrar Novo Colaborador';
        document.getElementById('user-code-input').value = '';
        document.getElementById('user-name-input').value = '';
        document.getElementById('user-title-input').value = '';
        document.getElementById('user-role-input').value = 'OPERADOR';
        document.getElementById('user-modal').classList.add('active');
    }

    editUser(userCode) {
        const user = (this.state.users || []).find(u => u.code.toLowerCase() === userCode.toLowerCase());
        if (!user) return;

        this.editingUserOriginalCode = user.code.toLowerCase();
        const titleEl = document.getElementById('user-modal-title');
        if (titleEl) titleEl.textContent = `✏️ Editar Colaborador (${user.code.toUpperCase()})`;

        document.getElementById('user-code-input').value = user.code.toUpperCase();
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

        const originalCode = this.editingUserOriginalCode;
        const opName = this.currentUser ? `${this.currentUser.name} [${this.currentUser.code.toUpperCase()}]` : 'Luan [F20729]';

        if (this.useSupabase) {
            try {
                await supabaseAdapter.upsertUser(userPayload, opName, originalCode);
                alert(`✅ Colaborador ${name} (${code.toUpperCase()}) salvo no Supabase Cloud com sucesso!`);
                await this.syncWithSupabase(false);
                this.closeUserModal();
                this.renderAll();
                return;
            } catch (e) {
                console.error('❌ Erro ao salvar colaborador no Supabase:', e);
                alert(`❌ Erro ao salvar colaborador: ${e.message}`);
                return;
            }
        }

        try {
            const res = await fetch(`${this.API_BASE}/api/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...userPayload, originalCode })
            });
            if (res.ok) {
                const data = await res.json();
                this.state = data.state;
                this.saveLocalState(data.state);
            }
        } catch (e) {
            if (originalCode && originalCode !== code) {
                this.state.users = this.state.users.filter(u => u.code.toLowerCase() !== originalCode);
            }
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

    async deleteUser(userCode, userName) {
        const code = userCode.toLowerCase();
        const currentCode = this.currentUser ? this.currentUser.code.toLowerCase() : '';

        if (code === currentCode) {
            alert('⚠️ Você não pode excluir o seu próprio usuário enquanto estiver logado nele.');
            return;
        }

        const confirmDel = confirm(`Tem certeza que deseja EXCLUIR o colaborador "${userName}" (${userCode.toUpperCase()})?\n\nEle não poderá mais acessar o sistema ou abrir turnos.`);
        if (!confirmDel) return;

        const opName = this.currentUser ? `${this.currentUser.name} [${this.currentUser.code.toUpperCase()}]` : 'Luan [F20729]';

        if (this.useSupabase) {
            try {
                await supabaseAdapter.deleteUser(code, userName, opName);
                alert(`🗑️ Colaborador ${userName} (${userCode.toUpperCase()}) excluído com sucesso!`);
                await this.syncWithSupabase(false);
                this.renderAll();
                return;
            } catch (e) {
                console.error('❌ Erro ao excluir colaborador no Supabase:', e);
                alert(`❌ Erro ao excluir colaborador: ${e.message}`);
                return;
            }
        }

        try {
            const res = await fetch(`${this.API_BASE}/api/users/${code}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                const data = await res.json();
                this.state = data.state;
                this.saveLocalState(data.state);
            }
        } catch (e) {
            this.state.users = this.state.users.filter(u => u.code.toLowerCase() !== code);
            this.saveLocalState(this.state);
        }

        this.renderAll();
        alert(`🗑️ Colaborador ${userName} (${userCode.toUpperCase()}) excluído com sucesso!`);
    }

    closeUserModal() {
        this.editingUserOriginalCode = null;
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

    /* ==================== CONFIGURAÇÃO SUPABASE CLOUD ==================== */
    openSupabaseModal() {
        const urlInput = document.getElementById('cfg-supabase-url');
        const keyInput = document.getElementById('cfg-supabase-key');
        const resEl = document.getElementById('supabase-test-result');

        if (urlInput) urlInput.value = localStorage.getItem('panobianco_supabase_url') || (SUPABASE_CONFIG.url.includes('SUA-URL') ? '' : SUPABASE_CONFIG.url);
        if (keyInput) keyInput.value = localStorage.getItem('panobianco_supabase_key') || (SUPABASE_CONFIG.anonKey.includes('SUA-ANON') ? '' : SUPABASE_CONFIG.anonKey);
        if (resEl) resEl.style.display = 'none';

        document.getElementById('supabase-config-modal').classList.add('active');
    }

    closeSupabaseModal() {
        document.getElementById('supabase-config-modal').classList.remove('active');
    }

    async testSupabaseConnection() {
        const url = document.getElementById('cfg-supabase-url').value.trim();
        const key = document.getElementById('cfg-supabase-key').value.trim();
        const resEl = document.getElementById('supabase-test-result');
        if (!resEl) return;

        if (!url || !key) {
            resEl.innerHTML = '<span style="color:#ef4444;">⚠️ Preencha a URL e a Anon Key do Supabase.</span>';
            resEl.style.display = 'block';
            return;
        }

        resEl.innerHTML = '<span style="color:#3b82f6;">⏳ Testando conexão com o Supabase Cloud...</span>';
        resEl.style.display = 'block';

        try {
            const testClient = supabase.createClient(url, key);
            const { data, error } = await testClient.from('tenants').select('id, name').limit(1);
            if (error) throw error;

            resEl.innerHTML = '<span style="color:#16a34a; font-weight:bold;">✅ Conexão bem-sucedida! PostgreSQL e Realtime prontos.</span>';
        } catch (err) {
            resEl.innerHTML = `<span style="color:#ef4444;">❌ Falha na conexão: ${err.message || err}</span>`;
        }
    }

    async saveSupabaseConfig() {
        const url = document.getElementById('cfg-supabase-url').value.trim();
        const key = document.getElementById('cfg-supabase-key').value.trim();

        if (!url || !key) {
            alert('⚠️ Preencha a URL e a Anon Key do Supabase.');
            return;
        }

        localStorage.setItem('panobianco_supabase_url', url);
        localStorage.setItem('panobianco_supabase_key', key);

        SUPABASE_CONFIG.url = url;
        SUPABASE_CONFIG.anonKey = key;

        if (supabaseAdapter.init(SUPABASE_CONFIG)) {
            this.useSupabase = true;
            await this.syncWithSupabase(true);
            supabaseAdapter.subscribeRealtime((type, payload) => this.handleRealtimeUpdate(type, payload));
            this.updateSyncBadge(true, true);
            alert('🎉 Supabase Cloud conectado com sucesso! O sistema agora está sincronizado em tempo real na nuvem.');
            this.closeSupabaseModal();
        } else {
            alert('❌ Erro ao inicializar o Supabase com as credenciais informadas.');
        }
    }
}

const app = new PanobiancoApp();
