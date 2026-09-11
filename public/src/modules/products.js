/**
 * Panobianco PDV & ERP — Products Module
 * 
 * Handles product CRUD, photos, and duplicate management.
 * 
 * @module modules/products
 */

import { escapeHtml, generateLocalId } from '../core/helpers.js';
import { CATEGORIES, CATEGORY_LABELS, getCategoryLabel, ROLES } from '../core/constants.js';

// ── Private State ───────────────────────────
let _config = null;
let _tempProductPhotoBase64 = null;
let _tempQuickPhotoBase64 = null;

// ── Configuration ───────────────────────────
export function configureProducts(config) {
    _config = config;
}

// ── Public API ──────────────────────────────
    // Modal de Upload Rápido de Foto (Aberto para Todos os Colaboradores)
    export function openQuickPhotoModal(productId) {
        const prod = (_config.getState().products || []).find(p => p.id === productId);
        if (!prod) return;

        _tempQuickPhotoBase64 = prod.image || null;
        document.getElementById('quick-photo-prod-id').value = prod.id;
        document.getElementById('quick-photo-prod-name').innerText = `Produto: ${escapeHtml(prod.name)}`;
        
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

    export function closeQuickPhotoModal() {
        document.getElementById('quick-photo-modal').classList.remove('active');
    }

    export function previewQuickPhoto(input) {
        if (input.files && input.files[0]) {
            const file = input.files[0];
            const reader = new FileReader();
            reader.onload = (e) => {
                compressImage(e.target.result, 300, 300, (compressedBase64) => {
                    _tempQuickPhotoBase64 = compressedBase64;
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

    export async function saveQuickPhoto() {
        const prodId = document.getElementById('quick-photo-prod-id').value;
        if (!_tempQuickPhotoBase64) {
            alert('⚠️ Selecione uma foto antes de salvar.');
            return;
        }

        if (_config.getUseSupabase()) {
            try {
                const { uploadProductPhoto } = await import('../services/storage.js');

                await uploadProductPhoto(prodId, _tempQuickPhotoBase64);
                alert('✅ Foto cadastrada e salva na Nuvem Supabase com sucesso!');
                await _config.syncWithSupabase(false);
                closeQuickPhotoModal();
                _config.renderAll();
                return;
            } catch (e) {
                console.error('❌ Erro no upload de foto Supabase:', e);
                alert(`❌ Erro ao salvar foto no Supabase: ${e.message}`);
                return;
            }
        }

        try {
            const res = await _config.authFetch(`${_config.getApiBase()}/api/product/photo`, {
                method: 'POST',
                body: JSON.stringify({
                    productId: prodId,
                    imageBase64: _tempQuickPhotoBase64
                })
            });

            if (res.ok) {
                const data = await res.json();
                _config.getState() = data.state;
                _config.saveLocalState(data.state);
                alert('✅ Foto cadastrada com sucesso em todas as máquinas!');
            }
        } catch (e) {
            const prod = _config.getState().products.find(p => p.id === prodId);
            if (prod) {
                prod.image = _tempQuickPhotoBase64;
                _config.saveLocalState(_config.getState());
                alert('✅ Foto salva localmente com sucesso!');
            }
        }

        closeQuickPhotoModal();
        _config.renderAll();
    }

    export async function removeQuickPhoto() {
        const prodId = document.getElementById('quick-photo-prod-id').value;
        const prod = (_config.getState().products || []).find(p => p.id === prodId);
        if (!prod) return;

        if (!confirm(`🗑️ Deseja remover a foto de "${escapeHtml(prod.name)}" e voltar a exibir o ícone padrão?`)) return;

        const opName = _config.getCurrentUser() ? `${_config.getCurrentUser().name} [${_config.getCurrentUser().code.toUpperCase()}]` : 'Luan [F20729]';

        if (_config.getUseSupabase()) {
            try {
                const { removeProductPhoto } = await import('../services/storage.js');
                await removeProductPhoto(prodId, prod.name, opName);
                alert('✅ Foto removida com sucesso no Supabase Cloud!');
                await _config.syncWithSupabase(false);
                closeQuickPhotoModal();
                _config.renderAll();
                return;
            } catch (e) {
                console.error('❌ Erro ao remover foto:', e);
                alert(`❌ Erro ao remover foto: ${e.message}`);
                return;
            }
        }

        try {
            const res = await _config.authFetch(`${_config.getApiBase()}/api/product/photo/remove`, {
                method: 'POST',
                body: JSON.stringify({ productId: prodId })
            });

            if (res.ok) {
                const data = await res.json();
                _config.getState() = data.state;
                _config.saveLocalState(data.state);
                alert('✅ Foto removida com sucesso!');
            }
        } catch (e) {
            if (prod) {
                prod.image = '';
                _config.saveLocalState(_config.getState());
                alert('✅ Foto removida localmente com sucesso!');
            }
        }

        closeQuickPhotoModal();
        _config.renderAll();
    }

    export function compressImage(srcBase64, maxWidth, maxHeight, callback) {
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

    export function openNewProductModal() {
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
        _tempProductPhotoBase64 = null;

        document.getElementById('product-modal').classList.add('active');
    }

    export function editProduct(productId) {
        const prod = (_config.getState().products || []).find(p => p.id === productId);
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
            _tempProductPhotoBase64 = prod.image;
        } else {
            previewImg.style.display = 'none';
            placeholder.style.display = 'block';
            if (removePhotoBtn) removePhotoBtn.style.display = 'none';
            _tempProductPhotoBase64 = null;
        }

        document.getElementById('product-modal').classList.add('active');
    }

    export function previewProductPhoto(input) {
        if (input.files && input.files[0]) {
            const file = input.files[0];
            const reader = new FileReader();
            reader.onload = (e) => {
                compressImage(e.target.result, 300, 300, (compressedBase64) => {
                    _tempProductPhotoBase64 = compressedBase64;
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

    export function removeProductPhotoFromModal() {
        _tempProductPhotoBase64 = '';
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

    export async function saveProduct() {
        const id = document.getElementById('edit-prod-id').value;
        const name = document.getElementById('prod-name').value.trim();
        const category = document.getElementById('prod-category').value;
        const icon = document.getElementById('prod-icon').value.trim() || '📦';
        const cost = parseFloat(document.getElementById('prod-cost').value) || 0;
        const price = parseFloat(document.getElementById('prod-price').value) || 0;
        const stock = parseInt(document.getElementById('prod-stock').value) || 0;
        const minStock = parseInt(document.getElementById('prod-min-stock').value) || 5;
        const image = _tempProductPhotoBase64 !== null ? _tempProductPhotoBase64 : (document.getElementById('edit-prod-image').value || '');

        if (!name || price <= 0) {
            alert('⚠️ Preencha o nome e o preço de venda corretamente.');
            return;
        }

        const prodId = id || ('prod_' + Date.now());
        const productPayload = { id: prodId, name, category, icon, cost, price, stock, minStock, image };

        if (_config.getUseSupabase()) {
            try {
                let imageUrl = image;
                if (_tempProductPhotoBase64 && _tempProductPhotoBase64.startsWith('data:')) {
                    const { uploadProductPhoto } = await import('../services/storage.js');

                    imageUrl = await uploadProductPhoto(prodId, _tempProductPhotoBase64);
                }
                productPayload.image = imageUrl;
                const { upsertProduct } = await import('../services/data-service.js');

                await upsertProduct(productPayload);
                alert('✅ Produto salvo com sucesso no Supabase Cloud!');
                await _config.syncWithSupabase(false);
                closeProductModal();
                _config.renderAll();
                return;
            } catch (e) {
                console.error('❌ Erro ao salvar produto no Supabase:', e);
                alert(`❌ Erro ao salvar produto: ${e.message}`);
                return;
            }
        }

        try {
            const res = await _config.authFetch(`${_config.getApiBase()}/api/product`, {
                method: 'POST',
                body: JSON.stringify(productPayload)
            });
            if (res.ok) {
                const data = await res.json();
                _config.getState() = data.state;
            }
        } catch (e) {
            if (id) {
                const prod = _config.getState().products.find(p => p.id === id);
                if (prod) Object.assign(prod, productPayload);
            } else {
                _config.getState().products.push(productPayload);
            }
        }

        _config.saveLocalState(_config.getState());
        closeProductModal();
        _config.renderAll();
    }

    export async function confirmDeleteProduct(productId) {
        const prod = (_config.getState().products || []).find(p => p.id === productId);
        if (!prod) return;

        const confirmMsg = `⚠️ ATENÇÃO: Deseja EXCLUIR o produto abaixo?\n\n` +
            `📦 ${escapeHtml(prod.name)}\n` +
            `💰 Preço: R$ ${prod.price.toFixed(2).replace('.', ',')} | Estoque: ${prod.stock} un.\n\n` +
            `Esta ação removerá o produto do catálogo e da frente de caixa.`;

        if (!confirm(confirmMsg)) return;

        await deleteProductById(productId, prod.name);
    }

    export async function deleteCurrentEditingProduct() {
        const id = document.getElementById('edit-prod-id').value;
        const name = document.getElementById('prod-name').value;
        if (!id) return;

        if (!confirm(`⚠️ Deseja excluir permanentemente o produto "${name}"?`)) return;

        closeProductModal();
        await deleteProductById(id, name);
    }

    export async function deleteProductById(productId, productName = '') {
        const opName = _config.getCurrentUser() ? `${_config.getCurrentUser().name} [${_config.getCurrentUser().code.toUpperCase()}]` : 'Luan [F20729]';

        if (_config.getUseSupabase()) {
            try {
                const { deleteProduct } = await import('../services/data-service.js');

                await deleteProduct(productId, productName, opName);
                alert(`✅ Produto "${productName || productId}" excluído com sucesso do Supabase Cloud!`);
                await _config.syncWithSupabase(false);
                _config.renderAll();
                return;
            } catch (err) {
                console.error('❌ Erro ao excluir produto no Supabase:', err);
                alert(`❌ Erro ao excluir produto: ${err.message || err}`);
                return;
            }
        }

        try {
            const res = await _config.authFetch(`${_config.getApiBase()}/api/product/delete`, {
                method: 'POST',
                body: JSON.stringify({ productId })
            });

            if (res.ok) {
                const data = await res.json();
                _config.getState() = data.state;
                _config.saveLocalState(data.state);
                alert(`✅ Produto "${escapeHtml(productName)}" excluído com sucesso!`);
            } else {
                const data = await res.json();
                alert(`❌ ${data.error || 'Erro ao excluir produto.'}`);
            }
        } catch (e) {
            _config.getState().products = (_config.getState().products || []).filter(p => p.id !== productId);
            _config.saveLocalState(_config.getState());
            alert(`✅ Produto excluído localmente com sucesso!`);
        }

        _config.renderAll();
    }

    /* ==================== GESTÃO DE DUPLICADOS ==================== */
    export function openDuplicatesModal() {
        renderDuplicatesList();
        document.getElementById('duplicates-modal').classList.add('active');
    }

    export function closeDuplicatesModal() {
        document.getElementById('duplicates-modal').classList.remove('active');
    }

    export function renderDuplicatesList() {
        const container = document.getElementById('duplicates-list-container');
        if (!container) return;

        const duplicateGroups = detectDuplicateProducts();

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
                    ? `<img src="${item.image}" class="table-prod-photo-thumb" style="width:28px;height:28px;" alt="${escapeHtml(item.name)}">` 
                    : `<span style="font-size: 14pt;">${item.icon || '📦'}</span>`;

                html += `
                    <div class="duplicate-item-row" style="${isFirst ? 'border-left: 4px solid var(--primary);' : ''}">
                        <div class="duplicate-item-info">
                            ${photoDisplay}
                            <div>
                                <strong style="color: #0f172a; font-size: 9pt;">${escapeHtml(item.name)}</strong> ${isFirst ? '<span class="badge badge-blue">Principal</span>' : ''}
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
                            <button class="btn btn-sm btn-danger" onclick="app.deleteDuplicateItem('${item.id}', '${escapeHtml(item.name)}')" title="Excluir este item duplicado">
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

    export async function deleteDuplicateItem(productId, productName) {
        if (!confirm(`🗑️ Excluir a duplicata "${escapeHtml(productName)}" (ID: ${productId})?`)) return;
        await deleteProductById(productId, productName);
        renderDuplicatesList();
    }

    export async function mergeDuplicateItem(primaryId, duplicateId) {
        const primary = (_config.getState().products || []).find(p => p.id === primaryId);
        const duplicate = (_config.getState().products || []).find(p => p.id === duplicateId);
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

        if (_config.getUseSupabase()) {
            const { upsertProduct } = await import('../services/data-service.js');

            await upsertProduct(primary);
            const { deleteProduct } = await import('../services/data-service.js');

            await deleteProduct(duplicateId, duplicate.name, _config.getCurrentUser() ? _config.getCurrentUser().name : ROLES.ADMIN);
            await _config.syncWithSupabase(false);
        } else {
            try {
                await _config.authFetch(`${_config.getApiBase()}/api/product`, {
                    method: 'POST',
                    body: JSON.stringify(primary)
                });
                await _config.authFetch(`${_config.getApiBase()}/api/product/delete`, {
                    method: 'POST',
                    body: JSON.stringify({ productId: duplicateId })
                });
            } catch (e) {
                _config.getState().products = _config.getState().products.filter(p => p.id !== duplicateId);
                _config.saveLocalState(_config.getState());
            }
        }

        alert(`✅ Mesclagem concluída com sucesso!\nEstoque atual do produto principal: ${primary.stock} unidades.`);
        _config.renderAll();
        renderDuplicatesList();
    }

    export function closeProductModal() {
        document.getElementById('product-modal').classList.remove('active');
    }