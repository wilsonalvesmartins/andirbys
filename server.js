const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

const dbPath = path.join(dataDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(err) { if (err) reject(err); else resolve(this); }));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); }));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); }));

async function initDB() {
    await run(`CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT,
        name TEXT,
        price REAL,
        active INTEGER DEFAULT 1
    )`);

    await run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);

    await run(`CREATE TABLE IF NOT EXISTS users (
        whatsapp TEXT PRIMARY KEY,
        name TEXT,
        address TEXT
    )`);

    await run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_whatsapp TEXT,
        customer_name TEXT,
        customer_address TEXT,
        type TEXT,
        items_json TEXT,
        subtotal REAL,
        delivery_fee REAL,
        total REAL,
        status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Inserir configurações padrão caso não existam
    const hasSettings = await get(`SELECT * FROM settings LIMIT 1`);
    if (!hasSettings) {
        await run(`INSERT INTO settings (key, value) VALUES ('delivery_fee', '8.00')`);
        await run(`INSERT INTO settings (key, value) VALUES ('webhook_url', '')`);
        await run(`INSERT INTO settings (key, value) VALUES ('is_open', '1')`); // 1 Aberto, 0 Fechado
        await run(`INSERT INTO settings (key, value) VALUES ('unavailable_flavors', '[]')`); // Sabores esgotados
    } else {
        // Atualizações para bancos antigos que não têm os novos campos
        const hasIsOpen = await get(`SELECT value FROM settings WHERE key = 'is_open'`);
        if(!hasIsOpen) await run(`INSERT INTO settings (key, value) VALUES ('is_open', '1')`);
        
        const hasUnav = await get(`SELECT value FROM settings WHERE key = 'unavailable_flavors'`);
        if(!hasUnav) await run(`INSERT INTO settings (key, value) VALUES ('unavailable_flavors', '[]')`);
    }

    // Inserir cardápio do PDF se vazio
    const hasItems = await get(`SELECT * FROM items LIMIT 1`);
    if (!hasItems) {
        const initialItems = [
            ['Pizzas Gigantes (50cm)', '1 Sabor (Salgada)', 93.00],
            ['Pizzas Gigantes (50cm)', '1 Sabor (Doce)', 102.00],
            ['Pizzas Gigantes (50cm)', '2 Sabores (Salgadas)', 94.00],
            ['Pizzas Gigantes (50cm)', '3 Sabores', 96.00],
            ['Pizzas Gigantes (50cm)', '2 Sabores (Salgada e Doce)', 102.00],
            ['Pizzas Família (35cm)', '1 Sabor (Salgada)', 57.00],
            ['Pizzas Família (35cm)', '1 Sabor (Doce)', 64.00],
            ['Pizzas Família (35cm)', '2 Sabores (Salgadas)', 59.00],
            ['Pizzas Família (35cm)', '2 Sabores (Salgada e Doce)', 61.00],
            ['Pizzas Família (35cm)', '3 Sabores (2 Salgadas e 1 Doce)', 64.00],
            ['Pizza no Prato', '1 Sabor', 28.00],
            ['Pizza no Prato', '2 Sabores', 33.00],
            ['Bordas Recheadas', 'Borda Gigante 50cm', 16.00],
            ['Bordas Recheadas', 'Borda Família 35cm', 14.00],
            ['Esfihas', '1 Unidade', 5.00],
            ['Esfihas', 'Combo 10 Unidades', 40.00],
            ['Esfihas', 'Combo 20 Unidades', 70.00],
            ['Bebidas', 'Guaraná Antarctica 2L', 14.00],
            ['Bebidas', 'Coca Cola 2L', 15.00]
        ];
        for (let item of initialItems) {
            await run(`INSERT INTO items (category, name, price) VALUES (?, ?, ?)`, item);
        }
    }
}
initDB();

function authAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader === 'Bearer andirbys2026') {
        next();
    } else {
        res.status(401).json({ error: 'Não autorizado' });
    }
}

// Função para enviar Webhook sem travar a requisição
async function triggerWebhook(payload) {
    try {
        const webhookSetting = await get(`SELECT value FROM settings WHERE key = 'webhook_url'`);
        if (webhookSetting && webhookSetting.value && webhookSetting.value.startsWith('http')) {
            fetch(webhookSetting.value, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(err => console.error("Erro no Webhook:", err.message));
        }
    } catch(e) { console.error("Erro geral Webhook", e.message); }
}

// ================= ROTAS PÚBLICAS =================
app.get('/api/menu', async (req, res) => {
    try {
        const items = await all(`SELECT * FROM items WHERE active = 1 ORDER BY category, id`);
        const settingsRaw = await all(`SELECT * FROM settings`);
        const settings = {};
        settingsRaw.forEach(s => settings[s.key] = s.value);
        res.json({ items, settings });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:whatsapp', async (req, res) => {
    try {
        const user = await get(`SELECT * FROM users WHERE whatsapp = ?`, [req.params.whatsapp]);
        res.json(user || {});
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orders', async (req, res) => {
    const { whatsapp, name, address, type, items, subtotal, delivery_fee, total } = req.body;
    try {
        // Verifica se restaurante está aberto
        const isOpenSetting = await get(`SELECT value FROM settings WHERE key = 'is_open'`);
        if(isOpenSetting && isOpenSetting.value === '0') {
            return res.status(400).json({ error: 'Restaurante fechado no momento.' });
        }

        await run(`INSERT INTO users (whatsapp, name, address) VALUES (?, ?, ?) 
                   ON CONFLICT(whatsapp) DO UPDATE SET name = excluded.name, address = excluded.address`, 
                   [whatsapp, name, address]);
        
        const itemsJson = JSON.stringify(items);
        const result = await run(`INSERT INTO orders (customer_whatsapp, customer_name, customer_address, type, items_json, subtotal, delivery_fee, total, status) 
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pendente')`,
                                  [whatsapp, name, address, type, itemsJson, subtotal, delivery_fee, total]);
        
        triggerWebhook({
            event: 'new_order',
            orderId: result.lastID, whatsapp, name, address, type, items, subtotal, delivery_fee, total, status: 'Pendente',
            date: new Date().toISOString()
        });

        res.json({ success: true, orderId: result.lastID });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= ROTAS ADMIN =================
app.get('/api/admin/orders', authAdmin, async (req, res) => {
    try {
        const orders = await all(`SELECT * FROM orders ORDER BY created_at DESC`);
        res.json(orders);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/orders/:id', authAdmin, async (req, res) => {
    const { status, customer_name, customer_address } = req.body;
    try {
        await run(`UPDATE orders SET status = ?, customer_name = ?, customer_address = ? WHERE id = ?`, 
            [status, customer_name, customer_address, req.params.id]);
        
        // Dispara o webhook informando mudança de status!
        const updatedOrder = await get(`SELECT * FROM orders WHERE id = ?`, [req.params.id]);
        if(updatedOrder) {
            triggerWebhook({
                event: 'status_update',
                orderId: updatedOrder.id,
                whatsapp: updatedOrder.customer_whatsapp,
                name: updatedOrder.customer_name,
                status: updatedOrder.status,
                type: updatedOrder.type,
                total: updatedOrder.total
            });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/orders/:id', authAdmin, async (req, res) => {
    try {
        await run(`DELETE FROM orders WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/items', authAdmin, async (req, res) => {
    const { category, name, price } = req.body;
    try {
        await run(`INSERT INTO items (category, name, price) VALUES (?, ?, ?)`, [category, name, price]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/items/:id', authAdmin, async (req, res) => {
    const { category, name, price, active } = req.body;
    try {
        await run(`UPDATE items SET category = ?, name = ?, price = ?, active = ? WHERE id = ?`, 
            [category, name, price, active, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/settings', authAdmin, async (req, res) => {
    const { delivery_fee, webhook_url, is_open, unavailable_flavors } = req.body;
    try {
        await run(`UPDATE settings SET value = ? WHERE key = 'delivery_fee'`, [delivery_fee]);
        await run(`INSERT INTO settings (key, value) VALUES ('webhook_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [webhook_url]);
        await run(`INSERT INTO settings (key, value) VALUES ('is_open', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [is_open]);
        await run(`INSERT INTO settings (key, value) VALUES ('unavailable_flavors', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify(unavailable_flavors)]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = 3002;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
