/**
 * Panobianco PDV & ERP — Módulo de Navegação
 * 
 * Gerencia a navegação por tabs do SPA.
 * Extraído de PanobiancoApp.navigate() (app.js L347-L358).
 * 
 * @module modules/navigation
 */

/**
 * Navega para uma view específica do SPA.
 * Ativa o tab correspondente e mostra a view associada.
 * 
 * @param {string} viewId - ID da view (ex: 'pdv', 'estoque', 'caixa', 'auditoria', 'equipe', 'dashboard')
 * @param {Function} [onNavigate] - Callback opcional pós-navegação (ex: renderAll)
 */
export function navigate(viewId, onNavigate) {
    // Desativar todos os tabs e views
    document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.view-content').forEach(view => view.classList.remove('active'));

    // Ativar o tab e view destino
    const targetBtn = document.getElementById(`tab-btn-${viewId}`);
    const targetView = document.getElementById(`view-${viewId}`);

    if (targetBtn) targetBtn.classList.add('active');
    if (targetView) targetView.classList.add('active');

    // Callback (normalmente renderAll)
    if (onNavigate) onNavigate();
}
