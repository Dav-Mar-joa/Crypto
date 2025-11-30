const axios = require('axios');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// ======================
// Variables lissage et signal
// ======================
const SEUIL = 0.2; // Seuil variation en %
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
    return signal;
  }

  if (currentSmooth > state.lastSmoothPrice) {
    state.lastHigh = Math.max(state.lastHigh, currentSmooth);
    if (state.lastTrend === "down") {
      const variation = ((currentSmooth - state.lastLow) / state.lastLow) * 100;
      if (variation >= SEUIL) signal = "Buy";
    }
    state.lastTrend = "up";
  } else if (currentSmooth < state.lastSmoothPrice) {
    state.lastLow = Math.min(state.lastLow, currentSmooth);
    if (state.lastTrend === "up") {
      const variation = ((state.lastHigh - currentSmooth) / state.lastHigh) * 100;
      if (variation >= SEUIL) signal = "Sell";
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
  return { lastTrend: null, lastSmoothPrice: null, lastLow: null, lastHigh: null };
}

// ======================
// Sauvegarde de l'état du signal
// ======================
async function saveSignalState(collection, state) {
  await collection.updateOne(
    { type: "signalState" },
    { $set: { state } },
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

    // Calcul variation
    const previousPrice = lastEntries.length > 0 ? lastEntries[lastEntries.length - 1].price : null;
    const variation = previousPrice ? ((newPrice - previousPrice) / previousPrice * 100).toFixed(2) : null;

    // Enregistrer le nouveau prix dans MongoDB
    await collection.insertOne({
      price: newPrice,
      updatedAt: new Date(),
      variation,
      marketCap,
      volume,
      type: "price"
    });

    // Mettre à jour l'historique et calculer le lissage
    priceHistory.push(newPrice);
    const smoothed = smoothPrice(priceHistory);
    const lastSmooth = smoothed[smoothed.length - 1];

    // Calcul du signal
    const actionSignal = calculateTrendSignalSmoothed(lastSmooth, signalState);

    // Sauvegarder l'état du signal pour la prochaine exécution
    await saveSignalState(collection, signalState);

    console.log(`Prix: $${newPrice} | Δ: ${variation}% | Signal: ${actionSignal}`);
    return { price: newPrice, signal: actionSignal };
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
