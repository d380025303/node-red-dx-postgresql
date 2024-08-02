
'use strict';


module.exports = function (RED) {
    const { Pool } = require('pg');

    function pgConfigNode(n) {
        const node = this;
        RED.nodes.createNode(node, n);
        this.pgPool = new Pool({
            user: n.user,
            password: n.password,
            host: n.host,
            port: n.port,
            database: n.dbname,
            max: n.max,
            idleTimeoutMillis: n.idleTimeout,
            connectionTimeoutMillis: n.connectionTimeoutMillis,
        });
        this.pgPool.on('error', (err, _) => {
            node.error(err.message);
        });
    }

    RED.nodes.registerType('pgConfig', pgConfigNode);

    function pgSQLNode(config) {
        const node = this;
        RED.nodes.createNode(node, config);
        node.pgConfig = RED.nodes.getNode(config.pgConfig)
        node.query = config.query
        node.name = config.name
        node.outputFormat = config.outputFormat

        const check_db = async function() {
            let client
            try {
                const pool = node.pgConfig.pgPool
                client = await pool.connect()
                await client.query("select 1")
                node.status({ fill:"green", shape:"ring", text:RED._('pg.conn.connect') });
            } catch (e) {
                node.status({ fill:"red", shape:"ring", text:RED._('pg.conn.disconnect') });
            } finally {
                client && client.release()
            }
        }
        check_db()

        node.on('input', async (msg, send, done) => {
            send = send || function() { node.send.apply(node,arguments) }
            const handleError = function (err) {
                send([null, { ...msg, payload: err}])
                if (done) {
                    // Node-RED 1.0 compatible
                    done(err);
                } else {
                    // Node-RED 0.x compatible
                    node.error(err, msg);
                }
            }
            const pool = node.pgConfig.pgPool
            if (!pool) {
                return handleError(RED._("pg.error.no_config"))
            }
            let query = node.query || msg.query
            if (!query) {
                return handleError(RED._("pg.error.no_query"))
            }
            let queryParams = msg.queryParams
            delete msg.query
            delete msg.queryParams
            let searchQuery = {
                text: query,
                values: queryParams,
                rowMode: 'array',
            }
            let client;
            try {
                const handle_data = function (res, output) {
                    let keys = res.fields
                    let rows = res.rows
                    for (let i = 0; i < rows.length; i++) {
                        let obj = {}
                        for (let j = 0; j < keys.length; j++) {
                            let name = keys[j].name
                            obj[name] = rows[i][j]
                        }
                        output.push(obj)
                    }
                }

                client = await pool.connect()
                let ress = await client.query(searchQuery)
                // node.log(JSON.stringify(ress))
                let output = []
                if (Array.isArray(ress)) {
                    for (let i = 0; i < ress.length; i++) {
                        let res = ress[i]
                        handle_data(res, output)
                    }
                } else {
                    handle_data(ress, output)
                }
                if ('mul' !== node.outputFormat && output.length <= 1) {
                    msg.payload = output.length === 1 ? output[0] : null
                } else {
                    msg.payload = output
                }

                send([msg, null])
                if (done) {
                    done();
                }
            } catch (e) {
                handleError(`${e}${searchQuery && searchQuery.text ? ` | ` + searchQuery.text : ''}${searchQuery && searchQuery.values ? ` | ` + JSON.stringify(searchQuery.values) : ''}`)
            } finally {
                client && client.release()
            }
        });
    }

    RED.nodes.registerType('pg', pgSQLNode);
};
