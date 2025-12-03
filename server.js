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

// ======================
// HISTORIQUE DES TRADES
// ======================
app.get('/btc-trades', async (req, res) => {
  try {
    const collection = db.collection(process.env.MONGODB_COLLECTION);

    // On récupère uniquement les documents avec un signal Buy ou Sell
    const trades = await collection
      .find({ signal: { $in: ["Buy", "Sell"] } })
      .sort({ updatedAt: -1 })
      .toArray();

    res.json(trades);
  } catch (err) {
    console.error("Erreur /btc-trades :", err);
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
