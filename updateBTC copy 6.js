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

let lastBuyForProfit = null; // Prix du dernier BUY
let isProcessingOrder = false; // anti double ordre

// règles de sécurité
const SEUIL = 0.01;            // Déclenchement Buy/Sell (0.01%)
const MIN_PROFIT_PERCENT = 0.05; // Profit minimum pour vendre (0.05%)

// ====== LISSAGE ======
function smoothPrice(history, window = 2) {
  if (history.length === 0) return null;
  const take = history.slice(-window);
  const avg = take.reduce((s, v) => s + v.price, 0) / take.length;
  return avg;
}

// ====== CALCUL SIGNAL ======
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

// ======================
//     UPDATE BTC
// ======================
async function updateBitcoinPrice() {
  try {
    if (!client.topology || client.topology.isDestroyed()) {
      await client.connect();
    }

    const db = client.db(DB_NAME);
    const col = db.collection(COLLECTION);

    // --- 1) API
    const res = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
    );
    const price = res.data.bitcoin.usd;

    // --- 2) Historique complet
    const history = await col.find().sort({ updatedAt: 1 }).toArray();
    const smooth = smoothPrice(history.concat([{ price }]));

    // --- 3) Variation instantanée
    let variation = null;
    if (history.length > 0) {
      const lastPrice = history[history.length - 1].price;
      variation = ((price - lastPrice) / lastPrice) * 100;
    }

    // --- 4) Signal
    const signal = calculateSignal(smooth);

    let profitUSD = null;
    let profitPercent = null;
    let lastBuyPrice = null;
    let sellPrice = null;

    // ==========================================
    //          PROTECTION DOUBLE ORDRE
    // ==========================================
    if (isProcessingOrder) {
      console.log("⏳ Ordre déjà en cours, on ignore cette boucle.");
    } else {
      isProcessingOrder = true;

      // ==========================================
      //                BUY ROBUSTE
      // ==========================================
      if (signal === "Buy" && lastBuyForProfit === null) {
        lastBuyForProfit = price;
        console.log(`🟢 BUY déclenché à ${price} USD`);
      }

      // ==========================================
      //                SELL ROBUSTE
      // ==========================================
      if (signal === "Sell" && lastBuyForProfit !== null) {

        const profitP = ((price - lastBuyForProfit) / lastBuyForProfit) * 100;

        if (profitP >= MIN_PROFIT_PERCENT) {
          lastBuyPrice = lastBuyForProfit;
          sellPrice = price;
          profitUSD = sellPrice - lastBuyPrice;
          profitPercent = profitP;

          console.log(
            `🔴 SELL exécuté ! BUY: ${lastBuyPrice}, SELL: ${sellPrice}, Profit USD: ${profitUSD.toFixed(
              2
            )}, Profit %: ${profitPercent.toFixed(2)}`
          );

          lastBuyForProfit = null;
        } else {
          console.log(
            `⚠️ SELL ignoré (profit trop faible : ${profitP.toFixed(4)}%)`
          );
        }
      }

      isProcessingOrder = false;
    }

    // ====== Enregistrement Mongo ======
    await col.insertOne({
      price,
      smoothPrice: smooth,
      signal,
      variation,

      lastBuyValue: lastBuyForProfit,

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
      lastBuyValue: lastBuyForProfit,
      lastBuyPrice,
      sellPrice,
      profitUSD,
      profitPercent,
      variation
    });

  } catch (err) {
    console.error("❌ ERREUR update BTC :", err);
  }
}

setInterval(async () => {
  console.log("----- Nouvelle itération -----");
  await updateBitcoinPrice();
}, 60000);

module.exports = { updateBitcoinPrice };
