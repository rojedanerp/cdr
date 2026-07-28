import { auth, db } from './firebase-config.js';

// ============================================
// AUTENTICACIÓN — proteger la página
// ============================================
auth.onAuthStateChanged(user => {
    if (!user) {
        window.location.href = 'index.html';
    } else {
        document.getElementById('userEmail').textContent = user.email;
    }
});

window.logout = async () => {
    await auth.signOut();
    window.location.href = 'index.html';
};

// ============================================
// NAVEGACIÓN DEL SIDEBAR
// ============================================
const navLinks = document.querySelectorAll('.nav-links li');
const sections = document.querySelectorAll('.section');

navLinks.forEach(link => {
    link.addEventListener('click', () => {
        navLinks.forEach(l => l.classList.remove('active'));
        sections.forEach(s => s.classList.remove('active'));

        link.classList.add('active');
        document.getElementById(link.dataset.section).classList.add('active');

        document.getElementById('sidebar').classList.remove('open');
    });
});

document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
});

// ============================================
// UTILIDADES
// ============================================
const formatMoney = (num, currency) => {
    if (num === null || num === undefined || isNaN(num)) return '—';
    return `${Number(num).toLocaleString('es-CL', { maximumFractionDigits: 2 })} ${currency || ''}`.trim();
};

const formatDate = (timestamp) => {
    if (!timestamp || !timestamp.toDate) return '—';
    return timestamp.toDate().toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const badgeClass = (estado) => {
    if (estado === 'completado') return 'badge badge-success';
    if (estado === 'cancelado') return 'badge badge-danger';
    return 'badge badge-pending';
};

const badgeLabel = (estado) => {
    if (estado === 'completado') return 'Completado';
    if (estado === 'cancelado') return 'Cancelado';
    return 'Pendiente';
};

// ============================================
// NUEVA REMESA — cálculo en vivo del monto a recibir
// ============================================
const montoEnviadoInput = document.getElementById('montoEnviado');
const tasaCambioInput = document.getElementById('tasaCambio');
const montoRecibidoInput = document.getElementById('montoRecibido');
const monedaRecibidoInput = document.getElementById('monedaRecibido');

function recalcularMontoRecibido() {
    const enviado = parseFloat(montoEnviadoInput.value);
    const tasa = parseFloat(tasaCambioInput.value);
    if (!isNaN(enviado) && !isNaN(tasa)) {
        const resultado = enviado * tasa;
        montoRecibidoInput.value = formatMoney(resultado, monedaRecibidoInput.value);
    } else {
        montoRecibidoInput.value = '—';
    }
}

[montoEnviadoInput, tasaCambioInput, monedaRecibidoInput].forEach(el => {
    el.addEventListener('input', recalcularMontoRecibido);
});

// ============================================
// NUEVA REMESA — envío del formulario
// ============================================
const remesaForm = document.getElementById('remesaForm');
const remesaSubmitBtn = document.getElementById('remesaSubmitBtn');
const remesaMessage = document.getElementById('remesaMessage');

remesaForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const montoEnviado = parseFloat(montoEnviadoInput.value);
    const tasaCambio = parseFloat(tasaCambioInput.value);
    const monedaRecibido = monedaRecibidoInput.value.trim().toUpperCase();
    const montoRecibido = montoEnviado * tasaCambio;

    const data = {
        clienteNombre: document.getElementById('clienteNombre').value.trim(),
        clienteTelefono: document.getElementById('clienteTelefono').value.trim(),
        paisOrigen: document.getElementById('paisOrigen').value.trim(),
        paisDestino: document.getElementById('paisDestino').value.trim(),
        montoEnviado,
        monedaEnviado: document.getElementById('monedaEnviado').value.trim().toUpperCase(),
        tasaCambio,
        montoRecibido,
        monedaRecibido,
        estado: document.getElementById('estado').value,
        creadoPor: auth.currentUser ? auth.currentUser.uid : null,
        creadoPorEmail: auth.currentUser ? auth.currentUser.email : null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    remesaSubmitBtn.disabled = true;
    remesaSubmitBtn.querySelector('.btn-text').textContent = 'Guardando...';
    remesaSubmitBtn.querySelector('.spinner').classList.remove('hidden');
    remesaMessage.textContent = '';
    remesaMessage.className = 'form-message';

    try {
        await db.collection('remesas').add(data);
        remesaForm.reset();
        montoRecibidoInput.value = '—';
        remesaMessage.textContent = 'Remesa registrada correctamente.';
        remesaMessage.className = 'form-message form-message-success';
    } catch (error) {
        console.error('Error al registrar remesa:', error);
        remesaMessage.textContent = 'No se pudo guardar la remesa. Intenta de nuevo.';
        remesaMessage.className = 'form-message form-message-error';
    } finally {
        remesaSubmitBtn.disabled = false;
        remesaSubmitBtn.querySelector('.btn-text').textContent = 'Registrar remesa';
        remesaSubmitBtn.querySelector('.spinner').classList.add('hidden');
    }
});

// ============================================
// HISTORIAL + DASHBOARD — escucha en tiempo real
// ============================================
const historialBody = document.getElementById('historialBody');
const historialEmpty = document.getElementById('historialEmpty');
const dashboardPanel = document.querySelector('#dashboard .panel');

function routeTagHTML(origen, destino) {
    return `
        <span class="route-tag" title="${origen} → ${destino}">
            <i class="dot dot-origin"></i><i class="route-line"></i><i class="dot dot-dest"></i>
        </span>
        <span class="route-text">${origen} → ${destino}</span>
    `;
}

function renderHistorialRow(id, r) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${formatDate(r.createdAt)}</td>
        <td>${r.clienteNombre || '—'}</td>
        <td class="route-cell">${routeTagHTML(r.paisOrigen || '?', r.paisDestino || '?')}</td>
        <td class="mono-cell">${formatMoney(r.montoEnviado, r.monedaEnviado)}</td>
        <td class="mono-cell">${formatMoney(r.montoRecibido, r.monedaRecibido)}</td>
        <td><span class="${badgeClass(r.estado)}">${badgeLabel(r.estado)}</span></td>
    `;
    return tr;
}

db.collection('remesas').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
    // --- Historial completo ---
    historialBody.innerHTML = '';

    if (snapshot.empty) {
        historialEmpty.style.display = 'block';
        document.querySelector('.table-wrap').style.display = 'none';
    } else {
        historialEmpty.style.display = 'none';
        document.querySelector('.table-wrap').style.display = 'block';
        snapshot.forEach(doc => {
            historialBody.appendChild(renderHistorialRow(doc.id, doc.data()));
        });
    }

    // --- Estadísticas del dashboard ---
    const docs = snapshot.docs.map(d => d.data());
    const hoy = new Date();
    const esHoy = (ts) => ts && ts.toDate && ts.toDate().toDateString() === hoy.toDateString();
    const esEsteMes = (ts) => ts && ts.toDate && ts.toDate().getMonth() === hoy.getMonth() && ts.toDate().getFullYear() === hoy.getFullYear();

    const enviadoHoy = docs.filter(r => esHoy(r.createdAt)).reduce((sum, r) => sum + (r.montoEnviado || 0), 0);
    const remesasMes = docs.filter(r => esEsteMes(r.createdAt)).length;
    const pendientes = docs.filter(r => r.estado === 'pendiente').length;
    const clientesActivos = new Set(docs.map(r => r.clienteNombre).filter(Boolean)).size;

    document.querySelector('[data-stat="enviado-hoy"]').textContent = enviadoHoy ? enviadoHoy.toLocaleString('es-CL') : '0';
    document.querySelector('[data-stat="remesas-mes"]').textContent = remesasMes;
    document.querySelector('[data-stat="pendientes"]').textContent = pendientes;
    document.querySelector('[data-stat="clientes-activos"]').textContent = clientesActivos;

    // --- Últimas remesas en el dashboard (máx 5) ---
    const ultimasWrap = dashboardPanel.querySelector('.dashboard-latest-wrap');
    const ultimasEmpty = dashboardPanel.querySelector('.empty-state');

    if (snapshot.empty) {
        if (ultimasWrap) ultimasWrap.remove();
        if (ultimasEmpty) ultimasEmpty.style.display = 'block';
    } else {
        if (ultimasEmpty) ultimasEmpty.style.display = 'none';

        let wrap = dashboardPanel.querySelector('.dashboard-latest-wrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.className = 'dashboard-latest-wrap table-wrap';
            dashboardPanel.appendChild(wrap);
        }
        wrap.innerHTML = '<table class="data-table"><tbody></tbody></table>';
        const tbody = wrap.querySelector('tbody');
        snapshot.docs.slice(0, 5).forEach(doc => {
            const r = doc.data();
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatDate(r.createdAt)}</td>
                <td>${r.clienteNombre || '—'}</td>
                <td class="route-cell">${routeTagHTML(r.paisOrigen || '?', r.paisDestino || '?')}</td>
                <td class="mono-cell">${formatMoney(r.montoEnviado, r.monedaEnviado)}</td>
                <td><span class="${badgeClass(r.estado)}">${badgeLabel(r.estado)}</span></td>
            `;
            tbody.appendChild(tr);
        });
    }
}, error => {
    console.error('Error escuchando remesas:', error);
});
