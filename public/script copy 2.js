let chart;
let chartData = [];
let chartDataR = [];
let chartLabels = [];
let isVariationVisible = false;
let isVolumeVisible = false;
let yTitle = "Prix BTC/USD";
let yTitleR = "Market Cap";

// ======================
// Lissage polynomiale (optionnel)
// ======================
// function smoothPolynomial(data, degree = 3) {
//   if (data.length < degree + 1) return [...data];
//   const points = data.map((y, i) => [i, y]);
//   const result = regression.polynomial(points, { order: degree });
//   return points.map(([x]) => result.predict(x)[1]);
// }

// ======================
// Lissage par moyenne mobile
// ======================
function smoothPrice(data, windowSize = 2) {
  const smoothed = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(data.length, i + Math.floor(windowSize / 2) + 1);
    const window = data.slice(start, end);
    const avg = window.reduce((sum, v) => sum + v, 0) / window.length;
    smoothed.push(avg);
  }
  return smoothed;
}

// ======================
// Variables pour signal achat/vente basé sur le lissage
// ======================
let lastTrend = null;          // "up" ou "down"
let lastSmoothPrice = null;    // dernier prix lissé observé
let actionSignal = "";          // signal actuel "à acheter" / "à vendre"

// ======================
// Calcul du signal basé sur la tendance lissée
// ======================
// function calculateTrendSignalSmoothed(currentSmooth) {
//   let signal = "";

//   if (lastSmoothPrice === null) {
//     lastSmoothPrice = currentSmooth;
//     lastTrend = null;
//     return "";
//   }

//   if (currentSmooth > lastSmoothPrice) {
//     // Tendance à la hausse
//     if (lastTrend === "down") signal = "à acheter"; // retournement
//     lastTrend = "up";
//   } else if (currentSmooth < lastSmoothPrice) {
//     // Tendance à la baisse
//     if (lastTrend === "up") signal = "à vendre"; // retournement
//     lastTrend = "down";
//   }

//   lastSmoothPrice = currentSmooth;
//   return signal;
// }
let lastLow = null;  // dernier point bas
let lastHigh = null; // dernier point haut 

const SEUIL = 0.001; // 2% par exemple

function calculateTrendSignalSmoothed(currentSmooth) {
  let signal = "";

  if (lastSmoothPrice === null) {
    lastSmoothPrice = currentSmooth;
    lastLow = currentSmooth;
    lastHigh = currentSmooth;
    return "";
  }

  // --- TENDANCE HAUSSE ---
  if (currentSmooth > lastSmoothPrice) {

    // on met à jour le point haut
    lastHigh = Math.max(lastHigh, currentSmooth);
    console.log("Mise à jour lastHigh :", lastHigh);  

    // retournement HAUSSE → ACHAT
    if (lastTrend === "down") {
      const variation = ((currentSmooth - lastLow) / lastLow) * 100;
      console.log("Variation pour achat :", variation);

      if (variation >= SEUIL) {
        signal = "Buy";
      }
    }

    lastTrend = "up";
  }

  // --- TENDANCE BAISSE ---
  else if (currentSmooth < lastSmoothPrice) {

    // on met à jour le point bas
    lastLow = Math.min(lastLow, currentSmooth);
    console.log("lastLow : ",lastLow)

    // retournement BAISSE → VENTE
    if (lastTrend === "up") {
      const variation = ((lastHigh - currentSmooth) / lastHigh) * 100;
      console.log("Variation pour vente :", variation);

      if (variation >= SEUIL) {
        signal = "Sell";
      }
    }

    lastTrend = "down";
  }

  lastSmoothPrice = currentSmooth;
  return signal;
}

// ======================
// UTIL: applique l'état des checkboxes aux datasets
// ======================
function applyCheckboxVisibility() {
  if (!chart) return;

  const showVariation = document.getElementById('check-variation').checked;
  const showVolume = document.getElementById('check-volume').checked;
  const showSmooth = document.getElementById('check-smooth').checked;

  chart.data.datasets[0].hidden = !showVariation;
  chart.data.datasets[1].hidden = !showVolume;
  chart.data.datasets[2].hidden = !showSmooth;

  chart.update();
}

// ======================
// Listeners checkboxes
// ======================
document.addEventListener('DOMContentLoaded', () => {
  const checkVar = document.getElementById('check-variation');
  const checkVol = document.getElementById('check-volume');
  const checkSmooth = document.getElementById('check-smooth');

  if (checkVar) checkVar.addEventListener('change', applyCheckboxVisibility);
  if (checkVol) checkVol.addEventListener('change', applyCheckboxVisibility);
  if (checkSmooth) checkSmooth.addEventListener('change', applyCheckboxVisibility);
});

// ======================
// Toggle prix/variation
// ======================
document.getElementById('button-toggle').addEventListener('click', async () => {
  isVariationVisible = !isVariationVisible;

  if (isVariationVisible) {
    document.getElementById('button-toggle').textContent = "Price";
    yTitle = "Variation %";
  } else {
    document.getElementById('button-toggle').textContent = "Variation";
    yTitle = "Price BTC/USD";
  }

  await loadHistory();
  initChart();
  applyCheckboxVisibility();
});

// ======================
// Toggle volume/marketcap
// ======================
document.getElementById('button-toggle2').addEventListener('click', async () => {
  isVolumeVisible = !isVolumeVisible;

  if (isVolumeVisible) {
    document.getElementById('button-toggle2').textContent = "Volume";
    yTitleR = "Market Cap";
  } else {
    document.getElementById('button-toggle2').textContent = "Market Cap";
    yTitleR = "Volume";
  }

  await loadHistory();
  initChart();
  applyCheckboxVisibility();
});

// ======================
// Initialisation du graphique
// ======================
function initChart() {
  const ctx = document.getElementById('chart');

  if (chart) chart.destroy();

  const smoothed = smoothPrice(chartData);

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [
        {
          label: isVariationVisible ? "%" : "BTC/USD",
          data: chartData,
          borderWidth: 2,
          borderColor: "#00ff95",
          backgroundColor: "rgba(0,255,149,0.08)",
          tension: 0.25,
          pointRadius: 0,
          yAxisID: 'y'
        },
        {
          label: isVolumeVisible ? "Volume" : "Market Cap",
          data: chartDataR,
          borderWidth: 2,
          borderColor: "#ff6a00",
          backgroundColor: "rgba(255,106,0,0.08)",
          tension: 0.25,
          pointRadius: 0,
          yAxisID: 'y1'
        },
        {
          label: "Price smoothed",
          data: smoothed,
          borderWidth: 2,
          borderColor: "#f81f1fff",
          backgroundColor: "rgba(255,255,255,0.05)",
          tension: 0.25,
          pointRadius: 0,
          yAxisID: 'y',
          hidden: true
        }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: {
        x: { title: { display: true, text: 'Heure' } },
        y: { type: 'linear', display: true, position: 'left', title: { display: true, text: yTitle } },
        y1: { type: 'linear', display: true, position: 'right', title: { display: true, text: yTitleR }, grid: { drawOnChartArea: false } }
      }
    }
  });

  applyCheckboxVisibility();
}

// ======================
// Charger l'historique
// ======================
async function loadHistory() {
  try {
    const res = await fetch('/btc-history');
    const data = await res.json();

    chartLabels.length = 0;
    chartData.length = 0;
    chartDataR.length = 0;

    data.forEach(entry => {
      const date = new Date(entry.updatedAt);
      const dateFR = date.toLocaleString("fr-FR", { hour12: false, timeZone: "Europe/Paris" });

      chartLabels.push(dateFR);

      if (!isVariationVisible) chartData.push(entry.price);
      else chartData.push(entry.variation);

      if (!isVolumeVisible) chartDataR.push(entry.marketCap);
      else chartDataR.push(entry.volume);
    });

    if (chart) chart.update();
  } catch (err) {
    console.error("Erreur chargement historique :", err);
  }
}

// ======================
// Rafraîchir le prix actuel + calcul du signal lissé
// ======================
async function refreshPrix() {
  try {
    const res = await fetch('/btc-price');
    const data = await res.json();

    document.getElementById('prix').textContent =
      `$${Number(data.price).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const variationEl = document.getElementById('variation');
    if (data.variation !== null) {
      const sign = data.variation > 0 ? '+' : '';
      variationEl.textContent = `(${sign}${data.variation}%)`;
      variationEl.className = data.variation >= 0 ? 'positive' : 'negative';
    }

    const date = new Date(data.updatedAt);
    const timeFR = date.toLocaleTimeString("fr-FR", { hour12: false, timeZone: "Europe/Paris" });
    const dateFR = date.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });

    document.getElementById('maj').textContent = `Last update : ${timeFR} (${dateFR})`;

    chartLabels.push(timeFR);
    if (!isVariationVisible) chartData.push(data.price); else chartData.push(data.variation);
    if (!isVolumeVisible) chartDataR.push(data.marketCap); else chartDataR.push(data.volume);

    // Mise à jour du lissage
    const newSmooth = smoothPrice(chartData);
    chart.data.datasets[2].data = newSmooth;

    // Calcul du signal basé sur le dernier point lissé
    const lastSmooth = newSmooth[newSmooth.length - 1];
    actionSignal = calculateTrendSignalSmoothed(lastSmooth);

    // Affichage du signal
    const signalEl = document.getElementById('signal');
    if (signalEl) {
      signalEl.textContent = actionSignal;
      signalEl.className = actionSignal === "Buy" ? "buy" :
                           actionSignal === "Sell" ? "sell" : "";
    }

    if (chart) chart.update();
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
