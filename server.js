/**
 * ==========================================================================
 * PANOBIANCO PDV & ERP — SERVIDOR HTTP (v2.1.0 — Autenticação por Token)
 * ==========================================================================
 *
 * Changelog v2.1.0:
 * - Middleware de autenticação com token de sessão (SQLite)
 * - Autorização por perfil (ADMIN/OPERADOR) em endpoints protegidos
 * - Endpoint POST /api/auth/logout
 * - Audit logs usam operador real da sessão (não o enviado pelo frontend)
 * - Limpeza automática de sessões expiradas (a cada 1h)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const BASE_DIR = __dirname;
const BACKUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos
const SESSION_CLEANUP_MS = 60 * 60 * 1000;  // 1 hora

const MIME_TYPES = {
    '.html': 'text/html; charset=UTF-8',
    '.css': 'text/css; charset=UTF-8',
    '.js': 'application/javascript; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp'
};

function parseRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > 10 * 1024 * 1024) {
                req.destroy();
                reject(new Error('Payload muito grande (limite: 10MB)'));
            }
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(e);
            }
        });
    });
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=UTF-8' });
    res.end(JSON.stringify(data));
}

// ==========================================================================
// MIDDLEWARE DE AUTENTICAÇÃO
// ==========================================================================

/**
 * Extrai e valida o token do header Authorization.
 * Retorna o objeto session ou null.
 */
function authenticate(req) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return null;
    return db.validateSession(token);
}

/**
 * Exige autenticação. Retorna a session ou envia 401 e retorna null.
 */
function requireAuth(req, res) {
    const session = authenticate(req);
    if (!session) {
        sendJson(res, 401, { success: false, error: 'Sessão inválida ou expirada. Faça login novamente.' });
        return null;
    }
    return session;
}

/**
 * Exige perfil ADMIN. Retorna a session ou envia 401/403 e retorna null.
 */
function requireAdmin(req, res) {
    const session = requireAuth(req, res);
    if (!session) return null; // 401 já enviado
    if (session.user_role !== 'ADMIN') {
        sendJson(res, 403, { success: false, error: 'Acesso restrito a gestores (ADMIN).' });
        return null;
    }
    return session;
}

// ==========================================================================
// INICIALIZAÇÃO
// ==========================================================================

db.initDatabase();

const activeShift = db.getActiveShift();
if (!activeShift) {
    db.createShift({
        id: 'shift_' + Date.now(),
        shiftCode: 'T01',
        operatorId: 'f20729',
        operatorName: 'Luan [F20729]'
    });
    console.log('📋 Turno inicial T01 criado automaticamente.');
}

// Backup automático a cada 30 minutos
setInterval(() => {
    console.log('⏰ Backup automático agendado (30 min)...');
    db.createBackup();
}, BACKUP_INTERVAL_MS);

// Limpeza de sessões expiradas a cada 1 hora
setInterval(() => {
    db.cleanExpiredSessions();
}, SESSION_CLEANUP_MS);

// ==========================================================================
// SERVIDOR HTTP
// ==========================================================================

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    try {
        // ==================== ENDPOINTS PÚBLICOS ====================

        // POST /api/auth/login — Autenticação (gera token)
        if (pathname === '/api/auth/login' && req.method === 'POST') {
            const { code } = await parseRequestBody(req);
            const cleanCode = (code || '').trim().toLowerCase();

            if (!cleanCode) {
                return sendJson(res, 400, { success: false, error: 'Código não informado.' });
            }

            const user = db.findUserByCode(cleanCode);
            if (user) {
                // Gerar token de sessão
                const session = db.createSession(user);

                db.logAudit('LOGIN', 'user', user.id, user.id, `${user.name} [${user.code.toUpperCase()}]`, null);
                return sendJson(res, 200, {
                    success: true,
                    token: session.token,
                    expiresAt: session.expiresAt,
                    user: {
                        id: user.id,
                        code: user.code,
                        name: user.name,
                        role: user.role,
                        title: user.title,
                        avatar: user.avatar
                    }
                });
            }

            return sendJson(res, 401, { success: false, error: 'Código de acesso não encontrado.' });
        }

        // POST /api/auth/logout — Encerrar sessão
        if (pathname === '/api/auth/logout' && req.method === 'POST') {
            const session = authenticate(req);
            if (session) {
                db.logAudit('LOGOUT', 'user', session.user_id, session.user_id, `${session.user_name} [${session.user_code.toUpperCase()}]`, null);
                db.deleteSession(session.token);
            }
            return sendJson(res, 200, { success: true });
        }

        // ==================== ENDPOINTS PROTEGIDOS ====================

        // GET /api/state — Estado completo (qualquer perfil autenticado)
        if (pathname === '/api/state' && req.method === 'GET') {
            const session = requireAuth(req, res);
            if (!session) return;

            const state = db.getFullState();
            return sendJson(res, 200, state);
        }

        // GET /api/audit — Logs de auditoria (🔒 ADMIN)
        if (pathname === '/api/audit' && req.method === 'GET') {
            const session = requireAdmin(req, res);
            if (!session) return;

            const filters = {
                action: parsedUrl.searchParams.get('action') || '',
                operatorId: parsedUrl.searchParams.get('operatorId') || '',
                dateFrom: parsedUrl.searchParams.get('dateFrom') || '',
                dateTo: parsedUrl.searchParams.get('dateTo') || '',
                search: parsedUrl.searchParams.get('search') || '',
                limit: parseInt(parsedUrl.searchParams.get('limit')) || 200
            };

            const logs = db.getAuditLogs(filters);
            const actionTypes = db.getAuditActionTypes();

            return sendJson(res, 200, { logs, actionTypes });
        }


        if (pathname === '/api/sale' && req.method === 'POST') {
            const session = requireAuth(req, res);
            if (!session) return;

            const saleData = await parseRequestBody(req);

            if (!saleData.items || saleData.items.length === 0) {
                return sendJson(res, 400, { success: false, error: 'Nenhum item na venda.' });
            }

            // Usar operador da sessão (fonte de verdade), não do body
            saleData.operatorId = session.user_id;
            saleData.operatorName = `${session.user_name} [${session.user_code.toUpperCase()}]`;
            saleData.operatorCode = session.user_code.toUpperCase();

            const sale = db.createSale(saleData);

            db.logAudit(
                'VENDA', 'sale', sale.id,
                session.user_id,
                `${session.user_name} [${session.user_code.toUpperCase()}]`,
                `Total: R$ ${sale.total.toFixed(2)} | Pagto: ${sale.payment_method} | Itens: ${sale.items.length}`
            );

            const formattedSale = {
                id: sale.id,
                seq: sale.seq,
                timestamp: sale.created_at,
                dateFormatted: formatTime(sale.created_at),
                fullDateTime: formatDateTime(sale.created_at),
                operatorId: sale.operator_id,
                operatorName: sale.operator_name,
                operatorCode: sale.operator_code,
                paymentMethod: sale.payment_method,
                total: sale.total,
                cost: sale.cost,
                profit: sale.profit,
                status: sale.status,
                items: (sale.items || []).map(it => ({
                    productId: it.product_id,
                    name: it.product_name,
                    qty: it.qty,
                    price: it.unit_price,
                    cost: it.unit_cost
                }))
            };

            return sendJson(res, 200, { success: true, sale: formattedSale, state: db.getFullState() });
        }

        // POST /api/sale/cancel — Cancelar venda (🔒 ADMIN)
        if (pathname === '/api/sale/cancel' && req.method === 'POST') {
            const session = requireAdmin(req, res);
            if (!session) return;

            const { saleId, reason } = await parseRequestBody(req);

            if (!reason) {
                return sendJson(res, 400, { success: false, error: 'Justificativa obrigatória.' });
            }

            const adminName = `${session.user_name} [${session.user_code.toUpperCase()}]`;
            const cancelledByText = `Cancelado por ${adminName}: ${reason}`;
            const result = db.cancelSale(saleId, cancelledByText, adminName);

            if (!result) {
                return sendJson(res, 400, { success: false, error: 'Venda não encontrada ou já cancelada.' });
            }

            db.logAudit('CANCELAMENTO', 'sale', saleId, session.user_id, adminName, cancelledByText);

            return sendJson(res, 200, { success: true, state: db.getFullState() });
        }

        // POST /api/restock — Entrada de estoque (qualquer perfil autenticado)
        if (pathname === '/api/restock' && req.method === 'POST') {
            const session = requireAuth(req, res);
            if (!session) return;

            const { productId, qty } = await parseRequestBody(req);
            const quantity = parseInt(qty, 10);

            if (!productId || !quantity || quantity <= 0) {
                return sendJson(res, 400, { success: false, error: 'Produto e quantidade obrigatórios.' });
            }

            const product = db.getProductById(productId);
            if (!product) {
                return sendJson(res, 404, { success: false, error: 'Produto não encontrado.' });
            }

            const operatorName = `${session.user_name} [${session.user_code.toUpperCase()}]`;
            db.updateProductStock(productId, quantity);
            db.logAudit('REPOSICAO', 'product', productId, session.user_id, operatorName, `+${quantity} unidades de ${product.name}`);

            const updatedProduct = db.getProductById(productId);
            return sendJson(res, 200, {
                success: true,
                product: { id: updatedProduct.id, name: updatedProduct.name, stock: updatedProduct.stock },
                state: db.getFullState()
            });
        }

        // POST /api/product — Criar ou editar produto (🔒 ADMIN)
        if (pathname === '/api/product' && req.method === 'POST') {
            const session = requireAdmin(req, res);
            if (!session) return;

            const product = await parseRequestBody(req);

            if (!product.name || !product.price || product.price <= 0) {
                return sendJson(res, 400, { success: false, error: 'Nome e preço obrigatórios.' });
            }

            if (!product.id) {
                product.id = 'prod_' + Date.now();
            }

            db.upsertProduct({
                id: product.id,
                name: product.name,
                category: product.category || 'bebidas',
                cost: product.cost || 0,
                price: product.price,
                stock: product.stock || 0,
                min_stock: product.minStock || product.min_stock || 5,
                icon: product.icon || '📦',
                image_path: product.imagePath || product.image_path || ''
            });

            const adminName = `${session.user_name} [${session.user_code.toUpperCase()}]`;
            db.logAudit('PRODUTO_ATUALIZADO', 'product', product.id, session.user_id, adminName, product.name);

            return sendJson(res, 200, { success: true, state: db.getFullState() });
        }

        // POST /api/product/photo — Upload de foto (qualquer perfil autenticado)
        if (pathname === '/api/product/photo' && req.method === 'POST') {
            const session = requireAuth(req, res);
            if (!session) return;

            const { productId, imageBase64 } = await parseRequestBody(req);

            if (!productId || !imageBase64) {
                return sendJson(res, 400, { success: false, error: 'Produto e imagem obrigatórios.' });
            }

            const product = db.getProductById(productId);
            if (!product) {
                return sendJson(res, 404, { success: false, error: 'Produto não encontrado.' });
            }

            const imagePath = saveBase64Image(productId, imageBase64);
            db.updateProductPhoto(productId, imagePath);

            const operatorName = `${session.user_name} [${session.user_code.toUpperCase()}]`;
            db.logAudit('FOTO_ATUALIZADA', 'product', productId, session.user_id, operatorName, `Foto atualizada: ${product.name}`);

            return sendJson(res, 200, { success: true, product: { id: productId, image_path: imagePath }, state: db.getFullState() });
        }

        // POST /api/shift/close — Fechamento de turno (qualquer perfil autenticado)
        if (pathname === '/api/shift/close' && req.method === 'POST') {
            const session = requireAuth(req, res);
            if (!session) return;

            const { countedCash } = await parseRequestBody(req);
            const operatorName = `${session.user_name} [${session.user_code.toUpperCase()}]`;

            const result = db.closeShift(parseFloat(countedCash) || 0, session.user_id, operatorName);

            if (!result) {
                return sendJson(res, 400, { success: false, error: 'Nenhum turno aberto para fechar.' });
            }

            db.logAudit(
                'FECHAMENTO_TURNO', 'shift', result.closedShift.id,
                session.user_id, operatorName,
                `Vendas: ${result.totalSales} | Receita: R$ ${result.totalRevenue.toFixed(2)} | Diferença: R$ ${result.closedShift.diff.toFixed(2)}`
            );

            console.log('💾 Backup disparado pelo fechamento de turno...');
            db.createBackup();

            return sendJson(res, 200, {
                success: true,
                closedShift: { ...result.closedShift, totalSales: result.totalSales, totalRevenue: result.totalRevenue },
                state: db.getFullState()
            });
        }

        // POST /api/users — Criar ou editar colaborador (🔒 ADMIN)
        if (pathname === '/api/users' && req.method === 'POST') {
            const session = requireAdmin(req, res);
            if (!session) return;

            const userData = await parseRequestBody(req);

            if (!userData.code || !userData.name) {
                return sendJson(res, 400, { success: false, error: 'Código e nome obrigatórios.' });
            }

            db.upsertUser({
                id: userData.id || userData.code.toLowerCase(),
                code: userData.code.toLowerCase(),
                name: userData.name,
                role: userData.role || 'OPERADOR',
                title: userData.title || (userData.role === 'ADMIN' ? 'Gestor' : 'Recepção'),
                avatar: userData.avatar || (userData.role === 'ADMIN' ? '💼' : '👩‍💼')
            });

            const adminName = `${session.user_name} [${session.user_code.toUpperCase()}]`;
            db.logAudit('USUARIO_ATUALIZADO', 'user', userData.code, session.user_id, adminName, `${userData.name} (${userData.code})`);

            return sendJson(res, 200, { success: true, state: db.getFullState() });
        }

        // ==================== ARQUIVOS ESTÁTICOS ====================
        let reqPath = pathname === '/' ? '/index.html' : pathname;

        const safePath = path.normalize(reqPath).replace(/^(\.\.(\/|\\|$))+/, '');
        let filePath = path.join(BASE_DIR, safePath);

        if (!filePath.startsWith(BASE_DIR)) {
            res.writeHead(403);
            res.end('403 - Acesso negado');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        fs.readFile(filePath, (err, content) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
                    res.end('404 - Arquivo não encontrado');
                } else {
                    res.writeHead(500, { 'Content-Type': 'text/plain; charset=UTF-8' });
                    res.end('500 - Erro interno');
                }
            } else {
                if (ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp') {
                    res.setHeader('Cache-Control', 'public, max-age=3600');
                }
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content);
            }
        });

    } catch (e) {
        console.error('❌ Erro no servidor:', e);
        sendJson(res, 500, { success: false, error: e.message });
    }
});

// ==========================================================================
// UTILITÁRIOS
// ==========================================================================

function saveBase64Image(productId, base64Data) {
    const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Clean, 'base64');
    const filename = `${productId}.jpg`;
    const relativePath = path.join('uploads', 'products', filename);
    const absolutePath = path.join(BASE_DIR, relativePath);
    fs.writeFileSync(absolutePath, buffer);
    return relativePath;
}

function formatTime(isoString) {
    if (!isoString) return '--:--';
    try {
        const d = new Date(isoString.includes('T') ? isoString : isoString + 'Z');
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch { return '--:--'; }
}

function formatDateTime(isoString) {
    if (!isoString) return '';
    try {
        const d = new Date(isoString.includes('T') ? isoString : isoString + 'Z');
        return d.toLocaleString('pt-BR');
    } catch { return ''; }
}

// ==========================================================================
// GRACEFUL SHUTDOWN
// ==========================================================================

process.on('SIGINT', () => {
    console.log('\n🛑 Encerrando servidor...');
    console.log('💾 Criando backup de encerramento...');
    db.createBackup();
    db.closeDatabase();
    process.exit(0);
});

process.on('SIGTERM', () => {
    db.createBackup();
    db.closeDatabase();
    process.exit(0);
});

// ==========================================================================
// INICIAR
// ==========================================================================

server.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🚀 SERVIDOR PANOBIANCO PDV & ERP v2.1.0`);
    console.log(`📍 Acesso: http://localhost:${PORT}`);
    console.log(`📦 Banco: SQLite (WAL mode, transações atômicas)`);
    console.log(`🔐 Autenticação: Token de sessão (12h)`);
    console.log(`📷 Fotos: /uploads/products/`);
    console.log(`💾 Backup: 30 min + fechamento de turno`);
    console.log(`=======================================================`);
});
