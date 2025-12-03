const axios = require('axios');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// ====== MONGO URL ======
const url =
  process.env.MONGODB_URI ||
  process.env.MONGO_URL ||
  process.env.MONGODB_URL;

if (!url) {
  console.error("❌ ERREUR : aucune variable MONGO n’est définie dans .env !");
  process.exit(1);
}

const client = new MongoClient(url);

const DB_NAME = "Crypto";
const COLLECTION = "Bitcoin";

// ====== VARIABLES MÉMOIRE ======
let lastSmooth = null;
let lastLow = null;
let lastHigh = null;
let lastTrend = null;
let lastBuyForProfit = null; // mémorise le vrai BUY local

const SEUIL = 0.01; // 0.01% de variation pour déclencher signal

// ====== LISSAGE (moyenne mobile simple) ======
function smoothPrice(history, window = 2) {
  if (history.length === 0) return null;
  const take = history.slice(-window);
  const avg = take.reduce((s, v) => s + v.price, 0) / take.length;
  return avg;
}

// ====== SIGNAL ======
function calculateSignal(currentSmooth) {
  let signal = "";

  if (lastSmooth === null) {
    lastSmooth = currentSmooth;
    lastLow = currentSmooth;
    lastHigh = currentSmooth;
    return "";
  }

  // HAUSSE
  if (currentSmooth > lastSmooth) {
    lastHigh = Math.max(lastHigh, currentSmooth);
    if (lastTrend === "down") {
      const variation = ((currentSmooth - lastLow) / lastLow) * 100;
      if (variation >= SEUIL) signal = "Buy";
    }
    lastTrend = "up";
  }

  // BAISSE
  else if (currentSmooth < lastSmooth) {
    lastLow = Math.min(lastLow, currentSmooth);
    if (lastTrend === "up") {
      const variation = ((lastHigh - currentSmooth) / lastHigh) * 100;
      if (variation >= SEUIL) signal = "Sell";
    }
    lastTrend = "down";
  }

  lastSmooth = currentSmooth;
  return signal;
}

// ====== UPDATE PRINCIPAL ======
async function updateBitcoinPrice() {
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const col = db.collection(COLLECTION);

    // 1️⃣ Récupère prix API
    const res = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
    );
    const price = res.data.bitcoin.usd;

    // 2️⃣ Récupère historique pour le lissage
    const history = await col.find().sort({ updatedAt: 1 }).toArray();
    const smooth = smoothPrice(history.concat([{ price }]));

    // 3️⃣ Calcul variation par rapport au dernier prix enregistré
    let variation = null;
    if (history.length > 0) {
      const lastPrice = history[history.length - 1].price;
      variation = ((price - lastPrice) / lastPrice) * 100;
    }

    // 4️⃣ Calcul signal
    const signal = calculateSignal(smooth);

    // Variables pour profit
    let profitUSD = null;
    let profitPercent = null;
    let lastBuyPrice = null;
    let sellPrice = null;

    // === Gérer le BUY ===
    if (signal === "Buy") {
      lastBuyForProfit = price; // mémorise le prix du BUY local
      console.log(`🔔 BUY détecté à ${price} USD`);
    }

    // === Gérer le SELL ===
    if (signal === "Sell" && lastBuyForProfit !== null) {
      lastBuyPrice = lastBuyForProfit;
      sellPrice = price;
      profitUSD = sellPrice - lastBuyPrice;
      profitPercent = (profitUSD / lastBuyPrice) * 100;

      console.log(
        `🔔 SELL détecté ! BUY: ${lastBuyPrice}, SELL: ${sellPrice}, Profit USD: ${profitUSD.toFixed(2)}, Profit %: ${profitPercent.toFixed(2)}`
      );

      // Après VENTE → réinitialisation
      lastBuyForProfit = null;
    }

    // Toujours enregistrer la valeur du dernier BUY connu
    const lastBuyValueForDB = lastBuyForProfit;

    // 5️⃣ Sauvegarde MongoDB
    await col.insertOne({
      price,
      smoothPrice: smooth,
      signal,
      variation,

      // 🔥 toujours stocké : même en dehors BUY/SELL
      lastBuyValue: lastBuyValueForDB,

      // 🔥 seulement sur SELL
      lastBuyPrice,
      sellPrice,
      profitUSD,
      profitPercent,

      updatedAt: new Date()
    });

    console.log("✔️ BTC enregistré :", {
      price,
      smooth,
      signal,
      lastBuyValue: lastBuyValueForDB,
      lastBuyPrice,
      sellPrice,
      profitUSD,
      profitPercent,
      variation
    });

  } catch (err) {
    console.error("Erreur update BTC :", err);
  }
}

// // Intervalle 60 sec
// setInterval(async () => {
//   console.log("----- Nouvelle itération -----");
//   await updateBitcoinPrice();
// }, 60000);

if (require.main === module) {
  (async () => {
    await updateBitcoinPrice();
    process.exit(0);
  })();
}

module.exports = updateBitcoinPrice;
