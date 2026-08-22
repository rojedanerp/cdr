import { auth, db } from './firebase-config.js';
import { escapeHtml, formatMoney } from './shared.js';

// ============================================
// AUDITORÍA — registro automático de cambios importantes
// (tasas, remesas y caja), para poder reconstruir qué
// pasó y quién lo hizo si algún día aparece una diferencia.
// ============================================
const auditoriaColeccion = db.collection('auditoria');

export function registrarAuditoria(tipo, accion, detalle = {}) {
    auditoriaColeccion.add({
        tipo,     // 'tasa' | 'remesa' | 'caja'
        accion,   // 'crear' | 'editar' | 'eliminar' | 'abrir' | 'cerrar'
        detalle,
        usuarioEmail: auth.currentUser ? auth.currentUser.email : null,
        usuarioUid: auth.currentUser ? auth.currentUser.uid : null,
        creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(err => console.warn('No se pudo registrar la auditoría:', err));
    // No bloqueante a propósito: si falla el registro de auditoría, la
    // operación principal (guardar tasa, remesa, caja) igual debe completarse.
}

// ============================================
// VISTA DE AUDITORÍA — lista de solo lectura
// ============================================
const AUDITORIA_TIPO_LABEL = { tasa: 'Tasa', remesa: 'Remesa', caja: 'Caja' };
const AUDITORIA_ACCION_LABEL = {
    crear: 'Creación', editar: 'Edición', eliminar: 'Eliminación',
    abrir: 'Apertura de caja', cerrar: 'Cierre de caja'
};
const AUDITORIA_ACCION_BADGE = {
    crear: 'badge-success', editar: 'badge-pending', eliminar: 'badge-danger',
    abrir: 'badge-success', cerrar: 'badge-neutral'
};

// Convierte el objeto "detalle" guardado en cada registro en una frase legible,
// sin mostrar el JSON crudo.
function formatearDetalleAuditoria(tipo, accion, detalle = {}) {
    if (tipo === 'tasa') {
        if (accion === 'eliminar') return `Par ${detalle.par || '—'} (tasa ${detalle.tasa ?? '—'})`;
        const partes = [`Par ${detalle.par || '—'}: ${detalle.tasaAnterior ?? '—'} → ${detalle.tasaNueva ?? '—'}`];
        if (detalle.tasaMercadoNueva != null && detalle.tasaMercadoNueva !== detalle.tasaMercadoAnterior) {
            partes.push(`mercado ${detalle.tasaMercadoAnterior ?? '—'} → ${detalle.tasaMercadoNueva}`);
        }
        return partes.join(', ');
    }
    if (tipo === 'remesa') {
        const base = `${detalle.cliente || 'Cliente sin nombre'}${detalle.remesaId ? ` (#${detalle.remesaId.slice(0, 6)})` : ''}`;
        if (accion === 'crear') return `${base}: ${formatMoney(detalle.montoEnviado, detalle.monedaEnviado)} a tasa ${detalle.tasaCambio ?? '—'}`;
        if (accion === 'eliminar') return `${base}: ${formatMoney(detalle.montoEnviado, detalle.monedaEnviado)}`;
        const campos = Object.keys(detalle.cambios || {});
        if (campos.length === 0) return `${base}: sin cambios de valor detectados`;
        return `${base}: ${campos.map(c => `${c} ${detalle.cambios[c].antes ?? '—'} → ${detalle.cambios[c].despues ?? '—'}`).join('; ')}`;
    }
    if (tipo === 'caja') {
        if (accion === 'abrir') {
            const saldos = Object.entries(detalle.saldosIniciales || {}).map(([m, v]) => formatMoney(v, m)).join(', ');
            return `Saldos iniciales: ${saldos || '—'}`;
        }
        if (accion === 'cerrar') {
            const diffs = Object.entries(detalle.diferencias || {})
                .filter(([, v]) => v !== 0)
                .map(([m, v]) => formatMoney(v, m));
            return diffs.length ? `Diferencias: ${diffs.join(', ')}` : 'Sin diferencias';
        }
    }
    return '—';
}

const auditoriaBody = document.getElementById('auditoriaBody');
const auditoriaEmpty = document.getElementById('auditoriaEmpty');
const auditoriaFiltroTipo = document.getElementById('auditoriaFiltroTipo');
const auditoriaFiltroBuscar = document.getElementById('auditoriaFiltroBuscar');
let auditoriaRegistros = [];

function renderAuditoria() {
    if (!auditoriaBody) return;
    const tipoFiltro = auditoriaFiltroTipo ? auditoriaFiltroTipo.value : 'todos';
    const busqueda = auditoriaFiltroBuscar ? auditoriaFiltroBuscar.value.trim().toLowerCase() : '';

    const filtrados = auditoriaRegistros.filter(r => {
        if (tipoFiltro !== 'todos' && r.tipo !== tipoFiltro) return false;
        if (!busqueda) return true;
        const texto = `${r.usuarioEmail || ''} ${JSON.stringify(r.detalle || {})}`.toLowerCase();
        return texto.includes(busqueda);
    });

    auditoriaBody.innerHTML = '';
    filtrados.forEach(r => {
        const fecha = r.creadoEn && r.creadoEn.toDate ? r.creadoEn.toDate().toLocaleString('es-CL') : '—';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${fecha}</td>
            <td>${AUDITORIA_TIPO_LABEL[r.tipo] || escapeHtml(r.tipo)}</td>
            <td><span class="badge ${AUDITORIA_ACCION_BADGE[r.accion] || 'badge-neutral'}">${AUDITORIA_ACCION_LABEL[r.accion] || escapeHtml(r.accion)}</span></td>
            <td>${escapeHtml(formatearDetalleAuditoria(r.tipo, r.accion, r.detalle))}</td>
            <td>${escapeHtml(r.usuarioEmail || '—')}</td>
        `;
        auditoriaBody.appendChild(tr);
    });

    auditoriaEmpty.classList.toggle('hidden', filtrados.length > 0);
}

// Inicializa filtros y la escucha en tiempo real de la colección de
// auditoría. Se llama una sola vez desde app.js al arrancar.
export function initAuditoria() {
    if (auditoriaFiltroTipo) auditoriaFiltroTipo.addEventListener('change', renderAuditoria);
    if (auditoriaFiltroBuscar) auditoriaFiltroBuscar.addEventListener('input', renderAuditoria);

    auditoriaColeccion.orderBy('creadoEn', 'desc').limit(300).onSnapshot(snapshot => {
        auditoriaRegistros = snapshot.docs.map(doc => doc.data());
        renderAuditoria();
    }, err => console.warn('No se pudo cargar la auditoría:', err));
}
