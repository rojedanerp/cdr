import { auth, db } from './firebase-config.js';
import { escapeHtml, formatDate } from './shared.js';
import { registrarAuditoria } from './auditoria.js';
import { intentarAutocompletarTasa } from './remesas.js';
import { actualizarDashboardEjecutivo } from './dashboard.js';

// ============================================
// TASAS DE CAMBIO — configuración manual (CRUD) + consulta de tasas en
// vivo (API externa) + conversión entre monedas usando lo configurado.
// tasasCache/tasasMercadoCache se exportan de solo-lectura para que
// remesas.js, reportes.js, caja.js y dashboard.js puedan convertir montos.
// ============================================
export let tasasCache = {};          // { "CLP_PEN": 0.1234, ... } — configuradas manualmente en Configuración
export let tasasMercadoCache = {};   // { "CLP_PEN": 0.1234, ... } — tasa de mercado (sin margen) para calcular ganancia real
let liveRatesCache = {};      // { CLP: { PEN: 0.12, USD: 0.001, ... }, ... } — cacheadas por sesión
let liveRateFetchInFlight = {};

export function claveTasa(origen, destino) {
    return `${(origen || '').trim().toUpperCase()}_${(destino || '').trim().toUpperCase()}`;
}

// Convierte un monto de una moneda a otra usando las tasas guardadas en
// Configuración (tasasCache). Prueba el par directo en ambos sentidos y, si
// no existe, intenta un puente pasando por CLP (la moneda base del negocio).
// Devuelve null si no hay ninguna tasa configurada que permita el cálculo.
export function convertirMoneda(monto, desde, hacia) {
    if (desde === hacia) return monto;

    const tasaInversa = tasasCache[claveTasa(hacia, desde)]; // 1 hacia = X desde
    if (tasaInversa) return monto / tasaInversa;

    const tasaDirecta = tasasCache[claveTasa(desde, hacia)]; // 1 desde = X hacia
    if (tasaDirecta) return monto * tasaDirecta;

    if (desde !== 'CLP' && hacia !== 'CLP') {
        const enClp = convertirMoneda(monto, desde, 'CLP');
        if (enClp !== null) return convertirMoneda(enClp, 'CLP', hacia);
    }
    return null;
}

// Consulta (y cachea por sesión) las tasas en vivo de una moneda base
// usando el endpoint abierto y gratuito de ExchangeRate-API.
export async function obtenerTasaEnVivo(origen, destino) {
    if (!liveRatesCache[origen]) {
        if (!liveRateFetchInFlight[origen]) {
            liveRateFetchInFlight[origen] = fetch(`https://open.er-api.com/v6/latest/${origen}`)
                .then(res => res.json())
                .then(json => {
                    if (json.result === 'success' && json.rates) {
                        liveRatesCache[origen] = json.rates;
                        return json.rates;
                    }
                    throw new Error('Respuesta inválida de la API de tasas');
                })
                .finally(() => { delete liveRateFetchInFlight[origen]; });
        }
        await liveRateFetchInFlight[origen];
    }
    const rates = liveRatesCache[origen];
    return rates ? rates[destino] : undefined;
}

// ============================================
// CONFIGURACIÓN DE TASAS — CRUD manual
// ============================================
const tasaForm = document.getElementById('tasaForm');
const tasaDocIdInput = document.getElementById('tasaDocId');
const tasaMonedaOrigenInput = document.getElementById('tasaMonedaOrigen');
const tasaMonedaDestinoInput = document.getElementById('tasaMonedaDestino');
const tasaValorInput = document.getElementById('tasaValor');
const tasaSubmitBtn = document.getElementById('tasaSubmitBtn');
const tasaCancelBtn = document.getElementById('tasaCancelBtn');
const tasaLiveBtn = document.getElementById('tasaLiveBtn');
const tasaMessage = document.getElementById('tasaMessage');
const tasasBody = document.getElementById('tasasBody');
const tasasEmpty = document.getElementById('tasasEmpty');
const tasasTableWrap = document.querySelector('#config .table-wrap');

function formatTasaFecha(timestamp) {
    if (!timestamp || !timestamp.toDate) return '—';
    return timestamp.toDate().toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function resetTasaForm() {
    tasaForm.reset();
    tasaDocIdInput.value = '';
    tasaSubmitBtn.querySelector('.btn-text').textContent = 'Guardar tasa';
    tasaCancelBtn.classList.add('hidden');
    tasaMessage.textContent = '';
    tasaMessage.className = 'form-message';
}

function renderTasaRow(docId, data) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${escapeHtml(data.monedaOrigen)}</td>
        <td>${escapeHtml(data.monedaDestino)}</td>
        <td class="mono-cell">${data.tasa}</td>
        <td class="mono-cell">${data.tasaMercado != null ? data.tasaMercado : '—'}</td>
        <td>${formatTasaFecha(data.actualizadoEn)}</td>
        <td>
            <button type="button" class="btn-icon-action" onclick="compartirTasaImagen('${docId}')"><i class="ti ti-share-2" aria-hidden="true"></i> Compartir</button>
            <button type="button" class="btn-icon-action" onclick="editarTasa('${docId}')"><i class="ti ti-pencil" aria-hidden="true"></i> Editar</button>
            <button type="button" class="btn-icon-action danger" onclick="eliminarTasa('${docId}')"><i class="ti ti-trash" aria-hidden="true"></i> Eliminar</button>
        </td>
    `;
    return tr;
}

window.editarTasa = (docId) => {
    const data = tasasCache[`__doc_${docId}`];
    if (!data) return;

    const tasaMercadoValorInput = document.getElementById('tasaMercadoValor');
    tasaDocIdInput.value = docId;
    tasaMonedaOrigenInput.value = data.monedaOrigen;
    tasaMonedaDestinoInput.value = data.monedaDestino;
    tasaValorInput.value = data.tasa;
    if (tasaMercadoValorInput) tasaMercadoValorInput.value = data.tasaMercado != null ? data.tasaMercado : '';
    tasaSubmitBtn.querySelector('.btn-text').textContent = 'Actualizar tasa';
    tasaCancelBtn.classList.remove('hidden');
    tasaMessage.textContent = '';
    tasaMessage.className = 'form-message';
    tasaMonedaOrigenInput.focus();
};

window.eliminarTasa = async (docId) => {
    if (!confirm('¿Eliminar esta tasa de cambio?')) return;
    const tasaEliminada = tasasCache[`__doc_${docId}`] || null;
    try {
        await db.collection('tasasCambio').doc(docId).delete();
        registrarAuditoria('tasa', 'eliminar', {
            par: tasaEliminada ? `${tasaEliminada.monedaOrigen}/${tasaEliminada.monedaDestino}` : docId,
            tasa: tasaEliminada ? tasaEliminada.tasa : null
        });
    } catch (error) {
        console.error('Error al eliminar tasa de cambio:', error);
        alert('No se pudo eliminar la tasa. Intenta de nuevo.');
    }
};

// Inicializa el formulario de Configuración de tasas y la escucha en
// tiempo real de la colección tasasCambio. Se llama una sola vez desde
// app.js al arrancar.
export function initTasas() {
    tasaCancelBtn.addEventListener('click', resetTasaForm);

    tasaLiveBtn.addEventListener('click', async () => {
        const origen = tasaMonedaOrigenInput.value.trim().toUpperCase();
        const destino = tasaMonedaDestinoInput.value.trim().toUpperCase();

        if (!origen || !destino) {
            tasaMessage.textContent = 'Ingresa la moneda de origen y destino primero.';
            tasaMessage.className = 'form-message form-message-error';
            return;
        }

        tasaLiveBtn.disabled = true;
        const textoOriginal = tasaLiveBtn.textContent;
        tasaLiveBtn.textContent = 'Buscando...';

        try {
            const tasaViva = await obtenerTasaEnVivo(origen, destino);
            if (tasaViva !== undefined) {
                tasaValorInput.value = Number(tasaViva.toFixed(6));
                tasaMessage.textContent = `Tasa en vivo cargada: 1 ${origen} = ${tasaViva.toFixed(4)} ${destino}. Revísala y guárdala si te parece correcta.`;
                tasaMessage.className = 'form-message form-message-success';
            } else {
                tasaMessage.textContent = `No se encontró una tasa en vivo para ${origen} → ${destino}.`;
                tasaMessage.className = 'form-message form-message-error';
            }
        } catch (error) {
            console.error('Error obteniendo tasa en vivo:', error);
            tasaMessage.textContent = 'No se pudo obtener la tasa en vivo. Intenta de nuevo.';
            tasaMessage.className = 'form-message form-message-error';
        } finally {
            tasaLiveBtn.disabled = false;
            tasaLiveBtn.textContent = textoOriginal;
        }
    });

    tasaForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const origen = tasaMonedaOrigenInput.value.trim().toUpperCase();
        const destino = tasaMonedaDestinoInput.value.trim().toUpperCase();
        const tasa = parseFloat(tasaValorInput.value);
        const tasaMercadoValorInput = document.getElementById('tasaMercadoValor');
        const tasaMercadoRaw = tasaMercadoValorInput ? parseFloat(tasaMercadoValorInput.value) : NaN;
        const tasaMercado = isNaN(tasaMercadoRaw) ? null : tasaMercadoRaw;
        const docId = claveTasa(origen, destino);
        const tasaAnterior = tasasCache[`__doc_${docId}`] || null;
        const esEdicion = !!tasaAnterior;

        tasaSubmitBtn.disabled = true;
        tasaSubmitBtn.querySelector('.btn-text').textContent = 'Guardando...';
        tasaSubmitBtn.querySelector('.spinner').classList.remove('hidden');
        tasaMessage.textContent = '';
        tasaMessage.className = 'form-message';

        try {
            await db.collection('tasasCambio').doc(docId).set({
                monedaOrigen: origen,
                monedaDestino: destino,
                tasa,
                tasaMercado,
                actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(),
                actualizadoPor: auth.currentUser ? auth.currentUser.email : null
            }, { merge: true });

            registrarAuditoria('tasa', esEdicion ? 'editar' : 'crear', {
                par: `${origen}/${destino}`,
                tasaAnterior: tasaAnterior ? tasaAnterior.tasa : null,
                tasaNueva: tasa,
                tasaMercadoAnterior: tasaAnterior ? tasaAnterior.tasaMercado : null,
                tasaMercadoNueva: tasaMercado
            });

            resetTasaForm();
            tasaMessage.textContent = 'Tasa guardada correctamente.';
            tasaMessage.className = 'form-message form-message-success';
        } catch (error) {
            console.error('Error al guardar tasa de cambio:', error);
            tasaMessage.textContent = 'No se pudo guardar la tasa. Intenta de nuevo.';
            tasaMessage.className = 'form-message form-message-error';
        } finally {
            tasaSubmitBtn.disabled = false;
            tasaSubmitBtn.querySelector('.spinner').classList.add('hidden');
        }
    });

    db.collection('tasasCambio').orderBy('monedaOrigen').onSnapshot(snapshot => {
        // Reconstruir la caché usada para el autocompletado en Nueva Remesa
        tasasCache = {};
        tasasMercadoCache = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            const clave = claveTasa(data.monedaOrigen, data.monedaDestino);
            tasasCache[clave] = data.tasa;
            if (data.tasaMercado != null) tasasMercadoCache[clave] = data.tasaMercado;
            tasasCache[`__doc_${doc.id}`] = data;
        });

        // Re-evaluar el autocompletado por si el par actual ya tiene tasa
        intentarAutocompletarTasa();

        // Renderizar tabla de Configuración
        tasasBody.innerHTML = '';
        if (snapshot.empty) {
            tasasEmpty.style.display = 'block';
            tasasTableWrap.style.display = 'none';
        } else {
            tasasEmpty.style.display = 'none';
            tasasTableWrap.style.display = 'block';
            snapshot.forEach(doc => {
                tasasBody.appendChild(renderTasaRow(doc.id, doc.data()));
            });
        }

        actualizarDashboardEjecutivo();
    }, error => {
        console.error('Error escuchando tasas de cambio:', error);
    });

    initCompartirTasaImagen();
}

const ESLOGAN_TASA = 'Tu dinero, más cerca de casa';

// Dibuja UN cuadro de la escena (se usa tanto para el video animado como
// para la imagen estática de respaldo). "t" va de 0 a 1 y controla el
// parpadeo de las luces del puente — el puente es una ilustración propia
// estilizada (torres, cables y luces), no una foto real.
function dibujarFrameTasa(ctx, data, t, slogan) {
    const W = 1080, H = 1080, cx = W / 2;
    ctx.clearRect(0, 0, W, H);

    // Cielo nocturno degradado
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#081625');
    grad.addColorStop(0.55, '#123258');
    grad.addColorStop(1, '#1d4e89');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Luna con resplandor suave
    const moonX = W - 190, moonY = 150;
    const moonGlow = ctx.createRadialGradient(moonX, moonY, 10, moonX, moonY, 110);
    moonGlow.addColorStop(0, 'rgba(255,247,222,0.35)');
    moonGlow.addColorStop(1, 'rgba(255,247,222,0)');
    ctx.fillStyle = moonGlow;
    ctx.fillRect(moonX - 110, moonY - 110, 220, 220);
    ctx.fillStyle = 'rgba(255,251,235,0.92)';
    ctx.beginPath();
    ctx.arc(moonX, moonY, 34, 0, Math.PI * 2);
    ctx.fill();

    // Estrellas sutiles, titilando
    for (let i = 0; i < 36; i++) {
        const sx = (i * 137) % W;
        const sy = (i * 89) % 360;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 * Math.PI + i));
        ctx.globalAlpha = tw * 0.6;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';

    const conSombra = (dibujar) => {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 14;
        ctx.shadowOffsetY = 3;
        dibujar();
        ctx.restore();
    };

    // Marca
    ctx.fillStyle = '#e8b84b';
    ctx.fillRect(cx - 36, 78, 72, 4);
    conSombra(() => {
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 54px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText('Lagomarcambios', cx, 158);
    });

    // Tarjeta con la tasa
    const cardX = 90, cardY = 200, cardW = W - 180, cardH = 330;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 26);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 26);
    ctx.stroke();
    // brillo sutil en el borde superior de la tarjeta
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(cardX + 26, cardY + 1);
    ctx.lineTo(cardX + cardW - 26, cardY + 1);
    ctx.stroke();

    ctx.font = '500 42px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    const rutaTexto = `${data.monedaOrigen}  →  ${data.monedaDestino}`;
    ctx.fillText(rutaTexto, cx, cardY + 80);

    // Banderitas circulares junto al texto de la ruta (como en la pieza
    // gráfica original de Lagomarcambios), a los costados del texto
    const rutaAncho = ctx.measureText(rutaTexto).width;
    const dibujarBanderaChile = (bx, by, r) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bx - r, by - r, r * 2, r);
        ctx.fillStyle = '#d52b1e';
        ctx.fillRect(bx - r, by, r * 2, r);
        ctx.fillStyle = '#0039a6';
        ctx.fillRect(bx - r, by - r, r, r);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        const starR = r * 0.22;
        const sx = bx - r * 0.5, sy = by - r * 0.5;
        for (let i = 0; i < 5; i++) {
            const ang = -Math.PI / 2 + i * (Math.PI * 2 / 5);
            const angIn = ang + Math.PI / 5;
            ctx.lineTo(sx + Math.cos(ang) * starR, sy + Math.sin(ang) * starR);
            ctx.lineTo(sx + Math.cos(angIn) * starR * 0.42, sy + Math.sin(angIn) * starR * 0.42);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.stroke();
    };
    const dibujarBanderaVenezuela = (bx, by, r) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#ffcc00';
        ctx.fillRect(bx - r, by - r, r * 2, r * 2 / 3);
        ctx.fillStyle = '#00247d';
        ctx.fillRect(bx - r, by - r / 3, r * 2, r * 2 / 3);
        ctx.fillStyle = '#cf142b';
        ctx.fillRect(bx - r, by + r / 3, r * 2, r * 2 / 3);
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 7; i++) {
            const ang = -Math.PI * 0.55 + i * (Math.PI * 1.1 / 6);
            ctx.beginPath();
            ctx.arc(bx + Math.cos(ang) * r * 0.55, by + Math.sin(ang) * r * 0.15, r * 0.09, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.stroke();
    };
    dibujarBanderaChile(cx - rutaAncho / 2 - 34, cardY + 68, 15);
    dibujarBanderaVenezuela(cx + rutaAncho / 2 + 34, cardY + 68, 15);

    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + 70, cardY + 120);
    ctx.lineTo(cardX + cardW - 70, cardY + 120);
    ctx.stroke();

    conSombra(() => {
        ctx.fillStyle = '#f2c866';
        ctx.font = '700 104px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText(`${data.tasa}`, cx, cardY + 245);
    });

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '400 30px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(`${data.monedaDestino} por cada 1 ${data.monedaOrigen}`, cx, cardY + 295);

    // Eslogan, en el espacio entre la tarjeta y el puente
    if (slogan) {
        ctx.save();
        ctx.fillStyle = '#e8b84b';
        ctx.fillRect(cx - 3, cardY + cardH + 26, 6, 6);
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = 'italic 400 30px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText(slogan, cx, cardY + cardH + 74);
    }

    // --- Puente estilizado (ilustración propia, no una foto real) ---
    const deckY = 840, towerTopY = 630;
    const towerXs = [330, 750];
    const towerW = 26;

    // cubierta con leve brillo superior
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(50, deckY);
    ctx.lineTo(W - 50, deckY);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(50, deckY - 5);
    ctx.lineTo(W - 50, deckY - 5);
    ctx.stroke();

    const dibujarTorre = (tx, ti) => {
        // Cables con leve curvatura (más realista que una línea recta)
        for (let i = 0; i < 7; i++) {
            const anchorX = tx + (-150 + i * 50);
            const midX = tx + (anchorX - tx) * 0.55;
            const midY = towerTopY + (deckY - towerTopY) * 0.5 + 14;
            ctx.strokeStyle = 'rgba(255,255,255,0.22)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(tx, towerTopY + 24);
            ctx.quadraticCurveTo(midX, midY, anchorX, deckY);
            ctx.stroke();
        }

        // Torre ligeramente ahusada, con remate
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.moveTo(tx - towerW / 2, deckY);
        ctx.lineTo(tx - towerW / 2 + 4, towerTopY + 16);
        ctx.lineTo(tx, towerTopY);
        ctx.lineTo(tx + towerW / 2 - 4, towerTopY + 16);
        ctx.lineTo(tx + towerW / 2, deckY);
        ctx.closePath();
        ctx.fill();

        // Luz de remate, parpadeando
        const glow = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 1.3 + ti * 2);
        ctx.fillStyle = `rgba(242,200,102,${0.55 + 0.45 * glow})`;
        ctx.beginPath();
        ctx.arc(tx, towerTopY - 6, 9, 0, Math.PI * 2);
        ctx.fill();
    };
    towerXs.forEach(dibujarTorre);

    // Luces de la cubierta, parpadeando en cadena
    for (let i = 0; i < 16; i++) {
        const lx = 70 + i * ((W - 140) / 15);
        const glow = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 * Math.PI * 0.9 + i * 0.5));
        ctx.fillStyle = `rgba(242,200,102,${glow})`;
        ctx.beginPath();
        ctx.arc(lx, deckY + 3, 3.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // Reflejo suave de la luna en el agua, como una franja de brillo vertical
    ctx.save();
    const moonReflect = ctx.createLinearGradient(0, deckY + 10, 0, H - 130);
    moonReflect.addColorStop(0, 'rgba(255,247,222,0.16)');
    moonReflect.addColorStop(1, 'rgba(255,247,222,0)');
    ctx.fillStyle = moonReflect;
    ctx.beginPath();
    ctx.moveTo(moonX - 60, deckY + 10);
    ctx.lineTo(moonX + 60, deckY + 10);
    ctx.lineTo(moonX + 18, H - 130);
    ctx.lineTo(moonX - 18, H - 130);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Reflejo tenue de las torres y luces en el agua
    ctx.save();
    ctx.translate(0, deckY * 2);
    ctx.scale(1, -1);
    ctx.globalAlpha = 0.15;
    towerXs.forEach(tx => {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(tx - towerW / 2, deckY);
        ctx.lineTo(tx - towerW / 2 + 4, towerTopY + 16);
        ctx.lineTo(tx, towerTopY);
        ctx.lineTo(tx + towerW / 2 - 4, towerTopY + 16);
        ctx.lineTo(tx + towerW / 2, deckY);
        ctx.closePath();
        ctx.fill();
    });
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 16; i++) {
        const lx = 70 + i * ((W - 140) / 15);
        ctx.fillStyle = '#f2c866';
        ctx.beginPath();
        ctx.arc(lx, deckY + 3, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();

    // Degradado oscuro abajo para que la fecha se lea bien
    const bottomGrad = ctx.createLinearGradient(0, H - 205, 0, H);
    bottomGrad.addColorStop(0, 'rgba(8,15,25,0)');
    bottomGrad.addColorStop(1, 'rgba(8,15,25,0.68)');
    ctx.fillStyle = bottomGrad;
    ctx.fillRect(0, H - 205, W, 205);

    const fecha = data.actualizadoEn && data.actualizadoEn.toDate
        ? data.actualizadoEn.toDate().toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })
        : new Date().toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });

    // Aviso "tasa sujeta a cambios", como una pequeña píldora
    ctx.font = '500 22px "Helvetica Neue", Arial, sans-serif';
    const avisoTexto = 'Tasa sujeta a cambios';
    const avisoAncho = ctx.measureText(avisoTexto).width;
    const avisoY = H - 148;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.roundRect(cx - avisoAncho / 2 - 18, avisoY - 22, avisoAncho + 36, 36, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(cx - avisoAncho / 2 - 18, avisoY - 22, avisoAncho + 36, 36, 18);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(avisoTexto, cx, avisoY + 3);

    // Línea de confianza: bancos y métodos receptores (en dos líneas, ya
    // que la lista es más larga)
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '400 21px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('Banesco · Mercantil · BNC · Banco de Venezuela', cx, H - 100);
    ctx.fillText('Provincial · Pago Móvil', cx, H - 74);

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '400 26px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(`Actualizado el ${fecha}`, cx, H - 36);

    // Marco sutil general para un acabado más cuidado
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, W - 20, H - 20);
}

// Imagen estática (respaldo si el navegador no puede grabar video)
function dibujarImagenTasa(data) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1080;
    dibujarFrameTasa(canvas.getContext('2d'), data, 0.25, ESLOGAN_TASA);
    return canvas;
}

const tasaPreviewOverlay = document.getElementById('tasaPreviewOverlay');
const tasaPreviewImg = document.getElementById('tasaPreviewImg');
const tasaPreviewCerrarBtn = document.getElementById('tasaPreviewCerrarBtn');
const tasaPreviewCompartirBtn = document.getElementById('tasaPreviewCompartirBtn');
const tasaPreviewDescargarBtn = document.getElementById('tasaPreviewDescargarBtn');
let tasaPreviewBlob = null;
let tasaPreviewNombreArchivo = '';

function cerrarPreviewTasa() {
    tasaPreviewOverlay.classList.add('hidden');
    if (tasaPreviewImg.src) URL.revokeObjectURL(tasaPreviewImg.src);
    tasaPreviewImg.src = '';
    tasaPreviewBlob = null;
}

window.compartirTasaImagen = async (docId) => {
    const data = tasasCache[`__doc_${docId}`];
    if (!data) {
        alert('No se encontró esa tasa. Recarga la página e intenta de nuevo.');
        return;
    }

    const canvas = dibujarImagenTasa(data);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
        alert('No se pudo generar la imagen. Intenta de nuevo.');
        return;
    }

    tasaPreviewBlob = blob;
    tasaPreviewNombreArchivo = `tasa-${data.monedaOrigen}-${data.monedaDestino}.png`;
    tasaPreviewImg.src = URL.createObjectURL(blob);
    tasaPreviewOverlay.classList.remove('hidden');
};


function initCompartirTasaImagen() {
    tasaPreviewCerrarBtn.addEventListener('click', cerrarPreviewTasa);
    tasaPreviewOverlay.addEventListener('click', (e) => {
        if (e.target === tasaPreviewOverlay) cerrarPreviewTasa();
    });
    
    tasaPreviewDescargarBtn.addEventListener('click', () => {
        if (!tasaPreviewBlob) return;
        const url = URL.createObjectURL(tasaPreviewBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = tasaPreviewNombreArchivo;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    });
    
    tasaPreviewCompartirBtn.addEventListener('click', async () => {
        if (!tasaPreviewBlob) return;
        const file = new File([tasaPreviewBlob], tasaPreviewNombreArchivo, { type: 'image/png' });
    
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: 'Tasa de cambio' });
                cerrarPreviewTasa();
                return;
            } catch (error) {
                if (error && error.name === 'AbortError') return; // el usuario canceló el share
                console.error('Error al compartir la imagen:', error);
            }
        }
        // Si no hay soporte para compartir archivos, se descarga en su lugar
        alert('Tu navegador no puede abrir el selector de compartir. Se descargará la imagen para que la envíes manualmente.');
        tasaPreviewDescargarBtn.click();
    });
}
