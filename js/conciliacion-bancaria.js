// ============================================
// CONCILIACIÓN BANCARIA (CSV) — módulo independiente.
// Compara la cartola exportada del banco (CSV) contra los
// movimientos ya registrados en `movimientosCaja`, para detectar
// transferencias que faltan por registrar o diferencias.
//
// Se carga como módulo aparte (no toca app.js) e importa `db`/`auth`
// del mismo firebase-config.js que ya usa el resto de la app.
// ============================================
import { auth, db } from './firebase-config.js';

const cajaColeccion = db.collection('movimientosCaja');
const auditoriaColeccion = db.collection('auditoria');

// --- Utilidades compartidas (copias locales; este módulo no depende
// de variables internas de app.js a propósito, para poder cargarse
// o quitarse sin afectar el resto del sistema). ---
const escapeHtml = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

const formatMoney = (num, currency) => {
    if (num === null || num === undefined || isNaN(num)) return '—';
    return `${Number(num).toLocaleString('es-CL', { maximumFractionDigits: 2 })} ${escapeHtml(currency || '')}`.trim();
};

const formatFechaLocal = (date) => {
    if (!date) return '—';
    return date.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// ============================================
// REFERENCIAS DEL DOM
// ============================================
const elArchivo = document.getElementById('conciliacionBancArchivo');
const elMoneda = document.getElementById('conciliacionBancMoneda');
const elToleranciaDias = document.getElementById('conciliacionBancToleranciaDias');
const elToleranciaMonto = document.getElementById('conciliacionBancToleranciaMonto');
const elMapeoWrap = document.getElementById('conciliacionBancMapeoWrap');
const elColFecha = document.getElementById('conciliacionBancColFecha');
const elColDescripcion = document.getElementById('conciliacionBancColDescripcion');
const elModoMonto = document.getElementById('conciliacionBancModoMonto');
const elColMontoUnicoWrap = document.getElementById('conciliacionBancColMontoUnicoWrap');
const elColMontoUnico = document.getElementById('conciliacionBancColMontoUnico');
const elColCargoWrap = document.getElementById('conciliacionBancColCargoWrap');
const elColCargo = document.getElementById('conciliacionBancColCargo');
const elColAbonoWrap = document.getElementById('conciliacionBancColAbonoWrap');
const elColAbono = document.getElementById('conciliacionBancColAbono');
const elPreviewHead = document.getElementById('conciliacionBancPreviewHead');
const elPreviewBody = document.getElementById('conciliacionBancPreviewBody');
const elAnalizarBtn = document.getElementById('conciliacionBancAnalizarBtn');
const elMessage = document.getElementById('conciliacionBancMessage');
const elEstadoBadge = document.getElementById('conciliacionBancEstadoBadge');
const elResultados = document.getElementById('conciliacionBancResultados');
const elTotalMatch = document.getElementById('conciliacionBancTotalMatch');
const elTotalSinBanco = document.getElementById('conciliacionBancTotalSinBanco');
const elTotalSinCaja = document.getElementById('conciliacionBancTotalSinCaja');
const elMatchBody = document.getElementById('conciliacionBancMatchBody');
const elSinBancoBody = document.getElementById('conciliacionBancSinBancoBody');
const elSinCajaBody = document.getElementById('conciliacionBancSinCajaBody');
const elConfirmarBtn = document.getElementById('conciliacionBancConfirmarBtn');

// Si el panel no está en esta página (por si el HTML no se actualizó todavía), no hacer nada.
if (!elArchivo) {
    console.warn('Panel de conciliación bancaria no encontrado en el DOM.');
} else {
    iniciar();
}

function iniciar() {
    let filasCSV = []; // array de arrays (incluye encabezado en [0])
    let encabezados = [];
    let ultimoResultado = null; // { matches, sinBanco, sinCaja }

    elArchivo.addEventListener('change', async () => {
        const archivo = elArchivo.files[0];
        if (!archivo) return;

        setMensaje('');
        elMapeoWrap.classList.add('hidden');
        elResultados.classList.add('hidden');
        elEstadoBadge.textContent = 'Leyendo archivo...';
        elEstadoBadge.className = 'badge badge-neutral';

        try {
            const texto = await leerArchivoComoTexto(archivo);
            const delimitador = detectarDelimitador(texto);
            filasCSV = parsearCSV(texto, delimitador);

            if (filasCSV.length < 2) {
                throw new Error('El archivo no parece tener datos (se necesita al menos una fila de encabezado y una de datos).');
            }

            encabezados = filasCSV[0];
            poblarSelectsColumnas(encabezados);
            renderPreview(filasCSV);
            elMapeoWrap.classList.remove('hidden');
            elEstadoBadge.textContent = `${filasCSV.length - 1} filas leídas`;
            elEstadoBadge.className = 'badge badge-success';
        } catch (error) {
            console.error('Error al leer CSV:', error);
            setMensaje('No se pudo leer el archivo. Revisa que sea un CSV exportado desde tu banco.', true);
            elEstadoBadge.textContent = 'Error al leer';
            elEstadoBadge.className = 'badge badge-danger';
        }
    });

    elModoMonto.addEventListener('change', () => {
        const separado = elModoMonto.value === 'separado';
        elColMontoUnicoWrap.classList.toggle('hidden', separado);
        elColCargoWrap.classList.toggle('hidden', !separado);
        elColAbonoWrap.classList.toggle('hidden', !separado);
    });

    elAnalizarBtn.addEventListener('click', async () => {
        setMensaje('');
        setBotonCargando(elAnalizarBtn, true);
        try {
            const movimientosBanco = construirMovimientosBanco(filasCSV);
            if (movimientosBanco.length === 0) {
                throw new Error('No se pudo interpretar ninguna fila con el mapeo de columnas indicado. Revisa las columnas seleccionadas.');
            }

            const moneda = (elMoneda.value || 'CLP').trim().toUpperCase();
            const toleranciaDias = Math.max(0, parseInt(elToleranciaDias.value, 10) || 0);
            const toleranciaMonto = Math.max(0, parseFloat(elToleranciaMonto.value) || 0);

            const fechas = movimientosBanco.map(m => m.fecha.getTime());
            const minFecha = new Date(Math.min(...fechas) - (toleranciaDias + 1) * 86400000);
            const maxFecha = new Date(Math.max(...fechas) + (toleranciaDias + 1) * 86400000);

            const movimientosCaja = await cargarMovimientosCaja(minFecha, maxFecha, moneda);

            ultimoResultado = conciliar(movimientosBanco, movimientosCaja, toleranciaDias, toleranciaMonto);
            renderResultados(ultimoResultado);
            elResultados.classList.remove('hidden');
            elResultados.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (error) {
            console.error('Error al analizar conciliación:', error);
            setMensaje(error.message || 'No se pudo analizar la conciliación.', true);
        } finally {
            setBotonCargando(elAnalizarBtn, false);
        }
    });

    elConfirmarBtn.addEventListener('click', async () => {
        if (!ultimoResultado || ultimoResultado.matches.length === 0) return;
        const pendientes = ultimoResultado.matches.filter(m => !m.caja.data.conciliado);
        if (pendientes.length === 0) {
            setMensaje('Todas las coincidencias ya estaban marcadas como conciliadas.', false);
            return;
        }
        if (!confirm(`¿Marcar ${pendientes.length} movimiento(s) de caja como conciliados con el banco?`)) return;

        setBotonCargando(elConfirmarBtn, true);
        try {
            const batch = db.batch();
            pendientes.forEach(m => {
                const ref = cajaColeccion.doc(m.caja.id);
                batch.update(ref, {
                    conciliado: true,
                    conciliadoEn: firebase.firestore.FieldValue.serverTimestamp(),
                    conciliacionBanco: {
                        fecha: m.banco.fecha.toISOString().slice(0, 10),
                        descripcion: m.banco.descripcion || '',
                        monto: m.banco.monto
                    }
                });
            });
            await batch.commit();

            auditoriaColeccion.add({
                tipo: 'caja',
                accion: 'conciliar',
                detalle: { cantidad: pendientes.length },
                usuarioEmail: auth.currentUser ? auth.currentUser.email : null,
                usuarioUid: auth.currentUser ? auth.currentUser.uid : null,
                creadoEn: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(err => console.warn('No se pudo registrar la auditoría de conciliación:', err));

            pendientes.forEach(m => { m.caja.data.conciliado = true; });
            renderResultados(ultimoResultado);
            setMensaje(`${pendientes.length} movimiento(s) marcados como conciliados.`, false);
        } catch (error) {
            console.error('Error al confirmar conciliación:', error);
            setMensaje('No se pudo guardar la conciliación. Intenta de nuevo.', true);
        } finally {
            setBotonCargando(elConfirmarBtn, false);
        }
    });

    // --- Registrar como movimiento manual (filas del banco sin match) ---
    elSinBancoBody.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-registrar-idx]');
        if (!btn) return;
        const idx = parseInt(btn.dataset.registrarIdx, 10);
        const mov = ultimoResultado.sinBanco[idx];
        if (!mov) return;

        const moneda = (elMoneda.value || 'CLP').trim().toUpperCase();
        btn.disabled = true;
        btn.textContent = 'Registrando...';
        try {
            await cajaColeccion.add({
                tipo: mov.monto >= 0 ? 'entrada' : 'salida',
                moneda,
                monto: Math.abs(mov.monto),
                concepto: `[Cartola ${formatFechaLocal(mov.fecha)}] ${mov.descripcion || 'Movimiento bancario'}`,
                origen: 'manual',
                remesaId: null,
                clienteNombre: null,
                conciliado: true,
                conciliacionBanco: {
                    fecha: mov.fecha.toISOString().slice(0, 10),
                    descripcion: mov.descripcion || '',
                    monto: mov.monto
                },
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                creadoPorEmail: auth.currentUser ? auth.currentUser.email : null
            });
            btn.textContent = 'Registrado ✓';
            btn.closest('tr').classList.add('conciliacion-fila-registrada');
        } catch (error) {
            console.error('Error al registrar movimiento desde cartola:', error);
            btn.disabled = false;
            btn.textContent = 'Reintentar';
        }
    });

    // ============================================
    // LECTURA Y PARSEO DE CSV
    // ============================================
    function leerArchivoComoTexto(archivo) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).replace(/^\uFEFF/, ''));
            reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
            reader.readAsText(archivo, 'UTF-8');
        });
    }

    // Cuenta ocurrencias de cada delimitador candidato en la primera línea
    // no vacía y se queda con el que más columnas produce.
    function detectarDelimitador(texto) {
        const primeraLinea = texto.split(/\r\n|\n/).find(l => l.trim().length > 0) || '';
        const candidatos = [';', ',', '\t'];
        let mejor = ',', max = -1;
        candidatos.forEach(d => {
            const count = primeraLinea.split(d).length;
            if (count > max) { max = count; mejor = d; }
        });
        return mejor;
    }

    // Parser CSV simple que respeta comillas dobles (incluye campos con
    // el delimitador o saltos de línea dentro de comillas).
    function parsearCSV(texto, delimitador) {
        const filas = [];
        let fila = [], campo = '', dentroComillas = false;
        for (let i = 0; i < texto.length; i++) {
            const c = texto[i];
            if (dentroComillas) {
                if (c === '"') {
                    if (texto[i + 1] === '"') { campo += '"'; i++; }
                    else dentroComillas = false;
                } else {
                    campo += c;
                }
            } else if (c === '"') {
                dentroComillas = true;
            } else if (c === delimitador) {
                fila.push(campo.trim());
                campo = '';
            } else if (c === '\n') {
                fila.push(campo.trim());
                filas.push(fila);
                fila = [];
                campo = '';
            } else if (c === '\r') {
                // ignorar, el \n que sigue cierra la fila
            } else {
                campo += c;
            }
        }
        if (campo.length || fila.length) {
            fila.push(campo.trim());
            filas.push(fila);
        }
        return filas.filter(f => f.some(c => c !== ''));
    }

    function poblarSelectsColumnas(headers) {
        const opciones = headers.map((h, i) => `<option value="${i}">${escapeHtml(h || `Columna ${i + 1}`)}</option>`).join('');
        [elColFecha, elColDescripcion, elColMontoUnico, elColCargo, elColAbono].forEach(sel => {
            sel.innerHTML = opciones;
        });
        elColFecha.selectedIndex = indiceProbable(headers, ['fecha', 'date']);
        elColDescripcion.selectedIndex = indiceProbable(headers, ['descripcion', 'glosa', 'detalle', 'concepto']);
        elColMontoUnico.selectedIndex = indiceProbable(headers, ['monto', 'importe', 'valor']);
        elColCargo.selectedIndex = indiceProbable(headers, ['cargo', 'debito', 'débito']);
        elColAbono.selectedIndex = indiceProbable(headers, ['abono', 'credito', 'crédito']);
    }

    function indiceProbable(headers, pistas) {
        const idx = headers.findIndex(h => pistas.some(p => (h || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(p)));
        return idx >= 0 ? idx : 0;
    }

    function renderPreview(filas) {
        const headers = filas[0];
        elPreviewHead.innerHTML = headers.map(h => `<th>${escapeHtml(h || '—')}</th>`).join('');
        const filasDatos = filas.slice(1, 6);
        elPreviewBody.innerHTML = filasDatos.map(f =>
            `<tr>${headers.map((_, i) => `<td>${escapeHtml(f[i] ?? '')}</td>`).join('')}</tr>`
        ).join('') || '<tr><td colspan="99">Sin filas de datos.</td></tr>';
    }

    // ============================================
    // INTERPRETACIÓN DE FECHAS Y MONTOS
    // ============================================
    function parsearFecha(str) {
        if (!str) return null;
        const s = String(str).trim();
        let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (m) {
            let [, d, mo, y] = m;
            if (y.length === 2) y = (Number(y) > 70 ? '19' : '20') + y;
            return new Date(+y, +mo - 1, +d);
        }
        const nativo = new Date(s);
        return isNaN(nativo.getTime()) ? null : nativo;
    }

    function parsearMonto(str) {
        if (str === null || str === undefined) return NaN;
        let s = String(str).trim();
        if (!s) return NaN;
        let negativo = false;
        if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
        if (s.startsWith('-')) negativo = true;
        s = s.replace(/[^0-9.,]/g, '');
        if (!s) return NaN;

        const lastComma = s.lastIndexOf(',');
        const lastDot = s.lastIndexOf('.');
        if (lastComma > -1 && lastDot > -1) {
            if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
            else s = s.replace(/,/g, '');
        } else if (lastComma > -1) {
            const digitsAfter = s.length - lastComma - 1;
            s = digitsAfter === 3 ? s.replace(/,/g, '') : s.replace(',', '.');
        } else if (lastDot > -1) {
            const digitsAfter = s.length - lastDot - 1;
            if (digitsAfter === 3) s = s.replace(/\./g, '');
        }

        const num = parseFloat(s);
        if (isNaN(num)) return NaN;
        return negativo ? -Math.abs(num) : num;
    }

    // Devuelve [{fecha: Date, descripcion, monto (con signo: + entrada, - salida)}]
    function construirMovimientosBanco(filas) {
        const idxFecha = Number(elColFecha.value);
        const idxDesc = Number(elColDescripcion.value);
        const modoSeparado = elModoMonto.value === 'separado';
        const idxMonto = Number(elColMontoUnico.value);
        const idxCargo = Number(elColCargo.value);
        const idxAbono = Number(elColAbono.value);

        const resultado = [];
        filas.slice(1).forEach(f => {
            const fecha = parsearFecha(f[idxFecha]);
            if (!fecha) return;
            const descripcion = f[idxDesc] || '';

            let monto;
            if (modoSeparado) {
                const cargo = parsearMonto(f[idxCargo]);
                const abono = parsearMonto(f[idxAbono]);
                if (!isNaN(abono) && abono !== 0) monto = Math.abs(abono);
                else if (!isNaN(cargo) && cargo !== 0) monto = -Math.abs(cargo);
                else return;
            } else {
                monto = parsearMonto(f[idxMonto]);
                if (isNaN(monto) || monto === 0) return;
            }

            resultado.push({ fecha, descripcion, monto });
        });
        return resultado;
    }

    // ============================================
    // CARGA DE MOVIMIENTOS DE CAJA DESDE FIRESTORE
    // ============================================
    async function cargarMovimientosCaja(minFecha, maxFecha, moneda) {
        const snapshot = await cajaColeccion
            .where('createdAt', '>=', minFecha)
            .where('createdAt', '<=', maxFecha)
            .orderBy('createdAt', 'asc')
            .get();

        const movimientos = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if ((data.moneda || '').toUpperCase() !== moneda) return;
            const fecha = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : null;
            if (!fecha) return;
            movimientos.push({ id: doc.id, data, fecha, montoConSigno: data.tipo === 'entrada' ? data.monto : -data.monto });
        });
        return movimientos;
    }

    // ============================================
    // ALGORITMO DE CONCILIACIÓN (1 a 1, mejor candidato primero)
    // ============================================
    function conciliar(movimientosBanco, movimientosCaja, toleranciaDias, toleranciaMonto) {
        const candidatos = [];
        movimientosBanco.forEach((banco, iBanco) => {
            movimientosCaja.forEach((caja, iCaja) => {
                const diffMonto = Math.abs(banco.monto - caja.montoConSigno);
                if (diffMonto > toleranciaMonto) return;
                const diffDias = Math.abs((banco.fecha - caja.fecha) / 86400000);
                if (diffDias > toleranciaDias) return;
                candidatos.push({ iBanco, iCaja, diffMonto, diffDias });
            });
        });

        // Mejor candidato primero: menor diferencia de monto, luego de fecha.
        candidatos.sort((a, b) => (a.diffMonto - b.diffMonto) || (a.diffDias - b.diffDias));

        const bancoUsado = new Set();
        const cajaUsado = new Set();
        const matches = [];

        candidatos.forEach(c => {
            if (bancoUsado.has(c.iBanco) || cajaUsado.has(c.iCaja)) return;
            bancoUsado.add(c.iBanco);
            cajaUsado.add(c.iCaja);
            matches.push({
                banco: movimientosBanco[c.iBanco],
                caja: movimientosCaja[c.iCaja],
                diffDias: c.diffDias
            });
        });

        const sinBanco = movimientosBanco.filter((_, i) => !bancoUsado.has(i));
        const sinCaja = movimientosCaja.filter((_, i) => !cajaUsado.has(i));

        matches.sort((a, b) => a.banco.fecha - b.banco.fecha);
        sinBanco.sort((a, b) => a.fecha - b.fecha);
        sinCaja.sort((a, b) => a.fecha - b.fecha);

        return { matches, sinBanco, sinCaja };
    }

    // ============================================
    // RENDER DE RESULTADOS
    // ============================================
    function renderResultados({ matches, sinBanco, sinCaja }) {
        elTotalMatch.textContent = matches.length;
        elTotalSinBanco.textContent = sinBanco.length;
        elTotalSinCaja.textContent = sinCaja.length;

        elMatchBody.innerHTML = matches.map(m => `
            <tr>
                <td>${formatFechaLocal(m.banco.fecha)}</td>
                <td>${escapeHtml(m.banco.descripcion) || '—'}</td>
                <td class="mono-cell">${formatMoney(m.banco.monto, '')}</td>
                <td>${escapeHtml(m.caja.data.concepto) || '—'} ${m.caja.data.conciliado ? '<span class="badge badge-success">Ya conciliado</span>' : ''}</td>
                <td>${m.diffDias === 0 ? 'Mismo día' : `${m.diffDias.toFixed(0)} día(s)`}</td>
            </tr>
        `).join('') || '<tr><td colspan="5">Sin coincidencias.</td></tr>';

        elSinBancoBody.innerHTML = sinBanco.map((m, i) => `
            <tr>
                <td>${formatFechaLocal(m.fecha)}</td>
                <td>${escapeHtml(m.descripcion) || '—'}</td>
                <td class="mono-cell">${formatMoney(m.monto, '')}</td>
                <td><button type="button" class="btn-secondary" data-registrar-idx="${i}"><i class="ti ti-plus" aria-hidden="true"></i> Registrar en caja</button></td>
            </tr>
        `).join('') || '<tr><td colspan="4">No hay movimientos del banco sin registrar. 🎉</td></tr>';

        elSinCajaBody.innerHTML = sinCaja.map(m => `
            <tr>
                <td>${formatFechaLocal(m.fecha)}</td>
                <td>${m.data.tipo === 'entrada' ? '<span class="badge badge-success">Entrada</span>' : '<span class="badge badge-danger">Salida</span>'}</td>
                <td class="mono-cell">${formatMoney(m.data.monto, '')}</td>
                <td>${escapeHtml(m.data.concepto) || '—'}</td>
                <td>${escapeHtml(m.data.origen) || '—'}</td>
            </tr>
        `).join('') || '<tr><td colspan="5">Todos los movimientos de caja en este rango tienen respaldo bancario.</td></tr>';
    }

    // ============================================
    // HELPERS DE UI
    // ============================================
    function setMensaje(texto, esError) {
        elMessage.textContent = texto;
        elMessage.className = texto ? `form-message ${esError ? 'form-message-error' : 'form-message-success'}` : 'form-message';
    }

    function setBotonCargando(btn, cargando) {
        btn.disabled = cargando;
        const spinner = btn.querySelector('.spinner');
        if (spinner) spinner.classList.toggle('hidden', !cargando);
    }
}
