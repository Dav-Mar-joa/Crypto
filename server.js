const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

require('dotenv').config();

const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');

// Config MongoDB
const connectionString = process.env.MONGODB_URI;
const client = new MongoClient(connectionString);
const dbName = process.env.MONGODB_DBNAME;
let db;

// Connexion MongoDB
async function connectDB() {
    try {
        await client.connect();
        db = client.db(dbName);
        console.log('Connecté à la base de données MongoDB');
    } catch (err) {
        console.error('Erreur de connexion à MongoDB :', err);
        process.exit(1);
    }
}

connectDB();

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static('public'));

// Variables pour stocker le prix
let cachedPrice = null;
let lastUpdate = null;

// Fonction pour mettre à jour le prix BTC
// async function updateBitcoinPrice() {
//     try {
//         const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';
//         const res = await axios.get(url);

//         cachedPrice = res.data.bitcoin.usd;
//         lastUpdate = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });

//         console.log(`[✔] BTC: $${cachedPrice} (à ${lastUpdate})`);

//         // Sauvegarde dans MongoDB
//         if (db) {
//             const collection = db.collection(process.env.MONGODB_COLLECTION);
//             await collection.insertOne({ price: cachedPrice, updatedAt: lastUpdate });
//             console.log("💾 Prix BTC sauvegardé dans MongoDB");
//         }

//     } catch (err) {
//         console.error('[❌] Erreur CoinGecko :', err.message);
//     }
// }

async function updateBitcoinPrice() {
  try {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';
    const res = await axios.get(url);

    const newPrice = res.data.bitcoin.usd;
    const now = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });

    // --- Récupérer le dernier prix en DB ---
    let oldPrice = null;
    if (db) {
      const collection = db.collection(process.env.MONGODB_COLLECTION);
      const lastEntry = await collection.find().sort({ _id: -1 }).limit(1).toArray();
      oldPrice = lastEntry[0]?.price;
    }

    // --- Calculer la variation avant d’enregistrer ---
    let variation = null;
    if (oldPrice) {
      variation = ((newPrice - oldPrice) / oldPrice * 100).toFixed(2);
    }

    // --- Mettre à jour le cache ---
    cachedPrice = newPrice;
    lastUpdate = now;

    console.log(`[✔] BTC: $${cachedPrice} (à ${lastUpdate})` + (variation ? ` | Δ ${variation}%` : ''));

    // --- Enregistrer dans MongoDB ---
    if (db) {
      const collection = db.collection(process.env.MONGODB_COLLECTION);
      await collection.insertOne({ price: newPrice, updatedAt: now });
      console.log("💾 Prix BTC sauvegardé dans MongoDB");
    }

    return variation; // pour l’API si tu veux
  } catch (err) {
    console.error('[❌] Erreur CoinGecko :', err.message);
  }
}
async function updateBitcoinPrice() {
  try {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';
    const res = await axios.get(url);

    const newPrice = res.data.bitcoin.usd;
    const now = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });

    // --- Récupérer le dernier prix en DB ---
    let oldPrice = null;
    if (db) {
      const collection = db.collection(process.env.MONGODB_COLLECTION);
      const lastEntry = await collection.find().sort({ _id: -1 }).limit(1).toArray();
      oldPrice = lastEntry[0]?.price;
    }

    // --- Calculer la variation avant d’enregistrer ---
    let variation = null;
    if (oldPrice) {
      variation = ((newPrice - oldPrice) / oldPrice * 100).toFixed(2);
    }

    // --- Mettre à jour le cache ---
    cachedPrice = newPrice;
    lastUpdate = now;

    console.log(`[✔] BTC: $${cachedPrice} (à ${lastUpdate})` + (variation ? ` | Δ ${variation}%` : ''));

    // --- Enregistrer dans MongoDB ---
    if (db) {
      const collection = db.collection(process.env.MONGODB_COLLECTION);
      await collection.insertOne({ price: newPrice, updatedAt: now });
      console.log("💾 Prix BTC sauvegardé dans MongoDB");
    }

    return variation; // pour l’API si tu veux
  } catch (err) {
    console.error('[❌] Erreur CoinGecko :', err.message);
  }
}


// Mettre à jour dès le démarrage
updateBitcoinPrice();

// Toutes les 15 minutes = 900000 ms
setInterval(updateBitcoinPrice, 1 * 15 * 1000);

// API pour récupérer le prix au frontend
// app.get('/btc-price', async (req, res) => {
//     if (!cachedPrice) {
//         return res.status(503).json({ error: "Prix non disponible." });
//     }

//     const priceFormat = cachedPrice.toLocaleString('fr-FR', {
//         minimumFractionDigits: 2,
//         maximumFractionDigits: 2
//     });
//     const collection = db.collection(process.env.MONGODB_COLLECTION);

//      // On récupère le dernier enregistrement
//   const lastEntry = await collection.find().sort({ _id: -1 }).limit(1).toArray();
//   const oldPrice = lastEntry[0]?.price;
//     console.log(oldPrice);    
//     console.log(cachedPrice);
//   let variation = null;
//   if (oldPrice) {
//     variation = ((cachedPrice - oldPrice) / oldPrice * 100).toFixed(4);
//   }

//     res.json({
//         price: priceFormat,
//         updatedAt: lastUpdate,
//         variation: variation
//     });
// });
app.get('/btc-price', async (req, res) => {
  if (!cachedPrice) {
    return res.status(503).json({ error: "Prix non disponible." });
  }

  // On peut recalculer la variation en live depuis DB
  let variation = null;
  if (db) {
    const collection = db.collection(process.env.MONGODB_COLLECTION);
    const lastTwo = await collection.find().sort({ _id: -1 }).limit(2).toArray();
    if (lastTwo.length === 2) {
      const oldPrice = lastTwo[1].price;
      variation = ((cachedPrice - oldPrice)/oldPrice*100).toFixed(2);
    }
  }

  res.json({
    price: cachedPrice,
    updatedAt: lastUpdate,
    variation: variation
  });
});

// Lancement du serveur
app.listen(PORT, () => {
    console.log(`🚀 Serveur démarré : http://localhost:${PORT}`);
});
