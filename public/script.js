let chart;
let chartData = [];
let chartLabels = [];

function refreshPrix() {
  fetch('/btc-price')
    .then(res => res.json())
    .then(data => {
      // --- Affichage du prix formaté ---
      const prixEl = document.getElementById('prix');
      prixEl.textContent = `$${data.price.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // --- Affichage de la variation ---
      const variationEl = document.getElementById('variation');
      if (data.variation !== null && data.variation !== undefined) {
        const sign = data.variation > 0 ? '+' : '';
        variationEl.textContent = `(${sign}${data.variation}%)`;

        variationEl.classList.remove('positive', 'negative');
        variationEl.classList.add(data.variation >= 0 ? 'positive' : 'negative');
      } else {
        variationEl.textContent = '(N/A)';
        variationEl.classList.remove('positive', 'negative');
      }

      // --- Affichage de la dernière mise à jour ---
      const date=data.updatedAt.split(' ')[0];
      const time=data.updatedAt.split(' ')[1];
      document.getElementById('maj').textContent = `Last update : ${time} (${date})`;

      // --- Animation "flash" sur le prix ---
      prixEl.classList.add("updated");
      setTimeout(() => prixEl.classList.remove("updated"), 300);

      // --- Ajout au graphique ---
      // Chart.js doit recevoir un nombre pur, pas de texte formaté
      updateChart(Number(data.price));
    })
    .catch(err => {
      console.error('Erreur fetch BTC:', err);
      document.getElementById('prix').textContent = 'Erreur';
      document.getElementById('variation').textContent = '';
      document.getElementById('maj').textContent = '';
    });
}

// --- Initialisation du graphique ---
function initChart() {
  const ctx = document.getElementById('chart');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [{
        label: "BTC/USD",
        data: chartData,
        borderWidth: 2,
        fill: true,
        borderColor: "#00ff95",
        backgroundColor: "rgba(0,255,149,0.08)",
        tension: 0.25,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8b949e" }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { ticks: { color: "#8b949e" }, grid: { color: "rgba(255,255,255,0.05)" } }
      }
    }
  });
}

// --- Mise à jour du graphique ---
function updateChart(newPrice) {
  const now = new Date().toLocaleTimeString("fr-FR", { hour12: false });

  chartLabels.push(now);
  chartData.push(newPrice);

  if (chartLabels.length > 25) { // garder les 25 derniers points
    chartLabels.shift();
    chartData.shift();
  }

  chart.update();
}

// --- Démarrage ---
initChart();
refreshPrix();
setInterval(refreshPrix, 15000); // rafraîchit toutes les 15 secondes
