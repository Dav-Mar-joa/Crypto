// ======================
//      DEPENDANCES
// ======================
const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const regression = require ("regression");
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ======================
//  MONGODB CONNECTION
// ======================
const client = new MongoClient(process.env.MONGODB_URI);
let db;

async function connectDB() {
  try {
    await client.connect();
    db = client.db(process.env.MONGODB_DBNAME);
    console.log("✔ Connecté à MongoDB");
  } catch (err) {
    console.error("❌ MongoDB erreur :", err);
    process.exit(1);
  }
}

// ======================
//  MIDDLEWARE
// ======================
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static('public'));

// ======================
//  ROUTES API
// ======================

// Prix actuel
app.get('/btc-price', async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: "DB non dispo" });

    const collection = db.collection(process.env.MONGODB_COLLECTION);
    const lastTwo = await collection.find().sort({ _id: -1 }).limit(2).toArray();
    

    if (lastTwo.length === 0) return res.status(503).json({ error: "Pas de prix" });

    const cachedPrice = lastTwo[0].price;
    const lastUpdate = lastTwo[0].updatedAt;

    let variation = null;
    if (lastTwo.length === 2) {
      variation = ((cachedPrice - lastTwo[1].price) / lastTwo[1].price * 100).toFixed(2);
    }
    // console.log("Prix servi :", cachedPrice, "Variation :", variation, "Date :", lastUpdate);

    res.json({ price: cachedPrice, updatedAt: lastUpdate, variation,marketCap: lastTwo[0].marketCap, volume: lastTwo[0].volume });

  } catch (err) {
    res.status(500).json({ error: "Erreur serveur /btc-price" });
  }
});

// Historique complet
app.get('/btc-history', async (req, res) => {
  try {
    const collection = db.collection(process.env.MONGODB_COLLECTION);
    const history = await collection.find().sort({ _id: 1 }).toArray();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur /btc-history" });
  }
});

// ======================
//  ROUTE CRON (optionnel, si tu veux déclencher via URL)
// ======================
const { updateBitcoinPrice } = require('./updateBTC.js');

app.get('/updateBTC', async (req, res) => {
  try {
    await updateBitcoinPrice();
    res.send("Mise à jour BTC OK");
  } catch (err) {
    res.status(500).send("Erreur update BTC");
  }
});

// // ======================
// // HISTORIQUE DES TRADES
// // ======================
// app.get('/btc-trades', async (req, res) => {
//   try {
//     const collection = db.collection(process.env.MONGODB_COLLECTION);

//     // On récupère uniquement les documents avec un signal Buy ou Sell
//     const trades = await collection
//       .find({ signal: { $in: ["Buy", "Sell"] } })
//       .sort({ updatedAt: -1 })
//       .toArray();

//     res.json(trades);
//   } catch (err) {
//     console.error("Erreur /btc-trades :", err);
//     res.status(500).json({ error: "Erreur serveur" });
//   }
// });

// ======================
// HISTORIQUE DES TRADES
// ======================
app.get('/btc-trades', async (req, res) => {
  try {
    const collection = db.collection("Trades"); // <-- nouvelle collection

    // On récupère tous les trades réels
    const trades = await collection
      .find()
      .sort({ date: -1 }) // tri du plus récent au plus ancien
      .toArray();

    res.json(trades);
  } catch (err) {
    console.error("Erreur /btc-trades :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ======================
// HISTORIQUE DES SIGNALS
// ======================
app.get('/btc-signals', async (req, res) => {
  try {
    const col = db.collection("Signals");  // ta collection Signals

    const signals = await col
      .find()
      .sort({ date: -1 })
      .toArray();

    res.json(signals);
  } catch (err) {
    console.error("Erreur /btc-signals :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ======================
// HISTORIQUE Du WALLET
// ======================
app.get('/btc-wallet', async (req, res) => {
  try {
    const col = db.collection("Wallet");  // ta collection Wallet

    // On récupère LE wallet
    const wallet = await col.findOne({ type: "wallet" });

    if (!wallet) {
      return res.status(404).json({ error: "Aucun wallet trouvé" });
    } 

    res.json(wallet);
  } catch (err) {
    console.error("Erreur /btc-wallet :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ======================
// HISTORIQUE DU WALLET (GRAPHIQUE)
// ======================

// app.get('/btc-wallet-history', async (req, res) => {
//   try {
//     const col = db.collection("Wallet");
//     const wallet = await col.findOne({ type: "wallet" });

//     if (!wallet || !Array.isArray(wallet.history)) return res.json([]);

//     let balance = 0;
//     const formatted = wallet.history.map(item => {
//       if(item.type === "SELL") balance += item.usdtReceived;
//       if(item.type === "BUY") balance -= item.amountUSDT;
//       return {
//         timestamp: new Date(item.date).getTime(),
//         usdt: parseFloat(balance.toFixed(2)) // solde cumulé
//       };
//     });

//     res.json(formatted);

//   } catch (err) {
//     console.error("Erreur /btc-wallet-history :", err);
//     res.status(500).json({ error: "Erreur serveur" });
//   }
// });

app.get('/btc-wallet-history', async (req, res) => {
  try {
    const col = db.collection("Wallet");
    const wallet = await col.findOne({ type: "wallet" });

    if (!wallet || !Array.isArray(wallet.history)) return res.json([]);

    let profit = 0;
    const formatted = wallet.history.map(item => {
      if(item.type === "SELL") profit += item.usdtReceived - wallet.totalInvested; // gain net
      if(item.type === "BUY") profit -= 0; // pas de perte à l'achat, seulement au SELL
      return {
        timestamp: new Date(item.date).getTime(),
        usdt: parseFloat(profit.toFixed(2)) // profit net
      };
    });

    res.json(formatted);

  } catch (err) {
    console.error("Erreur /btc-wallet-history :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});


// ======================
//  DEMARRAGE DU SERVEUR
// ======================
async function start() {
  await connectDB();
  app.listen(PORT, () => console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
}

start();
