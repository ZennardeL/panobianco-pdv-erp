/**
 * Panobianco PDV & ERP — Módulo de Carrinho
 * 
 * Gerencia o estado do carrinho de compras e a interface do PDV:
 * - Vitrine de produtos com filtro e busca
 * - Adição/remoção de itens com validação de estoque
 * - Cálculo de troco para pagamento em dinheiro
 * - Seleção de forma de pagamento
 * 
 * Extraído de PanobiancoApp (app.js L360-L549)
 * 
 * @module modules/cart
 */

import { escapeHtml, formatCurrency } from '../core/helpers.js';
import { PAYMENT_METHODS, CATEGORY_GROUPS } from '../core/constants.js';

// ────────────────────────────────────────────
// Estado interno do módulo
// ────────────────────────────────────────────

/** @type {Array<{productId: string, name: string, price: number, cost: number, qty: number}>} */
let _cart = [];

/** @type {string} Categoria ativa no filtro */
let _activeCategory = 'todas';

/** @type {string} Busca ativa */
let _searchQuery = '';

/** @type {string} Forma de pagamento selecionada */
let _selectedPaymentMethod = PAYMENT_METHODS.PIX;


// ────────────────────────────────────────────
// Estado público (getters)
// ────────────────────────────────────────────

/** @returns {Array} Itens do carrinho */
export function getCart() { return _cart; }

/** @returns {string} Forma de pagamento selecionada */
export function getSelectedPaymentMethod() { return _selectedPaymentMethod; }

/** @returns {number} Total do carrinho */
export function getCartTotal() {
    return _cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
}

/** @returns {number} Custo total do carrinho */
export function getCartCost() {
    return _cart.reduce((sum, item) => sum + (item.cost * item.qty), 0);
}

/** @returns {number} Quantidade total de itens */
export function getCartQty() {
    return _cart.reduce((sum, item) => sum + item.qty, 0);
}


// ────────────────────────────────────────────
// Filtro & Busca
// ────────────────────────────────────────────

/**
 * Filtra produtos por categoria.
 * Reproduz filterCategory() do app.js (L361-L368).
 * 
 * @param {string} category - Categoria para filtrar ('todas' para resetar)
 * @param {Function} onRender - Callback para re-renderizar a grade
 */
export function filterCategory(category, onRender) {
    _activeCategory = category;
    document.querySelectorAll('.cat-pill').forEach(btn => {
        const onclickAttr = btn.getAttribute('onclick') || '';
        btn.classList.toggle('active', onclickAttr.includes(`'${category}'`));
    });
    if (onRender) onRender();
}

/**
 * Busca produtos por nome.
 * Reproduz searchProducts() do app.js (L370-L373).
 * 
 * @param {string} query - Termo de busca
 * @param {Function} onRender - Callback para re-renderizar
 */
export function searchProducts(query, onRender) {
    _searchQuery = (query || '').toLowerCase().trim();
    if (onRender) onRender();
}

/**
 * Filtra a lista de produtos com base na categoria e busca atuais.
 * 
 * @param {Array} products - Lista completa de produtos
 * @returns {Array} Produtos filtrados
 */
export function getFilteredProducts(products) {
    let filtered = products || [];

    if (_activeCategory && _activeCategory !== 'todas') {
        const group = CATEGORY_GROUPS[_activeCategory];
        if (group) {
            filtered = filtered.filter(p => group.includes(p.category));
        } else {
            filtered = filtered.filter(p => p.category === _activeCategory);
        }
    }

    if (_searchQuery) {
        filtered = filtered.filter(p => p.name.toLowerCase().includes(_searchQuery));
    }

    return filtered;
}


// ────────────────────────────────────────────
// Renderização da Vitrine
// ────────────────────────────────────────────

/**
 * Renderiza a grade de produtos do PDV.
 * Reproduz renderProductsGrid() do app.js (L375-L430).
 * 
 * @param {Array} products - Lista de produtos do estado
 * @param {number} saleCounter - Contador de vendas para tag V##
 * @param {Function} onAddToCart - Callback quando clicam em um produto
 */
export function renderProductsGrid(products, saleCounter, onAddToCart) {
    const grid = document.getElementById('products-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const filtered = getFilteredProducts(products);

    filtered.forEach(prod => {
        const card = document.createElement('div');
        card.className = `prod-card ${prod.stock <= 0 ? 'out-of-stock' : ''}`;
        card.onclick = () => onAddToCart(prod.id);

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

        const safeName = escapeHtml(prod.name);
        const mediaHtml = prod.image
            ? `<div class="prod-card-media"><img src="${escapeHtml(prod.image)}" class="prod-card-photo" alt="${safeName}"></div>`
            : `<div class="prod-card-media"><span class="prod-card-icon">${prod.icon || '📦'}</span></div>`;

        card.innerHTML = `
            ${mediaHtml}
            <div class="prod-card-name">${safeName}</div>
            <div class="prod-card-price">${formatCurrency(prod.price)}</div>
            <div><span class="prod-card-stock ${stockClass}">${stockLabel}</span></div>
        `;
        grid.appendChild(card);
    });

    // Tag da próxima venda
    const nextSeq = (saleCounter || (products || []).length) + 1;
    const nextTag = document.getElementById('next-sale-code-tag');
    if (nextTag) {
        nextTag.innerText = `Próxima: V${nextSeq < 10 ? '0' + nextSeq : nextSeq}`;
    }
}


// ────────────────────────────────────────────
// Operações do Carrinho
// ────────────────────────────────────────────

/**
 * Adiciona um produto ao carrinho.
 * Reproduz addToCart() do app.js (L432-L456).
 * 
 * @param {string} productId - ID do produto
 * @param {Array} products - Lista de produtos do estado
 */
export function addToCart(productId, products) {
    const product = (products || []).find(p => p.id === productId);
    if (!product || product.stock <= 0) return;

    const cartItem = _cart.find(item => item.productId === productId);
    const currentQtyInCart = cartItem ? cartItem.qty : 0;

    if (currentQtyInCart + 1 > product.stock) {
        alert(`⚠️ Estoque insuficiente! Existem apenas ${product.stock} unidades disponíveis.`);
        return;
    }

    if (cartItem) {
        cartItem.qty += 1;
    } else {
        _cart.push({
            productId: product.id,
            name: product.name,
            price: product.price,
            cost: product.cost,
            qty: 1
        });
    }
    renderCart();
}

/**
 * Atualiza a quantidade de um item no carrinho.
 * Reproduz updateCartQty() do app.js (L458-L474).
 * 
 * @param {string} productId - ID do produto
 * @param {number} delta - Variação (+1 ou -1)
 * @param {Array} products - Lista de produtos do estado
 */
export function updateCartQty(productId, delta, products) {
    const cartItem = _cart.find(item => item.productId === productId);
    const product = (products || []).find(p => p.id === productId);
    if (!cartItem) return;

    const newQty = cartItem.qty + delta;
    if (newQty <= 0) {
        _cart = _cart.filter(item => item.productId !== productId);
    } else {
        if (product && newQty > product.stock) {
            alert(`⚠️ Estoque máximo atingido (${product.stock} un).`);
            return;
        }
        cartItem.qty = newQty;
    }
    renderCart();
}

/**
 * Limpa o carrinho.
 * Reproduz clearCart() do app.js (L476-L479).
 */
export function clearCart() {
    _cart = [];
    renderCart();
}

/**
 * Reseta o carrinho sem re-renderizar (usado após venda).
 */
export function resetCart() {
    _cart = [];
}


// ────────────────────────────────────────────
// Renderização do Carrinho
// ────────────────────────────────────────────

/**
 * Renderiza os itens do carrinho na sidebar.
 * Reproduz renderCart() do app.js (L481-L527).
 * Usa escapeHtml para prevenir XSS nos nomes de produtos.
 */
export function renderCart() {
    const container = document.getElementById('cart-items');
    if (!container) return;

    if (_cart.length === 0) {
        container.innerHTML = `
            <div class="empty-cart">
                <div class="empty-cart-icon">🛒</div>
                <p>Nenhum item selecionado</p>
                <small>Clique nos produtos ao lado para adicionar ao cupom</small>
            </div>
        `;
        const qtyEl = document.getElementById('cart-total-qty');
        const valEl = document.getElementById('cart-total-val');
        if (qtyEl) qtyEl.innerText = '0 un.';
        if (valEl) valEl.innerText = 'R$ 0,00';
        return;
    }

    container.innerHTML = '';
    let totalQty = 0;
    let totalVal = 0;

    _cart.forEach(item => {
        const subtotal = item.price * item.qty;
        totalQty += item.qty;
        totalVal += subtotal;

        const row = document.createElement('div');
        row.className = 'cart-row';
        row.innerHTML = `
            <div class="cart-row-details">
                <div class="cart-row-name">${escapeHtml(item.name)}</div>
                <div class="cart-row-unit-price">${formatCurrency(item.price)} un.</div>
            </div>
            <div class="cart-qty-ctrl">
                <button class="qty-btn" onclick="app.updateCartQty('${item.productId}', -1)">-</button>
                <span class="cart-qty-val">${item.qty}</span>
                <button class="qty-btn" onclick="app.updateCartQty('${item.productId}', 1)">+</button>
            </div>
            <div class="cart-row-subtotal">${formatCurrency(subtotal)}</div>
        `;
        container.appendChild(row);
    });

    const qtyEl = document.getElementById('cart-total-qty');
    const valEl = document.getElementById('cart-total-val');
    if (qtyEl) qtyEl.innerText = `${totalQty} un.`;
    if (valEl) valEl.innerText = formatCurrency(totalVal);
    calculateChange();
}


// ────────────────────────────────────────────
// Pagamento
// ────────────────────────────────────────────

/**
 * Seleciona a forma de pagamento.
 * Reproduz selectPaymentMethod() do app.js (L529-L541).
 * 
 * @param {string} method - Forma de pagamento ('pix', 'debito', 'credito', 'dinheiro')
 */
export function selectPaymentMethod(method) {
    _selectedPaymentMethod = method;
    document.querySelectorAll('.pay-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.method === method);
    });

    const cashContainer = document.getElementById('cash-change-container');
    if (cashContainer) {
        cashContainer.style.display = method === PAYMENT_METHODS.DINHEIRO ? 'block' : 'none';
    }
}

/**
 * Calcula o troco para pagamento em dinheiro.
 * Reproduz calculateChange() do app.js (L543-L549).
 */
export function calculateChange() {
    if (_selectedPaymentMethod !== PAYMENT_METHODS.DINHEIRO) return;
    const totalVal = getCartTotal();
    const received = parseFloat(document.getElementById('cash-received')?.value) || 0;
    const change = Math.max(0, received - totalVal);
    const changeEl = document.getElementById('change-value');
    if (changeEl) changeEl.innerText = formatCurrency(change);
}
