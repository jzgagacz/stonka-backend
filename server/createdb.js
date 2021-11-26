function executequery(pool, q, v) {
    pool.query(q, v, (err, res) => {
        if (err) {
            console.log(err.stack)
        }
    })
}

function createdb(pool) {
    let v = []
    let q = `
    CREATE TABLE IF NOT EXISTS users (
	    username VARCHAR(100) NOT NULL PRIMARY KEY
    );`
    executequery(pool, q, []);

    v = ['user1']
    q = 'INSERT INTO users(username) VALUES($1) ON CONFLICT (username) DO NOTHING'
    executequery(pool, q, v);

    q = `
    CREATE TABLE IF NOT EXISTS subscriptions (
	    username VARCHAR(100) NOT NULL PRIMARY KEY REFERENCES users,
        sub JSONB
    );`
    executequery(pool, q, []);
}

module.exports = createdb;