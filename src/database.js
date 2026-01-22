const Database = require('better-sqlite3');
const path = require('path');

// Создаём/открываем базу данных
const db = new Database(path.join(__dirname, '../data/users.db'));

// Инициализация таблиц
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    has_participated BOOLEAN DEFAULT 0,
    warmup_stage INTEGER DEFAULT 0,
    last_warmup_at DATETIME,
    is_blocked BOOLEAN DEFAULT 0,
    source TEXT
  );
  
  CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
  CREATE INDEX IF NOT EXISTS idx_users_warmup ON users(warmup_stage, has_participated, is_blocked);
`);

module.exports = {
    // Добавить или обновить пользователя
    upsertUser(telegramId, userData) {
        const stmt = db.prepare(`
      INSERT INTO users (telegram_id, username, first_name, last_name, source)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name
    `);

        return stmt.run(
            telegramId,
            userData.username || null,
            userData.first_name || null,
            userData.last_name || null,
            userData.source || null
        );
    },

    // Получить пользователя по Telegram ID
    getUser(telegramId) {
        const stmt = db.prepare('SELECT * FROM users WHERE telegram_id = ?');
        return stmt.get(telegramId);
    },

    // Отметить что пользователь участвует
    markAsParticipated(telegramId) {
        const stmt = db.prepare('UPDATE users SET has_participated = 1 WHERE telegram_id = ?');
        return stmt.run(telegramId);
    },

    // Обновить стадию догрева
    updateWarmupStage(telegramId, stage) {
        const stmt = db.prepare(`
      UPDATE users SET warmup_stage = ?, last_warmup_at = CURRENT_TIMESTAMP 
      WHERE telegram_id = ?
    `);
        return stmt.run(stage, telegramId);
    },

    // Отметить пользователя как заблокировавшего бота
    markAsBlocked(telegramId) {
        const stmt = db.prepare('UPDATE users SET is_blocked = 1 WHERE telegram_id = ?');
        return stmt.run(telegramId);
    },

    // Получить пользователей для догрева
    getUsersForWarmup(stage, hoursAgo) {
        const stmt = db.prepare(`
      SELECT * FROM users 
      WHERE has_participated = 0 
        AND is_blocked = 0 
        AND warmup_stage = ?
        AND datetime(registered_at, '+' || ? || ' hours') <= datetime('now')
    `);
        return stmt.all(stage, hoursAgo);
    },

    // Статистика
    getStats() {
        const total = db.prepare('SELECT COUNT(*) as count FROM users').get();
        const participated = db.prepare('SELECT COUNT(*) as count FROM users WHERE has_participated = 1').get();
        const blocked = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_blocked = 1').get();

        return {
            total: total.count,
            participated: participated.count,
            blocked: blocked.count,
            pending: total.count - participated.count - blocked.count
        };
    },

    // Получить всех активных пользователей для рассылки
    getAllActiveUsers() {
        const stmt = db.prepare('SELECT * FROM users WHERE is_blocked = 0');
        return stmt.all();
    }
};
