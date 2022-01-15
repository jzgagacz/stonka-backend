const express = require("express");
const cors = require('cors');
const fetch = require('node-fetch');
const webpush = require('web-push');
const { Pool } = require('pg')
const { parse } = require('pg-connection-string');
const { response, json } = require("express");
const jwt = require('express-jwt');
const jwksRsa = require('jwks-rsa');
const format = require('pg-format');


const createdb = require('./createdb.js');

require('dotenv').config()
const PORT = process.env.PORT;
const API_KEY = process.env.API_KEY;
const PUBLIC_VAPID_KEY = process.env.PUBLIC_VAPID_KEY;
const PRIVATE_VAPID_KEY = process.env.PRIVATE_VAPID_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN
const DB_SSL = process.env.DB_SSL

webpush.setVapidDetails(`mailto:${process.env.WEBPUSH_EMAIL}`, PUBLIC_VAPID_KEY, PRIVATE_VAPID_KEY);

let dbconfig = parse(DATABASE_URL)
if (DB_SSL === 'true') {
    dbconfig['ssl'] = {
        rejectUnauthorized: false
    }
}

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

const alertTimeout = 1000 * 60
async function manageAlerts() {
    console.log('querying alerts')
    const cryptos = await pool.query('SELECT DISTINCT crypto FROM alerts')
    for (const c of cryptos.rows) {
        const crypto = c.crypto
        const url = `https://www.alphavantage.co/query?function=CRYPTO_INTRADAY&symbol=${crypto}&market=USD&interval=1min&outputsize=full&apikey=${API_KEY}`
        const response = await fetch(url)
        const data = await response.json()

        const alerts = await pool.query('SELECT * FROM alerts WHERE crypto = $1', [crypto])
        for (const row of alerts.rows) {
            const price = row.price
            const moreless = row.moreless
            const date = row.date
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
            if (send) {
                const userid = row.userid
                const resp = await pool.query('SELECT * FROM subscriptions WHERE userid = $1', [userid])
                for (const s of resp.rows) {
                    const subscription = s.sub
                    const payload = JSON.stringify({ title: 'Alert cenowy', body: `Cena kryptowaluty ${crypto} jest ${moreless === 'more' ? 'powyżej' : 'poniżej'} ${price}USD` });
                    webpush.sendNotification(subscription, payload).catch(err => {
                        console.error(err);
                        console.log(err.statusCode)
                        if (err.statusCode === 410){
                            await pool.query('DELETE FROM subscriptions WHERE sub = $1', [s.sub])
                        }
                    });
                }
                await pool.query('DELETE FROM alerts WHERE id = $1', [row.id])
            }
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
    if (req.query.timestamp !== '0') {
        let date = new Date(parseInt(req.query.timestamp))
        let filtered = Object.fromEntries(Object.entries(json_response["Time Series (5min)"]).filter(([k, v]) => new Date(k + "+0000") > date))
        json_response["Time Series (5min)"] = filtered
    }
    res.json(json_response);
});

app.get("/api/stock/daily", async (req, res) => {
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${req.query.name}&interval=5min&outputsize=${req.query.outputsize}&apikey=${API_KEY}`
    const response = await fetch(url)
    const json_response = await response.json()
    if (req.query.timestamp !== '0') {
        let date = new Date(parseInt(req.query.timestamp))
        let filtered = Object.fromEntries(Object.entries(json_response["Time Series (Daily)"]).filter(([k, v]) => new Date(k + "+0000") > date))
        json_response["Time Series (Daily)"] = filtered
    }
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
    let json_response = await response.json()
    if (req.query.timestamp !== '0') {
        let date = new Date(parseInt(req.query.timestamp))
        let filtered = Object.fromEntries(Object.entries(json_response["Time Series Crypto (1min)"]).filter(([k, v]) => new Date(k + "+0000") > date))
        json_response["Time Series Crypto (1min)"] = filtered
    }
    res.json(json_response);
});

app.post('/api/subscribe', checkJwt, async (req, res) => {
    const subscription = req.body;
    const username = req.user.sub
    await pool.query('INSERT INTO subscriptions(userid, sub) VALUES($1, $2)', [username, subscription])
    res.status(201).json({})
})

app.post('/api/alert', checkJwt, async (req, res) => {
    const alert = req.body;
    const username = req.user.sub
    await pool.query('INSERT INTO timestamps(userid, alerts) VALUES($1, $2) ON CONFLICT(userid) DO UPDATE SET alerts = EXCLUDED.alerts', [username, alert.timestamp])
    const result = await pool.query('INSERT INTO alerts(userid, crypto, price, moreless, date) VALUES($1, $2, $3, $4, $5) RETURNING id', [username, alert.crypto, alert.price, alert.moreless, alert.date])
    res.status(201).json({ id: result.rows[0].id })
});

app.delete('/api/alert', checkJwt, async (req, res) => {
    const alert = req.body;
    const username = req.user.sub
    await pool.query('INSERT INTO timestamps(userid, alerts) VALUES($1, $2) ON CONFLICT(userid) DO UPDATE SET alerts = EXCLUDED.alerts', [username, alert.timestamp])
    const result = await pool.query('DELETE FROM alerts WHERE userid = $1 AND id = $2', [username, alert.id])
    res.status(201).json({})
});

app.get('/api/user/alerts', checkJwt, async (req, res) => {
    const username = req.user.sub
    let result = await pool.query('SELECT * FROM alerts WHERE userid = $1', [username])
    let list = result.rows.map((row) => ({ id: row.id, symbol: row.crypto, price: row.price, moreless: row.moreless, date: row.date }))
    result = await pool.query('SELECT alerts FROM timestamps WHERE userid = $1', [username])
    let timestamp = undefined
    if (result.rows[0] != null)
        timestamp = parseInt(result.rows[0]['alerts'])
    let alerts = { alerts: list, timestamp: timestamp }
    res.status(201).json(alerts)
});

app.post('/api/user/alerts', checkJwt, async (req, res) => {
    const alerts = req.body;
    const username = req.user.sub
    let vals = alerts.alerts.map((alert) => [username, alert.symbol, alert.price, alert.moreless, alert.date])
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        await client.query('DELETE FROM alerts WHERE userid = $1', [username])
        if (vals.length > 0)
            await client.query(format('INSERT INTO alerts(userid, crypto, price, moreless, date) VALUES %L', vals))
        await client.query('INSERT INTO timestamps(userid, alerts) VALUES($1, $2) ON CONFLICT(userid) DO UPDATE SET alerts = EXCLUDED.alerts', [username, alerts.timestamp])
        await client.query('COMMIT')
    } catch (e) {
        await client.query('ROLLBACK')
        throw e
    } finally {
        client.release()
    }
    res.status(201).json({})
});

app.post('/api/followed', checkJwt, async (req, res) => {
    const followed = req.body;
    const username = req.user.sub
    await pool.query('INSERT INTO timestamps(userid, followed) VALUES($1, $2) ON CONFLICT(userid) DO UPDATE SET followed = EXCLUDED.followed', [username, followed.timestamp])
    await pool.query('INSERT INTO followed(userid, symbol) VALUES($1, $2)', [username, followed.symbol])
    res.status(201).json({})
});

app.delete('/api/followed', checkJwt, async (req, res) => {
    const followed = req.body;
    const username = req.user.sub
    await pool.query('INSERT INTO timestamps(userid, followed) VALUES($1, $2) ON CONFLICT(userid) DO UPDATE SET followed = EXCLUDED.followed', [username, followed.timestamp])
    const result = await pool.query('DELETE FROM followed WHERE userid = $1 AND symbol = $2', [username, followed.symbol])
    res.status(201).json({})
});

app.get('/api/user/followed', checkJwt, async (req, res) => {
    const username = req.user.sub
    let result = await pool.query('SELECT * FROM followed WHERE userid = $1', [username])
    let symbols = result.rows.map((row) => row.symbol)
    result = await pool.query('SELECT followed FROM timestamps WHERE userid = $1', [username])
    let timestamp = undefined
    if (result.rows[0] != null)
        timestamp = parseInt(result.rows[0]['followed'])
    let followed = { symbols: symbols, timestamp: timestamp }
    res.status(201).json(followed)
});

app.post('/api/user/followed', checkJwt, async (req, res) => {
    const followed = req.body;
    const username = req.user.sub
    let vals = followed.symbols.map((symbol) => [username, symbol])
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        await client.query('DELETE FROM followed WHERE userid = $1', [username])
        if (vals.length > 0)
            await client.query(format('INSERT INTO followed(userid, symbol) VALUES %L', vals))
        await client.query('INSERT INTO timestamps(userid, followed) VALUES($1, $2) ON CONFLICT(userid) DO UPDATE SET followed = EXCLUDED.followed', [username, followed.timestamp])
        await client.query('COMMIT')
    } catch (e) {
        await client.query('ROLLBACK')
        throw e
    } finally {
        client.release()
    }
    res.status(201).json({})
});

app.post('/api/settings', checkJwt, async (req, res) => {
    const settings = req.body;
    const username = req.user.sub
    await pool.query('INSERT INTO timestamps(userid, settings) VALUES($1, $2) ON CONFLICT(userid) DO UPDATE SET settings = EXCLUDED.settings', [username, settings.timestamp])
    await pool.query('INSERT INTO settings(userid, chartColor) VALUES($1, $2) ON CONFLICT (userid) DO UPDATE SET chartColor = EXCLUDED.chartColor', [username, settings.chartColor])
    res.status(201).json({})
});

app.get('/api/user/settings', checkJwt, async (req, res) => {
    const username = req.user.sub
    let result = await pool.query('SELECT * FROM settings WHERE userid = $1', [username])
    let settings = result.rows[0] === undefined ? [] : result.rows[0]
    result = await pool.query('SELECT settings FROM timestamps WHERE userid = $1', [username])
    let timestamp = undefined
    if (result.rows[0] != null)
        timestamp = parseInt(result.rows[0]['settings'])
    settings['timestamp'] = timestamp
    res.status(201).json(settings)
});

app.post('/api/user/settings', checkJwt, async (req, res) => {
    const settings = req.body;
    const username = req.user.sub
    await pool.query('INSERT INTO timestamps(userid, settings) VALUES($1, $2) ON CONFLICT(userid) DO UPDATE SET settings = EXCLUDED.settings', [username, settings.timestamp])
    await pool.query('INSERT INTO settings(userid, chartColor) VALUES($1, $2) ON CONFLICT (userid) DO UPDATE SET chartColor = EXCLUDED.chartColor', [username, settings.chartColor])
    res.status(201).json({})
});

app.get('/api/user/timestamps', checkJwt, async (req, res) => {
    const username = req.user.sub
    const result = await pool.query('SELECT * FROM timestamps WHERE userid = $1', [username])
    const timestamps = result.rows[0] === undefined ? [] : result.rows[0]
    res.status(201).json(timestamps)
});

app.listen(PORT, () => {
    console.log(`Server listening on ${PORT}`);
    setTimeout(manageAlerts, alertTimeout)
});