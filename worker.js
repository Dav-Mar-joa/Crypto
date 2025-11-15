require('dotenv').config();
const axios = require('axios');
const { MongoClient } = require('mongodb');

const client = new MongoClient(process.env.MONGODB_URI);

async function updateBitcoinPrice() {
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DBNAME);
    const collection = db.collection(process.env.MONGODB_COLLECTION);

    const res = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
    );

    const price = res.data.bitcoin.usd;
    const now = new Date().toISOString();

    await collection.insertOne({ price, updatedAt: now });
    console.log("BTC ajouté :", price, now);

  } catch (err) {
    console.log("Erreur :", err.message);
  }
}

setInterval(updateBitcoinPrice, 1000 * 60 * 10); // 10 minutes
updateBitcoinPrice();
