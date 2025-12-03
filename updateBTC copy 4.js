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

// ====== VARIABLES MÉMOIRE (tendance) ======
let lastSmooth = null;
let lastLow = null;
let lastHigh = null;
let lastTrend = null;

const SEUIL = 0.0001; // 0.1%

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
    const lastBuy = await col.findOne({ signal: "Buy" }, { sort: { updatedAt: -1 } });
    
    

    // 3️⃣ Calcul variation (par rapport dernier prix)
    let variation = null;
    if (history.length > 0) {
      const lastPrice = history[history.length - 1].price;
      variation = ((price - lastPrice) / lastPrice) * 100;
    }

    // 4️⃣ Calcul signal
    const signal = calculateSignal(smooth);
    let profitPercent = null;
    let profitUSDToUpdate = null;
    let profitUSD = null;
    if (signal === "Sell" && lastBuy) {
      console.log("*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*")
      console.log("*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*")
      console.log(`🔔 Signal détecté : SELL à ${price} USD`);
      console.log("lastBuy:", lastBuy);
      console.log("prix actuel",price)
      console.log("prix last buy",lastBuy.price)
      console.log("*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*")
      console.log("*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*8*")
      profitUSD = price - lastBuy.price;

      if (profitUSD>0){
        profitPercent = ((price - lastBuy.price) / lastBuy.price) * 100;
        profitUSDToUpdate = profitUSD.toFixed(2);  
        console.log("--------------------------------------------")
        console.log("--------------------------------------------")
        console.log(`💰 Profit depuis le dernier BUY : ${profitUSD.toFixed(2)} USD`);
        console.log(`📈 Profit en pourcentage : ${profitPercent.toFixed(2)} %`);  
        // document.getElementById("profit").innerText = `Profit: ${profitUSD.toFixed(2)} USD (${profitPercent.toFixed(2)} %)`;
        console.log("--------------------------------------------")
        console.log("--------------------------------------------")
      }
      
    }


    // 5️⃣ Sauvegarde MongoDB
    await col.insertOne({
      price,
      smoothPrice: smooth,
      signal,
      variation,
      updatedAt: new Date()
    });

    console.log("✔️ BTC enregistré :", { price, smooth, signal, variation });

  } catch (err) {
    console.error("Erreur update BTC :", err);
  }
}

// Intervalle 60 sec
setInterval(async () => {
  console.log("----- Nouvelle itération -----");
  await updateBitcoinPrice();
}, 60000);

module.exports = updateBitcoinPrice;
