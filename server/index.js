const express = require("express");
const cors = require('cors');
const fetch = require('node-fetch');
const webpush = require('web-push');
const { Pool } = require('pg')
const { parse } = require('pg-connection-string');
const { response } = require("express");
const jwt = require('express-jwt');
const jwksRsa = require('jwks-rsa');


const createdb = require('./createdb.js');

require('dotenv').config()
const PORT = process.env.PORT;
const API_KEY = process.env.API_KEY;
const PUBLIC_VAPID_KEY = process.env.PUBLIC_VAPID_KEY;
const PRIVATE_VAPID_KEY = process.env.PRIVATE_VAPID_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN

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

const checkJwt = jwt({
    secret: jwksRsa.expressJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`
    }),
    audience: AUTH0_AUDIENCE,
    issuer: `https://${process.env.AUTH0_DOMAIN}/`,
    algorithms: ['RS256']
});

const alertTimeout = 1000*10
async function manageAlerts() {
    console.log('querying alerts')
    const alerts = await pool.query('SELECT * FROM alerts')
    for (const row of alerts.rows) {
        console.log('alert: ', row.id)
        const crypto = row.crypto
        const price = row.price
        const moreless = row.moreless
        const date = row.date
        const url = `https://www.alphavantage.co/query?function=CRYPTO_INTRADAY&symbol=${crypto}&market=USD&interval=1min&outputsize=full&apikey=${API_KEY}`
        const response = await fetch(url)
        const data = await response.json()
        let send = false
        if (moreless === "more") {
            for (const t in data["Time Series Crypto (1min)"]) {
                if (data["Time Series Crypto (1min)"][t]["4. close"] > price && Date.parse(t + "+0000") > date) {
                    send = true;
                    break;
                }
            }
        } else {
            for (const t in data["Time Series Crypto (1min)"]) {
                if (data["Time Series Crypto (1min)"][t]["4. close"] < price && Date.parse(t + "+0000") > date) {
                    send = true;
                    break;
                }
            }
        }
        console.log(send)
        if (send) {
            const userid = row.userid
            const resp = await pool.query('SELECT * FROM subscriptions WHERE userid = $1', [userid])
            const subscription = resp.rows[0].sub
            const payload = JSON.stringify({ title: 'Alert cenowy', body: `Cena kryptowaluty ${crypto} jest ${moreless === 'more' ? 'powyżej' : 'poniżej'} ${price}USD` });
            webpush.sendNotification(subscription, payload).catch(err => console.error(err));
            await pool.query('DELETE FROM alerts WHERE id = $1', [row.id])
        }
    }
    setTimeout(manageAlerts, alertTimeout)
}

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

app.post('/api/subscribe', checkJwt, async (req, res) => {
    const subscription = req.body;
    const username = req.user.sub
    await pool.query('INSERT INTO subscriptions(userid, sub) VALUES($1, $2)', [username, subscription])
    res.status(201).json({})
})

app.post('/api/alert', checkJwt, async (req, res) => {
    console.log('got alert')
    const alert = req.body;
    const username = req.user.sub
    const result = await pool.query('INSERT INTO alerts(userid, crypto, price, moreless, date) VALUES($1, $2, $3, $4, $5) RETURNING id', [username, alert.crypto, alert.price, alert.moreless, alert.date])
    res.status(201).json({id: result.rows[0].id})
});

app.listen(PORT, () => {
    console.log(`Server listening on ${PORT}`);
    setTimeout(manageAlerts,alertTimeout)
});