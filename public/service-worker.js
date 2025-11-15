self.addEventListener('install', function(event) {
    event.waitUntil(
      caches.open('v1').then(function(cache) {
        return cache.addAll([
          '/',
          '/index.html',
          '/style.css',
          '/icons/icon192.png',
          '/icons/icon512.png'
        ]);
      })
    );
  });
  
  self.addEventListener('fetch', function(event) {
    event.respondWith(
      caches.match(event.request).then(function(response) {
        return response || fetch(event.request);
      })
    );
  });

// Mise à jour du service worker lors de l'ajout d'une tâche
self.addEventListener('message', function(event) {
  if (event.data.action === 'updateBadge') {
    // Logique pour obtenir le nombre de tâches non lues
    const numberOfTasks = 5; // Exemple : récupère ce nombre via ta logique

    // Envoie du message au client pour mettre à jour le badge
    event.ports[0].postMessage({ action: 'setBadge', count: numberOfTasks });
  }
});

self.addEventListener('push', function(event) {
  var options = {
    body: event.data ? event.data.text() : 'Notification par défaut',
    icon: '/assets/icon192.png',
    badge: '/assets/badge.png',  // Fichier badge dynamique
    vibrate: [200, 100, 200],
    tag: 'task-notification',
    actions: [
      {
        action: 'explore',
        title: 'Voir les tâches',
        icon: '/assets/icon192.png'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('Nouvelle Tâche', options)
  );
});
  