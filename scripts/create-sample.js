const fs = require('fs');
const path = require('path');
const { DatabaseManager } = require('../src/database');

const outputDir = path.join(__dirname, '..', 'sample');
const output = path.join(outputDir, 'sample-store.db');
fs.mkdirSync(outputDir, { recursive: true });
if (fs.existsSync(output)) fs.unlinkSync(output);
const manager = new DatabaseManager();
manager.open(output, { create: true });
manager.runSql(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, city TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL, stock INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, total REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', ordered_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (customer_id) REFERENCES customers(id));
    CREATE INDEX idx_orders_customer ON orders(customer_id);
    CREATE VIEW active_orders AS SELECT o.id, c.name AS customer, o.total, o.status, o.ordered_at FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.status != 'cancelled';
    INSERT INTO customers (name, email, city) VALUES ('Aarav Patel', 'aarav@example.com', 'Mumbai'), ('Ananya Das', 'ananya@example.com', 'Bhubaneswar'), ('Rohan Sharma', 'rohan@example.com', 'Delhi');
    INSERT INTO products (name, price, stock) VALUES ('Mechanical Keyboard', 5499, 18), ('USB-C Dock', 3299, 31), ('Monitor Arm', 2199, 12);
    INSERT INTO orders (customer_id, total, status) VALUES (1, 5499, 'paid'), (2, 3299, 'pending'), (3, 7698, 'shipped');
`);
manager.close();
console.log(`Created ${output}`);
