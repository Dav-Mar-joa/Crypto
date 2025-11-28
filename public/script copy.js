let chart;
let chartData = [];
let chartLabels = [];

// Initialisation du graphique
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
        borderColor: "#00ff95",
        backgroundColor: "rgba(0,255,149,0.08)",
        tension: 0.25,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true }
      },
      scales: {
        x: { title: { display: true, text: 'Heure' } },
        y: { title: { display: true, text: 'Prix (USD)' } }
      }
    }
  });
}

// Charger tout l'historique depuis MongoDB
async function loadHistory() {
  try {
    const res = await fetch('/btc-history');
    const data = await res.json();

    chartLabels = data.map(d => {
      // Convertir la date en objet Date
      const date = new Date(d.updatedAt);
      return date.toLocaleString("fr-FR", { hour12: false });
    });

    chartData = data.map(d => d.price);

    chart.update();
  } catch (err) {
    console.error("Erreur historique:", err);
  }
}

// Rafraîchir le prix actuel et l'ajouter au graphique
async function refreshPrix() {
  try {
    const res = await fetch('/btc-price');
    const data = await res.json();

    // Affichage du prix
    document.getElementById('prix').textContent =
      `$${Number(data.price).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Variation
    const variationEl = document.getElementById('variation');
    if (data.variation !== null) {
      const sign = data.variation > 0 ? '+' : '';
      variationEl.textContent = `(${sign}${data.variation}%)`;
      variationEl.className = data.variation >= 0 ? 'positive' : 'negative';
    } else {
      variationEl.textContent = "(N/A)";
    }

    // Date de mise à jour
    const date = new Date(data.updatedAt);
    document.getElementById('maj').textContent =
      `Last update : ${date.toLocaleTimeString("fr-FR", { hour12: false })} (${date.toLocaleDateString("fr-FR")})`;

    // Ajouter au graphique
    chartLabels.push(date.toLocaleTimeString("fr-FR"));
    chartData.push(data.price);

    chart.update();

  } catch (err) {
    console.error("Erreur refresh:", err);
  }
}

// 🚀 Démarrage
(async () => {
  initChart();
  await loadHistory();   // charge tout l'historique
  await refreshPrix();   // ajoute le prix actuel

  // Met à jour le prix toutes les minutes
  setInterval(refreshPrix, 60 * 1000);
})();
