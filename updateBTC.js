const axios = require('axios');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// ======================
// Variables lissage et signal
// ======================
const SEUIL = 0.002; // Seuil variation en %
let priceHistory = []; // Historique pour lissage

// ======================
// Lissage par moyenne mobile
// ======================
function smoothPrice(data, windowSize = 3) {
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
// Calcul du signal achat/vente
// ======================
function calculateTrendSignalSmoothed(currentSmooth, state) {
  let signal = "";

  if (state.lastSmoothPrice === null) {
    state.lastSmoothPrice = currentSmooth;
    state.lastLow = currentSmooth;
    state.lastHigh = currentSmooth;
    state.lastTrendChangePrice = currentSmooth; // prix au dernier changement de tendance
    return signal;
  }

  if (currentSmooth > state.lastSmoothPrice) {
    state.lastHigh = Math.max(state.lastHigh, currentSmooth);
    if (state.lastTrend === "down") {
      // Changement de tendance : down -> up
      const variationFromTrendChange = ((currentSmooth - state.lastTrendChangePrice) / state.lastTrendChangePrice) * 100;
      if (variationFromTrendChange >= SEUIL) signal = "Buy";
      state.lastTrendChangePrice = currentSmooth; // reset prix au changement
    }
    state.lastTrend = "up";
  } else if (currentSmooth < state.lastSmoothPrice) {
    state.lastLow = Math.min(state.lastLow, currentSmooth);
    if (state.lastTrend === "up") {
      // Changement de tendance : up -> down
      const variationFromTrendChange = ((state.lastTrendChangePrice - currentSmooth) / state.lastTrendChangePrice) * 100;
      if (variationFromTrendChange >= SEUIL) signal = "Sell";
      state.lastTrendChangePrice = currentSmooth; // reset prix au changement
    }
    state.lastTrend = "down";
  }

  state.lastSmoothPrice = currentSmooth;
  return signal;
}

// ======================
// Connexion MongoDB
// ======================
const client = new MongoClient(process.env.MONGODB_URI);
let db;

async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db(process.env.MONGODB_DBNAME);
  }
  return db;
}

// ======================
// Récupération de l'état précédent pour le signal
// ======================
async function loadSignalState(collection) {
  const stateDoc = await collection.findOne({ type: "signalState" });
  if (stateDoc) return stateDoc.state;
  return { 
    lastTrend: null, 
    lastSmoothPrice: null, 
    lastLow: null, 
    lastHigh: null, 
    lastTrendChangePrice: null 
  };
}

// ======================
// Sauvegarde de l'état du signal
// ======================
async function saveSignalState(collection, state) {
  await collection.updateOne(
    { type: "signalState" },
    { $set: { state, updatedAt: new Date() } },
    { upsert: true }
  );
}

// ======================
// Update prix BTC + calcul signal
// ======================
async function updateBitcoinPrice() {
  try {
    const db = await connectDB();
    const collection = db.collection(process.env.MONGODB_COLLECTION);

    // Récupérer les derniers prix pour le lissage
    const lastEntries = await collection.find({ type: "price" })
                                       .sort({ _id: -1 })
                                       .limit(50)
                                       .toArray();

    priceHistory = lastEntries.length > 0 ? lastEntries.map(e => e.price).reverse() : [];

    // Récupérer l'état du signal
    const signalState = await loadSignalState(collection);

    // Récupérer le prix actuel depuis CoinGecko
    const url = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true";
    const res = await axios.get(url);

    const newPrice = res.data.bitcoin.usd;
    const marketCap = res.data.bitcoin.usd_market_cap;
    const volume = res.data.bitcoin.usd_24h_vol;

    // Calcul variation depuis le précédent prix
    const previousPrice = lastEntries.length > 0 ? lastEntries[lastEntries.length - 1].price : null;
    const variationFromPrev = previousPrice ? ((newPrice - previousPrice) / previousPrice * 100).toFixed(2) : null;

    // Mettre à jour l'historique et calculer le lissage
    priceHistory.push(newPrice);
    const smoothed = smoothPrice(priceHistory);
    const lastSmooth = smoothed[smoothed.length - 1];

    // Calcul du signal et de la variation depuis le dernier changement de tendance
    const actionSignal = calculateTrendSignalSmoothed(lastSmooth, signalState);
    let variationFromTrendChange = null;
    if (signalState.lastTrendChangePrice !== null) {
      if (signalState.lastTrend === "up") {
        variationFromTrendChange = ((lastSmooth - signalState.lastTrendChangePrice) / signalState.lastTrendChangePrice * 100).toFixed(2);
      } else if (signalState.lastTrend === "down") {
        variationFromTrendChange = ((signalState.lastTrendChangePrice - lastSmooth) / signalState.lastTrendChangePrice * 100).toFixed(2);
      }
    }

    // Enregistrer le nouveau prix + info signal dans MongoDB
    await collection.insertOne({
      price: newPrice,
      updatedAt: new Date(),
      variationFromPrev,
      variationFromTrendChange,
      signal: actionSignal || null,
      marketCap,
      volume,
      type: "price"
    });

    // Sauvegarder l'état du signal
    await saveSignalState(collection, signalState);

    console.log(`Prix: $${newPrice} | ΔPrev: ${variationFromPrev}% | ΔTrend: ${variationFromTrendChange}% | Signal: ${actionSignal}`);
    return { price: newPrice, signal: actionSignal, variationFromPrev, variationFromTrendChange };
  } catch (err) {
    console.error("Erreur updateBTC :", err.message);
    return null;
  }
}

// ======================
// Si exécuté directement (cron)
// ======================
if (require.main === module) {
  (async () => {
    await updateBitcoinPrice();
    process.exit(0);
  })();
}

module.exports = { updateBitcoinPrice };
