/**
 * Panobianco PDV & ERP — Users Module
 * 
 * Handles user management and access control.
 * 
 * @module modules/users
 */

import { escapeHtml } from '../core/helpers.js';
import { ROLES } from '../core/constants.js';

// ── Private State ───────────────────────────
let _config = null;
let _editingUserOriginalCode = null;

// ── Configuration ───────────────────────────
export function configureUsers(config) {
    _config = config;
}

// ── Public API ──────────────────────────────
    /* ==================== MÓDULO 5: GESTÃO DE EQUIPE ==================== */
    export function renderUsersTable() {
        const tbody = document.getElementById('users-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        const currentCode = _config.getCurrentUser() ? _config.getCurrentUser().code.toLowerCase() : '';

        (_config.getState().users || []).forEach(u => {
            const isSelf = u.code.toLowerCase() === currentCode;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><code><strong>${u.code.toUpperCase()}</strong></code></td>
                <td><strong>${u.avatar || (u.role === ROLES.ADMIN ? '💼' : '👩‍💼')} ${u.name}</strong></td>
                <td>${u.title || '-'}</td>
                <td><span class="badge ${u.role === ROLES.ADMIN ? 'badge-red' : 'badge-blue'}">${u.role}</span></td>
                <td class="text-right">
                    <button class="btn btn-sm btn-secondary" onclick="app.editUser('${u.code}')">✏️ Editar</button>
                    ${!isSelf ? `<button class="btn btn-sm" style="background:#fef2f2;color:#dc2626;border:1px solid #fca5a5;margin-left:6px;" onclick="app.deleteUser('${u.code}', '${u.name}')" title="Excluir Colaborador">🗑️ Excluir</button>` : `<span style="font-size:0.8em;color:#94a3b8;margin-left:6px;">(Você)</span>`}
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    export function openNewUserModal() {
        _editingUserOriginalCode = null;
        const titleEl = document.getElementById('user-modal-title');
        if (titleEl) titleEl.textContent = '➕ Cadastrar Novo Colaborador';
        document.getElementById('user-code-input').value = '';
        document.getElementById('user-name-input').value = '';
        document.getElementById('user-title-input').value = '';
        document.getElementById('user-role-input').value = 'OPERADOR';
        document.getElementById('user-modal').classList.add('active');
    }

    export function editUser(userCode) {
        const user = (_config.getState().users || []).find(u => u.code.toLowerCase() === userCode.toLowerCase());
        if (!user) return;

        _editingUserOriginalCode = user.code.toLowerCase();
        const titleEl = document.getElementById('user-modal-title');
        if (titleEl) titleEl.textContent = `✏️ Editar Colaborador (${escapeHtml(user.code.toUpperCase())})`;

        document.getElementById('user-code-input').value = user.code.toUpperCase();
        document.getElementById('user-name-input').value = user.name;
        document.getElementById('user-title-input').value = user.title || '';
        document.getElementById('user-role-input').value = user.role;
        document.getElementById('user-modal').classList.add('active');
    }

    export async function saveUser() {
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
            title: title || (role === ROLES.ADMIN ? 'Gestor' : 'Recepção'),
            role,
            avatar: role === ROLES.ADMIN ? '💼' : '👩‍💼'
        };

        const originalCode = _editingUserOriginalCode;
        const opName = _config.getCurrentUser() ? `${_config.getCurrentUser().name} [${_config.getCurrentUser().code.toUpperCase()}]` : 'Luan [F20729]';

        if (_config.getUseSupabase()) {
            try {
                const { upsertUser } = await import('../services/data-service.js');

                await upsertUser(userPayload, opName, originalCode);
                alert(`✅ Colaborador ${name} (${code.toUpperCase()}) salvo no Supabase Cloud com sucesso!`);
                await _config.syncWithSupabase(false);
                closeUserModal();
                _config.renderAll();
                return;
            } catch (e) {
                console.error('❌ Erro ao salvar colaborador no Supabase:', e);
                alert(`❌ Erro ao salvar colaborador: ${e.message}`);
                return;
            }
        }

        try {
            const res = await fetch(`${_config.getApiBase()}/api/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...userPayload, originalCode })
            });
            if (res.ok) {
                const data = await res.json();
                _config.getState() = data.state;
                _config.saveLocalState(data.state);
            }
        } catch (e) {
            if (originalCode && originalCode !== code) {
                _config.getState().users = _config.getState().users.filter(u => u.code.toLowerCase() !== originalCode);
            }
            const idx = _config.getState().users.findIndex(u => u.code.toLowerCase() === code);
            if (idx !== -1) {
                _config.getState().users[idx] = userPayload;
            } else {
                _config.getState().users.push(userPayload);
            }
            _config.saveLocalState(_config.getState());
        }

        closeUserModal();
        _config.renderAll();
        alert(`✅ Colaborador ${name} (${code.toUpperCase()}) salvo com sucesso!`);
    }

    export async function deleteUser(userCode, userName) {
        const code = userCode.toLowerCase();
        const currentCode = _config.getCurrentUser() ? _config.getCurrentUser().code.toLowerCase() : '';

        if (code === currentCode) {
            alert('⚠️ Você não pode excluir o seu próprio usuário enquanto estiver logado nele.');
            return;
        }

        const confirmDel = confirm(`Tem certeza que deseja EXCLUIR o colaborador "${userName}" (${userCode.toUpperCase()})?\n\nEle não poderá mais acessar o sistema ou abrir turnos.`);
        if (!confirmDel) return;

        const opName = _config.getCurrentUser() ? `${_config.getCurrentUser().name} [${_config.getCurrentUser().code.toUpperCase()}]` : 'Luan [F20729]';

        if (_config.getUseSupabase()) {
            try {
                const { deleteUser } = await import('../services/data-service.js');

                await deleteUser(code, userName, opName);
                alert(`🗑️ Colaborador ${userName} (${userCode.toUpperCase()}) excluído com sucesso!`);
                await _config.syncWithSupabase(false);
                _config.renderAll();
                return;
            } catch (e) {
                console.error('❌ Erro ao excluir colaborador no Supabase:', e);
                alert(`❌ Erro ao excluir colaborador: ${e.message}`);
                return;
            }
        }

        try {
            const res = await fetch(`${_config.getApiBase()}/api/users/${code}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                const data = await res.json();
                _config.getState() = data.state;
                _config.saveLocalState(data.state);
            }
        } catch (e) {
            _config.getState().users = _config.getState().users.filter(u => u.code.toLowerCase() !== code);
            _config.saveLocalState(_config.getState());
        }

        _config.renderAll();
        alert(`🗑️ Colaborador ${userName} (${userCode.toUpperCase()}) excluído com sucesso!`);
    }

    export function closeUserModal() {
        _editingUserOriginalCode = null;
        document.getElementById('user-modal').classList.remove('active');
    }