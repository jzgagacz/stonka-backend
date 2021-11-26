const express = require("express");
const cors = require('cors');
const fetch = require('node-fetch');
const webpush = require('web-push');
const { Pool } = require('pg')
const { parse } = require('pg-connection-string');
const { response } = require("express");
const createdb = require('./createdb.js');

require('dotenv').config()
const PORT = process.env.PORT;
const API_KEY = process.env.API_KEY;
const PUBLIC_VAPID_KEY = process.env.PUBLIC_VAPID_KEY;
const PRIVATE_VAPID_KEY = process.env.PRIVATE_VAPID_KEY;
const DATABASE_URL = 'postgresql://postgres:JanPawel2137@localhost:5432/postgres'//process.env.DATABASE_URL;

webpush.setVapidDetails(`mailto:${process.env.WEBPUSH_EMAIL}`, PUBLIC_VAPID_KEY, PRIVATE_VAPID_KEY);

const dbconfig = parse(DATABASE_URL)
const pool = new Pool(
    dbconfig
)
createdb(pool);

const app = express();

app.use(cors({
    origin: '*'
}));

app.use(express.json())

app.get("/api", (req, res) => {
    res.json({ message: "Hello!" });
});

app.get("/api/stock/intraday", async (req, res) => {
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${req.query.name}&interval=5min&outputsize=${req.query.outputsize}&apikey=${API_KEY}`
    const response = await fetch(url)
    const json_response = await response.json()
    res.json(json_response);
});

app.get("/api/stock/daily", async (req, res) => {
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${req.query.name}&interval=5min&outputsize=${req.query.outputsize}&apikey=${API_KEY}`
    const response = await fetch(url)
    const json_response = await response.json()
    res.json(json_response);
});

app.get("/api/stock/search", async (req, res) => {
    const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${req.query.keywords}&apikey=${API_KEY}`
    const response = await fetch(url)
    const json_response = await response.json()
    res.json(json_response);
});

app.get("/api/stock/info", async (req, res) => {
    const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${req.query.name}&apikey=${API_KEY}`
    const response = await fetch(url)
    const json_response = await response.json()
    res.json(json_response);
});

app.get("/api/crypto/intraday", async (req, res) => {
    const url = `https://www.alphavantage.co/query?function=CRYPTO_INTRADAY&symbol=${req.query.name}&market=USD&interval=1min&outputsize=${req.query.outputsize}&apikey=${API_KEY}`
    const response = await fetch(url)
    const json_response = await response.json()
    res.json(json_response);
});

app.post('/api/subscribe', async (req, res) => {
    const subscription = req.body;
    const username = 'user1'
    await pool.query('INSERT INTO subscriptions(username, sub) VALUES($1, $2) ON CONFLICT (username) DO UPDATE SET sub = EXCLUDED.sub', [username, subscription])
    res.status(201).json({})
})

app.get("/api/testpush", async (req, res) => {
    const username = 'user1'
    const crypto = 'BTC'
    const price = '2000'
    const moreless = 'more'
    const resp = await pool.query('SELECT * FROM subscriptions WHERE username = $1', [username])
    const subscription = resp.rows[0].sub
    const payload = JSON.stringify({ title: 'Alert cenowy', body: `Cena kryptowaluty ${crypto} jest ${moreless === 'more' ? 'powyżej' : 'poniżej'} ${price}USD`});
    webpush.sendNotification(subscription, payload).catch(err => console.error(err));
    res.status(201).json({})
});

app.listen(PORT, () => {
    console.log(`Server listening on ${PORT}`);
});