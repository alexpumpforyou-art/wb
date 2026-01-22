const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/users.db');

let db = null;

// Инициализация базы данных
async function initDatabase() {
    const SQL = await initSqlJs();

    // Попробуем загрузить существующую базу
    try {
        if (fs.existsSync(DB_PATH)) {
            const fileBuffer = fs.readFileSync(DB_PATH);
            db = new SQL.Database(fileBuffer);
        } else {
            db = new SQL.Database();
        }
    } catch (e) {
        db = new SQL.Database();
    }

    // Создаём таблицы
    db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      registered_at TEXT DEFAULT CURRENT_TIMESTAMP,
      has_participated INTEGER DEFAULT 0,
      warmup_stage INTEGER DEFAULT 0,
      last_warmup_at TEXT,
      is_blocked INTEGER DEFAULT 0,
      source TEXT
    )
  `);

    saveDatabase();
    console.log('[DB] База данных инициализирована');
    return db;
}

// Сохранение базы на диск
function saveDatabase() {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);

        // Создаём папку data если не существует
        const dataDir = path.dirname(DB_PATH);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        fs.writeFileSync(DB_PATH, buffer);
    }
}

// Добавить или обновить пользователя
function upsertUser(telegramId, userData) {
    const existing = getUser(telegramId);

    if (existing) {
        db.run(`
      UPDATE users SET username = ?, first_name = ?, last_name = ?
      WHERE telegram_id = ?
    `, [
            userData.username || null,
            userData.first_name || null,
            userData.last_name || null,
            telegramId
        ]);
    } else {
        db.run(`
      INSERT INTO users (telegram_id, username, first_name, last_name, source, registered_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `, [
            telegramId,
            userData.username || null,
            userData.first_name || null,
            userData.last_name || null,
            userData.source || null
        ]);
    }

    saveDatabase();
}

// Получить пользователя по Telegram ID
function getUser(telegramId) {
    const stmt = db.prepare('SELECT * FROM users WHERE telegram_id = ?');
    stmt.bind([telegramId]);

    if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
    }
    stmt.free();
    return null;
}

// Отметить что пользователь участвует
function markAsParticipated(telegramId) {
    db.run('UPDATE users SET has_participated = 1 WHERE telegram_id = ?', [telegramId]);
    saveDatabase();
}

// Обновить стадию догрева
function updateWarmupStage(telegramId, stage) {
    db.run(`
    UPDATE users SET warmup_stage = ?, last_warmup_at = datetime('now')
    WHERE telegram_id = ?
  `, [stage, telegramId]);
    saveDatabase();
}

// Отметить пользователя как заблокировавшего бота
function markAsBlocked(telegramId) {
    db.run('UPDATE users SET is_blocked = 1 WHERE telegram_id = ?', [telegramId]);
    saveDatabase();
}

// Получить пользователей для догрева
function getUsersForWarmup(stage, hoursAgo) {
    const result = [];
    const stmt = db.prepare(`
    SELECT * FROM users 
    WHERE has_participated = 0 
      AND is_blocked = 0 
      AND warmup_stage = ?
      AND datetime(registered_at, '+' || ? || ' hours') <= datetime('now')
  `);
    stmt.bind([stage, hoursAgo]);

    while (stmt.step()) {
        result.push(stmt.getAsObject());
    }
    stmt.free();

    return result;
}

// Статистика
function getStats() {
    const total = db.exec('SELECT COUNT(*) as count FROM users')[0]?.values[0][0] || 0;
    const participated = db.exec('SELECT COUNT(*) as count FROM users WHERE has_participated = 1')[0]?.values[0][0] || 0;
    const blocked = db.exec('SELECT COUNT(*) as count FROM users WHERE is_blocked = 1')[0]?.values[0][0] || 0;

    return {
        total,
        participated,
        blocked,
        pending: total - participated - blocked
    };
}

// Получить всех активных пользователей для рассылки
function getAllActiveUsers() {
    const result = [];
    const stmt = db.prepare('SELECT * FROM users WHERE is_blocked = 0');

    while (stmt.step()) {
        result.push(stmt.getAsObject());
    }
    stmt.free();

    return result;
}

module.exports = {
    initDatabase,
    upsertUser,
    getUser,
    markAsParticipated,
    updateWarmupStage,
    markAsBlocked,
    getUsersForWarmup,
    getStats,
    getAllActiveUsers
};
