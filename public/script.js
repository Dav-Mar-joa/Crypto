let chart;
let chartData = [];
let chartLabels = [];
let isVariationVisible = false;
let yTitle = "Prix BTC/USD";

// Listener du bouton toggle
document.getElementById('button-toggle').addEventListener('click', async () => {
  isVariationVisible = !isVariationVisible;

  if (isVariationVisible) {
    document.getElementById('button-toggle').textContent = "Price";
    yTitle = "Variation %";
    await loadHistory();
  } else {
    document.getElementById('button-toggle').textContent = "Variation";
    yTitle = "Price BTC/USD";
    await loadHistory();
  }

  initChart(); // On réinitialise le graphique avec le nouveau yTitle
});

// ======================
// Initialisation du graphique
// ======================
function initChart() {
  const ctx = document.getElementById('chart');

  if(chart) chart.destroy(); // On détruit l'ancien chart pour en recréer un nouveau

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [{
        label: isVariationVisible ? "%" : "BTC/USD",
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
        y: { title: { display: true, text: yTitle } }
      }
    }
  });
}


// ======================
// Charger tout l'historique depuis MongoDB
// ======================
async function loadHistory() {
  try {
    const res = await fetch('/btc-history');
    const data = await res.json();

    chartLabels.length = 0;
    chartData.length = 0;

    data.forEach(entry => {
      const date = new Date(entry.updatedAt);

      // ← Fuseau Europe/Paris
      const dateFR = date.toLocaleString("fr-FR", {
        hour12: false,
        timeZone: "Europe/Paris"
      });

      chartLabels.push(dateFR);
      if(!isVariationVisible)
        chartData.push(entry.price);
      else{
        chartData.push(entry.variation);
      }
    });

    chart.update();

  } catch (err) {
    console.error("Erreur chargement historique :", err);
  }
}

// ======================
// Rafraîchir le prix actuel
// ======================
async function refreshPrix() {
  try {
    const res = await fetch('/btc-price');
    const data = await res.json();

    // Affichage prix
    document.getElementById('prix').textContent =
      `$${Number(data.price).toLocaleString("fr-FR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`;

    // Variation
    const variationEl = document.getElementById('variation');
    if (data.variation !== null) {
      const sign = data.variation > 0 ? '+' : '';
      variationEl.textContent = `(${sign}${data.variation}%)`;
      variationEl.className = data.variation >= 0 ? 'positive' : 'negative';
    }

    // Dernière mise à jour en fuseau FR
    const date = new Date(data.updatedAt);

    const timeFR = date.toLocaleTimeString("fr-FR", {
      hour12: false,
      timeZone: "Europe/Paris"
    });

    const dateFR = date.toLocaleDateString("fr-FR", {
      timeZone: "Europe/Paris"
    });

    document.getElementById('maj').textContent =
      `Last update : ${timeFR} (${dateFR})`;

    // Mise à jour graphique
    chartLabels.push(timeFR);
    if(!isVariationVisible)
      chartData.push(data.price);
    else{
      chartData.push(data.variation);
    }
    chart.update();

  } catch (err) {
    console.error("Erreur refresh :", err);
  }
}

// ======================
// Lancement
// ======================
(async () => {
  initChart();
  await loadHistory();
  await refreshPrix();

  // Mise à jour toutes les minutes
  setInterval(refreshPrix, 60 * 1000);
})();
