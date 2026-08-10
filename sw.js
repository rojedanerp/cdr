// ============================================
// SERVICE WORKER — Lagomarcambios
// Objetivo: habilitar la instalación como app
// (PWA) y dar un cache mínimo del "cascarón"
// de la app. Los datos reales (remesas, caja,
// etc.) siguen viajando por Firestore, que ya
// maneja su propia persistencia offline.
//
// Estrategia: network-first para HTML/CSS/JS
// (así nunca se queda pegada una versión vieja
// mientras haya internet) y cache como respaldo
// solo si no hay conexión.
// ============================================

const CACHE_NAME = 'lagomarcambios-shell-v1';
const APP_SHELL = [
    './',
    'index.html',
    'app.html',
    'css/styles.css',
    'js/app.js',
    'js/calculadora.js',
    'js/firebase-config.js',
    'img/favicon.svg',
    'manifest.json'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(nombres =>
            Promise.all(
                nombres
                    .filter(nombre => nombre !== CACHE_NAME)
                    .map(nombre => caches.delete(nombre))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    // Solo interceptamos peticiones GET del propio origen (nuestro cascarón).
    // Todo lo demás (Firestore, Auth, CDNs de fuentes/librerías) pasa directo
    // a la red sin tocar el cache, para no interferir con esos servicios.
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then(respuesta => {
                const copia = respuesta.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, copia));
                return respuesta;
            })
            .catch(() => caches.match(event.request))
    );
});
