import { auth, db } from './firebase-config.js';
import { escapeHtml, fechaArchivo, normalizarNombre, initFiltrosToggle, actualizarPanelFiltros } from './shared.js';
import { showSection } from './ui.js';

// ============================================
// CLIENTES — CRUD + caché para vincular remesas
// clientesCache/clientesPorId se exportan de solo lectura para que
// remesas.js pueda autocompletar y vincular el cliente de una remesa.
// ============================================
export let clientesCache = {};       // { "juan perez": { id, nombre, telefono, paisDestino, ... } } — clave normalizada por nombre
export let clientesPorId = {};       // { docId: data }

function formatClienteFecha(timestamp) {
    if (!timestamp || !timestamp.toDate) return '—';
    return timestamp.toDate().toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const clienteForm = document.getElementById('clienteForm');
const clienteFormTitle = document.getElementById('clienteFormTitle');
const clienteDocIdInput = document.getElementById('clienteDocId');
const clienteFormNombreInput = document.getElementById('clienteFormNombre');
const clienteFormTelefonoInput = document.getElementById('clienteFormTelefono');
const clienteFormPaisDestinoInput = document.getElementById('clienteFormPaisDestino');
const clienteFormNotasInput = document.getElementById('clienteFormNotas');
const clienteSubmitBtn = document.getElementById('clienteSubmitBtn');
const clienteCancelBtn = document.getElementById('clienteCancelBtn');
const clienteMessage = document.getElementById('clienteMessage');
const clientesBody = document.getElementById('clientesBody');
const clientesEmpty = document.getElementById('clientesEmpty');
const clientesTableWrap = document.getElementById('clientesTableWrap');
const listaClientesDatalist = document.getElementById('listaClientes');
const clientesFiltroPais = document.getElementById('clientesFiltroPais');
const clientesFiltroBuscar = document.getElementById('clientesFiltroBuscar');
const clientesFiltroLimpiar = document.getElementById('clientesFiltroLimpiar');
// Guarda el listado completo de clientes (tal como llega de Firestore) para
// poder re-filtrar en el cliente sin volver a consultar.
let clientesListaCache = [];
// Subconjunto actualmente visible según los filtros de Clientes, usado para exportar.
let clientesFiltrado = [];

function resetClienteForm() {
    clienteForm.reset();
    clienteDocIdInput.value = '';
    clienteFormTitle.textContent = 'Nuevo cliente';
    clienteSubmitBtn.querySelector('.btn-text').textContent = 'Guardar cliente';
    clienteCancelBtn.classList.add('hidden');
    clienteMessage.textContent = '';
    clienteMessage.className = 'form-message';
}

window.editarCliente = (docId) => {
    const data = clientesPorId[docId];
    if (!data) return;

    clienteDocIdInput.value = docId;
    clienteFormNombreInput.value = data.nombre || '';
    clienteFormTelefonoInput.value = data.telefono || '';
    clienteFormPaisDestinoInput.value = data.paisDestino || '';
    clienteFormNotasInput.value = data.notas || '';
    clienteFormTitle.textContent = `Editando: ${data.nombre}`;
    clienteSubmitBtn.querySelector('.btn-text').textContent = 'Actualizar cliente';
    clienteCancelBtn.classList.remove('hidden');
    clienteMessage.textContent = '';
    clienteMessage.className = 'form-message';
    clienteFormNombreInput.focus();
    showSection('clientes');
};

window.eliminarCliente = async (docId) => {
    if (!confirm('¿Eliminar este cliente? Las remesas ya registradas no se verán afectadas.')) return;
    try {
        await db.collection('clientes').doc(docId).delete();
    } catch (error) {
        console.error('Error al eliminar cliente:', error);
        alert('No se pudo eliminar el cliente. Intenta de nuevo.');
    }
};

function renderClienteRow(docId, data) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${escapeHtml(data.nombre) || '—'}</td>
        <td class="mono-cell">${escapeHtml(data.telefono) || '—'}</td>
        <td>${escapeHtml(data.paisDestino) || '—'}</td>
        <td>${formatClienteFecha(data.ultimaRemesaEn)}</td>
        <td>
            <button type="button" class="btn-icon-action" onclick="editarCliente('${docId}')"><i class="ti ti-pencil" aria-hidden="true"></i> Editar</button>
            <button type="button" class="btn-icon-action danger" onclick="eliminarCliente('${docId}')"><i class="ti ti-trash" aria-hidden="true"></i> Eliminar</button>
        </td>
    `;
    return tr;
}

// Repuebla el <select> de país destino con los países que realmente
// aparecen en los clientes, conservando la selección actual si sigue existiendo.
function poblarSelectPaisesClientes(lista) {
    const paises = [...new Set(lista.map(({ data }) => data.paisDestino).filter(Boolean))].sort();
    const valorActual = clientesFiltroPais.value;
    clientesFiltroPais.innerHTML = '<option value="todos">Todos</option>' +
        paises.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    clientesFiltroPais.value = paises.includes(valorActual) ? valorActual : 'todos';
}

// Aplica los filtros de país destino y búsqueda por nombre/teléfono sobre
// clientesListaCache, y vuelve a pintar la tabla de Clientes.
function aplicarFiltroClientes() {
    const paisFiltro = clientesFiltroPais.value;
    const textoBusqueda = clientesFiltroBuscar.value.trim().toLowerCase();
    const hayFiltrosActivos = paisFiltro !== 'todos' || textoBusqueda !== '';

    const filtrados = clientesListaCache.filter(({ data }) => {
        if (paisFiltro !== 'todos' && data.paisDestino !== paisFiltro) return false;
        if (textoBusqueda) {
            const enNombre = (data.nombre || '').toLowerCase().includes(textoBusqueda);
            const enTelefono = (data.telefono || '').toLowerCase().includes(textoBusqueda);
            if (!enNombre && !enTelefono) return false;
        }
        return true;
    });

    actualizarPanelFiltros('clientes', [
        {
            label: 'País destino', activo: paisFiltro !== 'todos',
            texto: `País: ${paisFiltro}`,
            onQuitar: () => { clientesFiltroPais.value = 'todos'; aplicarFiltroClientes(); }
        },
        {
            label: 'Búsqueda', activo: textoBusqueda !== '',
            texto: `Nombre/teléfono: "${clientesFiltroBuscar.value.trim()}"`,
            onQuitar: () => { clientesFiltroBuscar.value = ''; aplicarFiltroClientes(); }
        }
    ], { mostrados: filtrados.length, total: clientesListaCache.length });

    clientesFiltrado = filtrados;
    clientesBody.innerHTML = '';
    if (filtrados.length === 0) {
        clientesEmpty.style.display = 'block';
        clientesTableWrap.style.display = 'none';
        clientesEmpty.querySelector('p').textContent = hayFiltrosActivos
            ? 'No hay clientes que coincidan con el filtro.'
            : 'Todavía no hay clientes registrados.';
        return;
    }
    clientesEmpty.style.display = 'none';
    clientesTableWrap.style.display = 'block';
    filtrados.forEach(({ id, data }) => {
        clientesBody.appendChild(renderClienteRow(id, data));
    });
}

// ============================================
// EXPORTAR CLIENTES — PDF (jsPDF) y Excel (SheetJS)
// Exporta siempre lo que está visible en pantalla (respeta los filtros activos).
// ============================================
const clientesExportarPdfBtn = document.getElementById('clientesExportarPdfBtn');
const clientesExportarExcelBtn = document.getElementById('clientesExportarExcelBtn');

function filasExportClientes() {
    return clientesFiltrado.map(({ data }) => ({
        Nombre: data.nombre || '—',
        Teléfono: data.telefono || '—',
        'País destino': data.paisDestino || '—',
        'Última remesa': formatClienteFecha(data.ultimaRemesaEn)
    }));
}

// Inicializa el formulario de Clientes, sus filtros/exportación y la
// escucha en tiempo real de la colección clientes. Se llama una sola vez
// desde app.js al arrancar.
export function initClientes() {
    clienteCancelBtn.addEventListener('click', resetClienteForm);

    clienteForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const docId = clienteDocIdInput.value;
        const nombre = clienteFormNombreInput.value.trim();
        const claveNombre = normalizarNombre(nombre);

        // Evitar duplicados: si ya existe un cliente con ese nombre (y no es el que estamos editando), avisar.
        const existente = clientesCache[claveNombre];
        if (existente && existente.id !== docId) {
            clienteMessage.textContent = `Ya existe un cliente llamado "${nombre}". Edítalo en vez de crear uno nuevo.`;
            clienteMessage.className = 'form-message form-message-error';
            return;
        }

        const data = {
            nombre,
            telefono: clienteFormTelefonoInput.value.trim(),
            paisDestino: clienteFormPaisDestinoInput.value.trim(),
            notas: clienteFormNotasInput.value.trim(),
            actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(),
            actualizadoPor: auth.currentUser ? auth.currentUser.email : null
        };

        clienteSubmitBtn.disabled = true;
        clienteSubmitBtn.querySelector('.btn-text').textContent = 'Guardando...';
        clienteSubmitBtn.querySelector('.spinner').classList.remove('hidden');
        clienteMessage.textContent = '';
        clienteMessage.className = 'form-message';

        try {
            if (docId) {
                await db.collection('clientes').doc(docId).update(data);
            } else {
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await db.collection('clientes').add(data);
            }
            resetClienteForm();
            clienteMessage.textContent = 'Cliente guardado correctamente.';
            clienteMessage.className = 'form-message form-message-success';
        } catch (error) {
            console.error('Error al guardar cliente:', error);
            clienteMessage.textContent = 'No se pudo guardar el cliente. Intenta de nuevo.';
            clienteMessage.className = 'form-message form-message-error';
        } finally {
            clienteSubmitBtn.disabled = false;
            clienteSubmitBtn.querySelector('.spinner').classList.add('hidden');
        }
    });

    clientesFiltroPais.addEventListener('change', aplicarFiltroClientes);
    clientesFiltroBuscar.addEventListener('input', aplicarFiltroClientes);
    clientesFiltroLimpiar.addEventListener('click', () => {
        clientesFiltroPais.value = 'todos';
        clientesFiltroBuscar.value = '';
        aplicarFiltroClientes();
    });
    initFiltrosToggle('clientes');

    clientesExportarPdfBtn.addEventListener('click', () => {
        if (clientesFiltrado.length === 0) {
            alert('No hay clientes para exportar con los filtros actuales.');
            return;
        }
        const filas = filasExportClientes();
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape' });

        doc.setFontSize(14);
        doc.text('Clientes', 14, 15);
        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · ${filas.length} cliente(s)`, 14, 21);

        doc.autoTable({
            startY: 26,
            head: [['Nombre', 'Teléfono', 'País destino', 'Última remesa']],
            body: filas.map(f => [f.Nombre, f.Teléfono, f['País destino'], f['Última remesa']]),
            styles: { fontSize: 8.5, cellPadding: 3 },
            headStyles: { fillColor: [30, 41, 59] },
            alternateRowStyles: { fillColor: [245, 246, 248] }
        });

        doc.save(`clientes-${fechaArchivo()}.pdf`);
    });

    clientesExportarExcelBtn.addEventListener('click', () => {
        if (clientesFiltrado.length === 0) {
            alert('No hay clientes para exportar con los filtros actuales.');
            return;
        }
        const filas = filasExportClientes();
        const hoja = XLSX.utils.json_to_sheet(filas);
        hoja['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
        const libro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(libro, hoja, 'Clientes');
        XLSX.writeFile(libro, `clientes-${fechaArchivo()}.xlsx`);
    });

    db.collection('clientes').orderBy('nombre').onSnapshot(snapshot => {
        clientesCache = {};
        clientesPorId = {};
        listaClientesDatalist.innerHTML = '';

        const lista = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            const entry = { id: doc.id, ...data };
            clientesCache[normalizarNombre(data.nombre)] = entry;
            clientesPorId[doc.id] = data;
            lista.push({ id: doc.id, data });

            const option = document.createElement('option');
            option.value = data.nombre;
            listaClientesDatalist.appendChild(option);
        });

        clientesListaCache = lista;
        poblarSelectPaisesClientes(lista);
        aplicarFiltroClientes();
    }, error => {
        console.error('Error escuchando clientes:', error);
    });
}
