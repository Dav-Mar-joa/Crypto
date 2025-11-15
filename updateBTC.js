require('dotenv').config();
const axios = require('axios');
const { MongoClient } = require('mongodb');

// Config MongoDB
const connectionString = process.env.MONGODB_URI;
const client = new MongoClient(connectionString);
const dbName = process.env.MONGODB_DBNAME;

async function updateBitcoinPrice() {
  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection(process.env.MONGODB_COLLECTION);

    // Récupération du prix BTC
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';
    const res = await axios.get(url);
    const newPrice = res.data.bitcoin.usd;
    const now = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });

    // Récupérer le dernier prix pour calculer la variation
    const lastEntry = await collection.find().sort({ _id: -1 }).limit(1).toArray();
    const oldPrice = lastEntry[0]?.price;
    let variation = null;
    if (oldPrice) {
      variation = ((newPrice - oldPrice) / oldPrice * 100).toFixed(2);
    }

    // Enregistrement dans MongoDB
    await collection.insertOne({ price: newPrice, updatedAt: now });
    console.log(`[✔] BTC: $${newPrice} (à ${now})` + (variation ? ` | Δ ${variation}%` : ''));

  } catch (err) {
    console.error('[❌] Erreur CoinGecko ou MongoDB:', err.message);
  } finally {
    await client.close();
  }
}

// Exécution du script
updateBitcoinPrice();
