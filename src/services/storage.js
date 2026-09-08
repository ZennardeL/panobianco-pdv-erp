/**
 * Panobianco PDV & ERP — Storage Service
 * 
 * Gerencia upload e remoção de fotos de produtos no Supabase Storage.
 * Extraído de uploadProductPhoto() e removeProductPhoto() do adapter.js.
 * 
 * @module services/storage
 */

import { getClient, getTenantId } from './supabase-client.js';
import { insertAuditLog } from './data-service.js';

const BUCKET = 'product-images';

/**
 * Faz upload de uma foto de produto para o Supabase Storage.
 * Converte base64 para Blob, faz upload e atualiza a URL na tabela products.
 * 
 * @param {string} productId - ID do produto
 * @param {string} base64Data - Dados da imagem em base64 (data URL)
 * @returns {Promise<string>} URL pública da imagem
 */
export async function uploadProductPhoto(productId, base64Data) {
    const client = getClient();

    // Converter base64 para Blob
    const response = await fetch(base64Data);
    const blob = await response.blob();
    const fileName = `${productId}_${Date.now()}.jpg`;

    const { data, error } = await client.storage
        .from(BUCKET)
        .upload(fileName, blob, {
            contentType: 'image/jpeg',
            upsert: true
        });

    if (error) throw error;

    const { data: publicData } = client.storage
        .from(BUCKET)
        .getPublicUrl(fileName);

    const publicUrl = publicData.publicUrl;

    // Atualizar URL na tabela products
    await client
        .from('products')
        .update({ image_path: publicUrl, updated_at: new Date().toISOString() })
        .eq('id', productId);

    return publicUrl;
}

/**
 * Remove a foto de um produto (limpa o campo image_path).
 * 
 * @param {string} productId - ID do produto
 * @param {string} [productName] - Nome para auditoria
 * @param {string} [operatorName] - Operador que executou
 * @param {string} [tenantId] - ID do tenant
 */
export async function removeProductPhoto(productId, productName = '', operatorName = 'ADMIN', tenantId) {
    const client = getClient();
    const tid = tenantId || getTenantId();

    const { error } = await client
        .from('products')
        .update({ image_path: '', updated_at: new Date().toISOString() })
        .eq('id', productId)
        .eq('tenant_id', tid);

    if (error) throw error;

    await insertAuditLog(tid, {
        action: 'FOTO_REMOVIDA',
        entityType: 'product',
        entityId: productId,
        operatorName,
        details: `Foto do produto ${productName || productId} removida por ${operatorName}`
    });
}
