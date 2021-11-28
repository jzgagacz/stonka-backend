function executequery(pool, q, v) {
    pool.query(q, v, (err, res) => {
        if (err) {
            console.log(err.stack)
        }
    })
}

function createdb(pool) {
    let v = []
    let q = ''

    q = `
    CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
	    userid VARCHAR(100) NOT NULL,
        sub JSONB NOT NULL
    );`
    executequery(pool, q, []);

    q = `
    CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
	    userid VARCHAR(100) NOT NULL,
        crypto VARCHAR(8) NOT NULL,
        price INTEGER NOT NULL,
        moreless VARCHAR(8) NOT NULL,
        date BIGINT NOT NULL
    );`
    executequery(pool, q, []);

    q = `
    CREATE TABLE IF NOT EXISTS followed (
	    userid VARCHAR(100) NOT NULL,
        symbol VARCHAR(8) NOT NULL,
        PRIMARY KEY (userid, symbol)
    );`
    executequery(pool, q, []);

    q = `
    CREATE TABLE IF NOT EXISTS settings (
	    userid VARCHAR(100) PRIMARY KEY NOT NULL,
        chartColor VARCHAR(16) NOT NULL
    );`
    executequery(pool, q, []);
}

module.exports = createdb;