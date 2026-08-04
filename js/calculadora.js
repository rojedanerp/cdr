// ============================================
// CALCULADORA — script independiente, SIN dependencia de Firebase.
// Se carga aparte para que funcione siempre, incluso si Firebase
// tarda o falla en cargar (red lenta, bloqueador, etc.).
// ============================================

// ============================================
// PANELES COLAPSABLES — cada una de las 3 calculadoras se puede
// minimizar para no ocupar tanto espacio. El estado (abierta/cerrada)
// de cada una se recuerda en localStorage.
// ============================================
const CALC_PANEL_STORAGE_KEY = 'calcPanelesAbiertos';

function leerEstadoPaneles() {
    try {
        return JSON.parse(localStorage.getItem(CALC_PANEL_STORAGE_KEY)) || {};
    } catch (error) {
        return {};
    }
}

function guardarEstadoPanel(prefix, abierto) {
    const estado = leerEstadoPaneles();
    estado[prefix] = abierto;
    try {
        localStorage.setItem(CALC_PANEL_STORAGE_KEY, JSON.stringify(estado));
    } catch (error) {
        // localStorage no disponible (modo privado, etc.) — no es crítico.
    }
}

// prefix: 'calcConv', 'calcCruzada' o 'calcUsdt' → usa los ids
// {prefix}Panel y {prefix}Toggle. abiertoPorDefecto solo se usa
// la primera vez, antes de que exista una preferencia guardada.
function initCalcPanelToggle(prefix, abiertoPorDefecto) {
    const panel = document.getElementById(`${prefix}Panel`);
    const toggle = document.getElementById(`${prefix}Toggle`);
    if (!panel || !toggle) return;

    const estadoGuardado = leerEstadoPaneles()[prefix];
    const abierto = estadoGuardado !== undefined ? estadoGuardado : abiertoPorDefecto;
    panel.classList.toggle('abierto', abierto);
    toggle.setAttribute('aria-expanded', abierto ? 'true' : 'false');

    toggle.addEventListener('click', () => {
        const ahoraAbierto = panel.classList.toggle('abierto');
        toggle.setAttribute('aria-expanded', ahoraAbierto ? 'true' : 'false');
        guardarEstadoPanel(prefix, ahoraAbierto);
    });
}

// Por defecto solo la "Conversión rápida" queda abierta al entrar a la
// sección; las otras dos empiezan minimizadas para ahorrar espacio.
initCalcPanelToggle('calcConv', true);
initCalcPanelToggle('calcCruzada', false);
initCalcPanelToggle('calcUsdt', false);

// ============================================
// CALCULADORA DE TASAS — tasa cruzada a partir del valor de cada moneda vs USD
// ============================================
const calcOrigenCodigoInput = document.getElementById('calcOrigenCodigo');
const calcOrigenValorInput = document.getElementById('calcOrigenValor');
const calcDestinoCodigoInput = document.getElementById('calcDestinoCodigo');
const calcDestinoValorInput = document.getElementById('calcDestinoValor');
const calcMargenInput = document.getElementById('calcMargen');
const calcResultLabel = document.getElementById('calcResultLabel');
const calcResultValue = document.getElementById('calcResultValue');
const calcResultValueMercado = document.getElementById('calcResultValueMercado');
const calcGuardarBtn = document.getElementById('calcGuardarBtn');

let calcTasaResultado = null;      // tasa final, ya con el margen descontado (la que se ofrece/guarda)
let calcTasaMercado = null;        // tasa cruzada cruda, sin margen

// Si la moneda de origen o destino es USD o USDT, su "valor de 1 USD en esa
// moneda" es siempre 1 por definición — se autocompleta y se bloquea para
// que no haya que escribirlo cada vez que se usa esta calculadora para
// sacar una tasa contra USDT (compra/venta de cripto).
function actualizarAutoUSD(codigoInput, valorInput) {
    const codigo = codigoInput.value.trim().toUpperCase();
    const esDolar = codigo === 'USD' || codigo === 'USDT';
    valorInput.readOnly = esDolar;
    valorInput.classList.toggle('input-readonly', esDolar);
    if (esDolar) {
        valorInput.value = '1';
    }
}

function recalcularTasaCruzada() {
    actualizarAutoUSD(calcOrigenCodigoInput, calcOrigenValorInput);
    actualizarAutoUSD(calcDestinoCodigoInput, calcDestinoValorInput);

    const origenCodigo = calcOrigenCodigoInput.value.trim().toUpperCase();
    const destinoCodigo = calcDestinoCodigoInput.value.trim().toUpperCase();
    const origenValor = parseFloat(calcOrigenValorInput.value);
    const destinoValor = parseFloat(calcDestinoValorInput.value);
    const margen = parseFloat(calcMargenInput.value) || 0;

    if (!origenValor || !destinoValor || origenValor <= 0) {
        calcTasaResultado = null;
        calcTasaMercado = null;
        calcResultLabel.textContent = 'Tasa a ofrecer (con margen descontado)';
        calcResultValue.textContent = '—';
        calcResultValueMercado.textContent = '—';
        calcGuardarBtn.disabled = true;
        return;
    }

    calcTasaMercado = destinoValor / origenValor;
    calcTasaResultado = calcTasaMercado * (1 - margen / 100);

    const origenTxt = origenCodigo || 'ORIGEN';
    const destinoTxt = destinoCodigo || 'DESTINO';

    calcResultValueMercado.textContent = calcTasaMercado.toFixed(6);
    calcResultLabel.textContent = `1 ${origenTxt} = ${calcTasaResultado.toFixed(6)} ${destinoTxt} (margen ${margen}%)`;
    calcResultValue.textContent = calcTasaResultado.toFixed(3);
    calcGuardarBtn.disabled = !(origenCodigo && destinoCodigo);
}

[calcOrigenCodigoInput, calcOrigenValorInput, calcDestinoCodigoInput, calcDestinoValorInput, calcMargenInput].forEach(el => {
    el.addEventListener('input', recalcularTasaCruzada);
});

calcGuardarBtn.addEventListener('click', () => {
    if (calcTasaResultado === null) return;

    const tasaMonedaOrigenInput = document.getElementById('tasaMonedaOrigen');
    const tasaMonedaDestinoInput = document.getElementById('tasaMonedaDestino');
    const tasaValorInput = document.getElementById('tasaValor');
    const tasaMercadoValorInput = document.getElementById('tasaMercadoValor');

    tasaMonedaOrigenInput.value = calcOrigenCodigoInput.value.trim().toUpperCase();
    tasaMonedaDestinoInput.value = calcDestinoCodigoInput.value.trim().toUpperCase();
    tasaValorInput.value = Number(calcTasaResultado.toFixed(6));
    // Se guarda también la tasa de mercado (sin margen) para que el reporte
    // de ganancia pueda comparar contra el costo real, no contra la tasa ya con margen.
    if (tasaMercadoValorInput && calcTasaMercado !== null) {
        tasaMercadoValorInput.value = Number(calcTasaMercado.toFixed(6));
    }

    document.querySelector('.nav-links li[data-section="config"]').click();
    tasaMonedaOrigenInput.focus();
});

// --- Compra y venta de USDT ---
const calcUsdtMonedaInput = document.getElementById('calcUsdtMoneda');
const calcUsdtValorMercadoInput = document.getElementById('calcUsdtValorMercado');
const calcUsdtMargenCompraInput = document.getElementById('calcUsdtMargenCompra');
const calcUsdtMargenVentaInput = document.getElementById('calcUsdtMargenVenta');
const calcUsdtMontoInput = document.getElementById('calcUsdtMonto');
const calcUsdtCompraLabel = document.getElementById('calcUsdtCompraLabel');
const calcUsdtCompraValue = document.getElementById('calcUsdtCompraValue');
const calcUsdtVentaLabel = document.getElementById('calcUsdtVentaLabel');
const calcUsdtVentaValue = document.getElementById('calcUsdtVentaValue');
const calcUsdtCompraMontoLabel = document.getElementById('calcUsdtCompraMontoLabel');
const calcUsdtCompraMontoValue = document.getElementById('calcUsdtCompraMontoValue');
const calcUsdtVentaMontoLabel = document.getElementById('calcUsdtVentaMontoLabel');
const calcUsdtVentaMontoValue = document.getElementById('calcUsdtVentaMontoValue');

function recalcularCompraVentaUSDT() {
    const moneda = calcUsdtMonedaInput.value.trim().toUpperCase() || 'MONEDA';
    const valorMercado = parseFloat(calcUsdtValorMercadoInput.value);
    const margenCompra = parseFloat(calcUsdtMargenCompraInput.value) || 0;
    const margenVenta = parseFloat(calcUsdtMargenVentaInput.value) || 0;
    const monto = parseFloat(calcUsdtMontoInput.value);

    if (!valorMercado || valorMercado <= 0) {
        calcUsdtCompraValue.textContent = '—';
        calcUsdtVentaValue.textContent = '—';
        calcUsdtCompraMontoValue.textContent = '—';
        calcUsdtVentaMontoValue.textContent = '—';
        calcUsdtCompraLabel.textContent = 'Tasa de compra (pagas por cada USDT que te venden)';
        calcUsdtVentaLabel.textContent = 'Tasa de venta (cobras por cada USDT que vendes)';
        calcUsdtCompraMontoLabel.textContent = 'USDT que recibes al comprar con ese monto';
        calcUsdtVentaMontoLabel.textContent = 'USDT que entregas al vender por ese monto';
        return;
    }

    // Compras USDT más barato que el mercado, vendes USDT más caro que el mercado — ahí está tu margen.
    const tasaCompra = valorMercado * (1 - margenCompra / 100);
    const tasaVenta = valorMercado * (1 + margenVenta / 100);

    calcUsdtCompraLabel.textContent = `Pagas 1 USDT = ${tasaCompra.toFixed(2)} ${moneda} (compra, −${margenCompra}%)`;
    calcUsdtCompraValue.textContent = tasaCompra.toFixed(2);
    calcUsdtVentaLabel.textContent = `Cobras 1 USDT = ${tasaVenta.toFixed(2)} ${moneda} (venta, +${margenVenta}%)`;
    calcUsdtVentaValue.textContent = tasaVenta.toFixed(2);

    if (!monto || monto <= 0) {
        calcUsdtCompraMontoValue.textContent = '—';
        calcUsdtVentaMontoValue.textContent = '—';
        calcUsdtCompraMontoLabel.textContent = 'USDT que recibes al comprar con ese monto';
        calcUsdtVentaMontoLabel.textContent = 'USDT que entregas al vender por ese monto';
        return;
    }

    // Con ese monto en pesos: cuántos USDT te entrega el cliente (a la tasa de compra)
    // y cuántos USDT le entregas tú al cliente (a la tasa de venta).
    const usdtCompra = monto / tasaCompra;
    const usdtVenta = monto / tasaVenta;

    calcUsdtCompraMontoLabel.textContent = `Con ${monto.toLocaleString('es-CL')} ${moneda} compras ${usdtCompra.toFixed(2)} USDT`;
    calcUsdtCompraMontoValue.textContent = `${usdtCompra.toFixed(2)} USDT`;
    calcUsdtVentaMontoLabel.textContent = `Con ${monto.toLocaleString('es-CL')} ${moneda} vendes ${usdtVenta.toFixed(2)} USDT`;
    calcUsdtVentaMontoValue.textContent = `${usdtVenta.toFixed(2)} USDT`;
}

[calcUsdtMonedaInput, calcUsdtValorMercadoInput, calcUsdtMargenCompraInput, calcUsdtMargenVentaInput, calcUsdtMontoInput].forEach(el => {
    el.addEventListener('input', recalcularCompraVentaUSDT);
});

// ============================================
// CONVERSIÓN RÁPIDA — USD a Bolívares y Pesos
// Solo se editan "Cantidad" (USD) y "DolarVzla" (Bs. por 1 USD).
// Bolivares = Cantidad × DolarVzla
// Cambio    = Tasa ofrecida configurada para remesas del par CLP → VES
//             (colección "tasasCambio", doc "CLP_VES", campo "tasa").
//             Se escucha en tiempo real: si se actualiza la tasa desde
//             Configuración, esta celda se refresca sola.
// Pesos     = Bolivares ÷ Cambio
// ============================================
const convCantidadInput = document.getElementById('convCantidad');
const convDolarVzlaInput = document.getElementById('convDolarVzla');
const convCambioLabel = document.getElementById('convCambioLabel');
const convCambioValue = document.getElementById('convCambioValue');
const convBolivaresValue = document.getElementById('convBolivaresValue');
const convPesosValue = document.getElementById('convPesosValue');

let convCambioClpVes = null; // 1 CLP = X VES (tasa ofrecida remesas)

function formatEs(numero, decimales = 2) {
    return numero.toLocaleString('es-CL', {
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales
    });
}

// Guarda el último cálculo válido, para poder generar la imagen a compartir
// sin tener que recalcular todo de nuevo al momento de tocar "Compartir".
let convUltimoCalculo = null;

function recalcularConversionRapida() {
    const cantidad = parseFloat(convCantidadInput.value);
    const dolarVzla = parseFloat(convDolarVzlaInput.value);

    if (!cantidad || cantidad <= 0 || !dolarVzla || dolarVzla <= 0) {
        convBolivaresValue.textContent = '—';
        convPesosValue.textContent = '—';
        convUltimoCalculo = null;
        return;
    }

    const bolivares = cantidad * dolarVzla;
    convBolivaresValue.textContent = `Bs.${formatEs(bolivares)}`;

    if (convCambioClpVes) {
        const pesos = bolivares / convCambioClpVes;
        convPesosValue.textContent = `$${formatEs(pesos, 0)}`;
        convUltimoCalculo = { cantidad, dolarVzla, cambio: convCambioClpVes, bolivares, pesos };
    } else {
        convPesosValue.textContent = 'Obteniendo tasa ofrecida...';
        convUltimoCalculo = null;
    }
}

// La calculadora en general no depende de Firebase, pero esta celda
// puntual sí necesita leer la tasa ofrecida para remesas CLP → VES,
// así que esperamos a que Firebase esté inicializado (lo inicializa
// firebase-config.js al cargarse app.js) antes de suscribirnos.
function esperarFirebaseListo(maxIntentos = 100, intervaloMs = 100) {
    return new Promise((resolve, reject) => {
        let intentos = 0;
        const chequear = () => {
            if (window.firebase && firebase.apps && firebase.apps.length > 0) {
                resolve();
                return;
            }
            intentos++;
            if (intentos >= maxIntentos) {
                reject(new Error('Firebase no se inicializó a tiempo'));
                return;
            }
            setTimeout(chequear, intervaloMs);
        };
        chequear();
    });
}

async function suscribirseTasaOfrecidaClpVes() {
    try {
        await esperarFirebaseListo();
        const db = firebase.firestore();

        db.collection('tasasCambio').doc('CLP_VES').onSnapshot(
            (doc) => {
                const data = doc.data();
                if (doc.exists && data && typeof data.tasa === 'number') {
                    convCambioClpVes = data.tasa;
                    convCambioValue.textContent = formatEs(convCambioClpVes, 4);
                    convCambioLabel.textContent = 'Cambio (1 CLP = X VES, tasa ofrecida remesas)';
                } else {
                    convCambioClpVes = null;
                    convCambioValue.textContent = 'Sin configurar';
                    convCambioLabel.textContent = 'Cambio (no hay tasa ofrecida configurada para CLP → VES)';
                }
                recalcularConversionRapida();
            },
            (error) => {
                console.error('Error escuchando la tasa ofrecida CLP → VES:', error);
                convCambioClpVes = null;
                convCambioValue.textContent = 'Error';
                convCambioLabel.textContent = 'Cambio (no se pudo obtener la tasa ofrecida)';
                recalcularConversionRapida();
            }
        );
    } catch (error) {
        console.error('Error obteniendo la tasa ofrecida CLP → VES:', error);
        convCambioValue.textContent = 'Error';
        convCambioLabel.textContent = 'Cambio (no se pudo obtener la tasa ofrecida)';
        recalcularConversionRapida();
    }
}

[convCantidadInput, convDolarVzlaInput].forEach(el => {
    el.addEventListener('input', recalcularConversionRapida);
});

suscribirseTasaOfrecidaClpVes();

// Calcular de inmediato con los valores ya presentes al cargar la página
// (por si el navegador restauró valores de un formulario sin disparar 'input').
recalcularTasaCruzada();
recalcularCompraVentaUSDT();

// ============================================
// COMPARTIR / DESCARGAR "CONVERSIÓN RÁPIDA" COMO IMAGEN
// Genera una tarjeta similar a la que se usa para compartir la tasa,
// pero con el detalle completo de la conversión (monto en USD, tasa
// del dólar en Venezuela, tasa ofrecida CLP → VES, Bolívares y Pesos).
// ============================================
function dibujarImagenConversionRapida(datos) {
    const canvas = document.createElement('canvas');
    const W = 1080, H = 1080, cx = W / 2;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Fondo degradado, en línea con la identidad de Lagomarcambios
    const fondo = ctx.createLinearGradient(0, 0, 0, H);
    fondo.addColorStop(0, '#081625');
    fondo.addColorStop(0.55, '#123258');
    fondo.addColorStop(1, '#1d4e89');
    ctx.fillStyle = fondo;
    ctx.fillRect(0, 0, W, H);

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
    ctx.fillRect(cx - 36, 100, 72, 4);
    conSombra(() => {
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 54px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText('Lagomarcambios', cx, 180);
    });
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '400 30px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('Conversión rápida — USD a Bolívares y Pesos', cx, 224);

    // Tarjeta principal
    const cardX = 90, cardY = 280, cardW = W - 180, cardH = 560;
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

    // Filas con cada dato: [etiqueta, valor, destacado]
    const filas = [
        ['Cantidad (USD)', `US$${formatEs(datos.cantidad)}`, false],
        ['Dólar Venezuela (Bs. por 1 USD)', `Bs.${formatEs(datos.dolarVzla)}`, false],
        ['Tasa ofrecida CLP → VES', formatEs(datos.cambio, 4), false],
        ['Bolívares', `Bs.${formatEs(datos.bolivares)}`, false],
        ['Pesos (CLP)', `$${formatEs(datos.pesos, 0)}`, true],
    ];

    let filaY = cardY + 90;
    const filaAltura = (cardH - 100) / filas.length;
    filas.forEach(([label, valor, destacado], i) => {
        ctx.textAlign = 'left';
        ctx.font = '400 28px "Helvetica Neue", Arial, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.fillText(label, cardX + 50, filaY);

        ctx.textAlign = 'right';
        conSombra(() => {
            ctx.fillStyle = destacado ? '#f2c866' : '#ffffff';
            ctx.font = `700 ${destacado ? 52 : 40}px "Helvetica Neue", Arial, sans-serif`;
            ctx.fillText(valor, cardX + cardW - 50, filaY + (destacado ? 6 : 0));
        });

        if (i < filas.length - 1) {
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cardX + 50, filaY + filaAltura - 34);
            ctx.lineTo(cardX + cardW - 50, filaY + filaAltura - 34);
            ctx.stroke();
        }
        filaY += filaAltura;
    });

    // Aviso "tasa sujeta a cambios"
    ctx.textAlign = 'center';
    ctx.font = '500 22px "Helvetica Neue", Arial, sans-serif';
    const avisoTexto = 'Tasa sujeta a cambios';
    const avisoAncho = ctx.measureText(avisoTexto).width;
    const avisoY = cardY + cardH + 70;
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

    // Fecha
    const fecha = new Date().toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '400 26px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(`Actualizado el ${fecha}`, cx, avisoY + 60);

    // Marco sutil
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, W - 20, H - 20);

    return canvas;
}

const convCompartirBtn = document.getElementById('convCompartirBtn');
const convPreviewOverlay = document.getElementById('convPreviewOverlay');
const convPreviewImg = document.getElementById('convPreviewImg');
const convPreviewCerrarBtn = document.getElementById('convPreviewCerrarBtn');
const convPreviewCompartirBtn = document.getElementById('convPreviewCompartirBtn');
const convPreviewDescargarBtn = document.getElementById('convPreviewDescargarBtn');
let convPreviewBlob = null;
const convPreviewNombreArchivo = 'conversion-rapida-lagomarcambios.png';

function cerrarPreviewConversion() {
    convPreviewOverlay.classList.add('hidden');
    if (convPreviewImg.src) URL.revokeObjectURL(convPreviewImg.src);
    convPreviewImg.src = '';
    convPreviewBlob = null;
}
convPreviewCerrarBtn.addEventListener('click', cerrarPreviewConversion);
convPreviewOverlay.addEventListener('click', (e) => {
    if (e.target === convPreviewOverlay) cerrarPreviewConversion();
});

convPreviewDescargarBtn.addEventListener('click', () => {
    if (!convPreviewBlob) return;
    const url = URL.createObjectURL(convPreviewBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = convPreviewNombreArchivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
});

convPreviewCompartirBtn.addEventListener('click', async () => {
    if (!convPreviewBlob) return;
    const file = new File([convPreviewBlob], convPreviewNombreArchivo, { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: 'Conversión rápida' });
            cerrarPreviewConversion();
            return;
        } catch (error) {
            if (error && error.name === 'AbortError') return; // el usuario canceló el share
            console.error('Error al compartir la imagen de conversión:', error);
        }
    }
    // Si no hay soporte para compartir archivos, se descarga en su lugar
    alert('Tu navegador no puede abrir el selector de compartir. Se descargará la imagen para que la envíes manualmente.');
    convPreviewDescargarBtn.click();
});

convCompartirBtn.addEventListener('click', async () => {
    if (!convUltimoCalculo) {
        alert('Completa Cantidad y DolarVzla, y espera a que cargue la tasa ofrecida, antes de generar la imagen.');
        return;
    }

    const canvas = dibujarImagenConversionRapida(convUltimoCalculo);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
        alert('No se pudo generar la imagen. Intenta de nuevo.');
        return;
    }

    convPreviewBlob = blob;
    convPreviewImg.src = URL.createObjectURL(blob);
    convPreviewOverlay.classList.remove('hidden');
});
