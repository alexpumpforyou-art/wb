const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const db = require('./database');
const { startWarmupScheduler, getGiveawayKeyboard } = require('./warmup');

// Проверка токена
if (!config.botToken) {
    console.error('❌ BOT_TOKEN не указан в .env файле!');
    process.exit(1);
}

// Главная функция запуска
async function main() {
    // Инициализируем базу данных
    await db.initDatabase();

    // Создаём бота
    const bot = new TelegramBot(config.botToken, { polling: true });

    console.log('🤖 Бот запущен!');

    // ========== ОБРАБОТЧИК /start ==========
    bot.onText(/\/start(.*)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const startParam = match[1] ? match[1].trim() : null;

        // Сохраняем/обновляем пользователя
        db.upsertUser(userId, {
            username: msg.from.username,
            first_name: msg.from.first_name,
            last_name: msg.from.last_name,
            source: startParam // Параметр после /start (для отслеживания источника рекламы)
        });

        // Проверяем, участвует ли уже
        const user = db.getUser(userId);

        if (user && user.has_participated) {
            // Уже участвует
            await bot.sendMessage(chatId, config.messages.alreadyParticipating, {
                parse_mode: 'Markdown'
            });
        } else {
            // Новый пользователь или ещё не участвует
            if (config.welcomeImage) {
                // Отправляем фото с текстом
                await bot.sendPhoto(chatId, config.welcomeImage, {
                    caption: config.messages.welcome,
                    parse_mode: 'Markdown',
                    reply_markup: getGiveawayKeyboard()
                });
            } else {
                // Только текст
                await bot.sendMessage(chatId, config.messages.welcome, {
                    parse_mode: 'Markdown',
                    reply_markup: getGiveawayKeyboard()
                });
            }
        }

        console.log(`[START] Пользователь ${userId} (${msg.from.username || 'без username'}), источник: ${startParam || 'прямой'}`);
    });

    // ========== ОБРАБОТЧИК /help ==========
    bot.onText(/\/help/, async (msg) => {
        await bot.sendMessage(msg.chat.id, config.messages.help, {
            parse_mode: 'Markdown'
        });
    });

    // ========== ОБРАБОТЧИК /status ==========
    bot.onText(/\/status/, async (msg) => {
        const user = db.getUser(msg.from.id);

        let statusMessage;

        if (!user) {
            statusMessage = '❌ Ты ещё не зарегистрирован. Нажми /start';
        } else if (user.has_participated) {
            statusMessage = `✅ *Ты участвуешь в розыгрыше!*

📅 Регистрация: ${new Date(user.registered_at).toLocaleDateString('ru-RU')}

⏰ Ожидай результаты в воскресенье в 20:00`;
        } else {
            statusMessage = `⚠️ *Ты зарегистрирован, но ещё не участвуешь!*

Нажми кнопку ниже, чтобы принять участие в розыгрыше:`;
        }

        await bot.sendMessage(msg.chat.id, statusMessage, {
            parse_mode: 'Markdown',
            reply_markup: user && !user.has_participated ? getGiveawayKeyboard() : undefined
        });
    });

    // ========== ОБРАБОТЧИК /stats (только для админа) ==========
    bot.onText(/\/stats/, async (msg) => {
        // Замените на ваш Telegram ID
        const adminIds = [123456789]; // ЗАМЕНИТЬ НА СВОЙ ID!

        if (!adminIds.includes(msg.from.id)) {
            return;
        }

        const stats = db.getStats();

        const statsMessage = `📊 *Статистика бота*

👥 Всего пользователей: ${stats.total}
✅ Участвуют в розыгрыше: ${stats.participated}
⏳ Ожидают участия: ${stats.pending}
🚫 Заблокировали бота: ${stats.blocked}

📈 Конверсия: ${stats.total > 0 ? ((stats.participated / stats.total) * 100).toFixed(1) : 0}%`;

        await bot.sendMessage(msg.chat.id, statsMessage, { parse_mode: 'Markdown' });
    });

    // ========== ОБРАБОТЧИК ДАННЫХ ИЗ WEBAPP ==========
    bot.on('web_app_data', async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        try {
            const data = JSON.parse(msg.web_app_data.data);

            // Отмечаем участие
            db.markAsParticipated(userId);

            await bot.sendMessage(chatId, `🎉 *Поздравляем!*

Ты успешно зарегистрировался в розыгрыше!

🎁 Твой номер участника: *#${userId.toString().slice(-6).padStart(6, '0')}*

⏰ Результаты будут объявлены в воскресенье в 20:00 по Москве.

🍀 Удачи!`, {
                parse_mode: 'Markdown'
            });

            console.log(`[WEBAPP] Пользователь ${userId} завершил регистрацию`);

        } catch (error) {
            console.error('[WEBAPP] Ошибка обработки данных:', error);
        }
    });

    // ========== ОБРАБОТКА ОШИБОК ==========
    bot.on('polling_error', (error) => {
        console.error('[ERROR] Polling error:', error.message);
    });

    // ========== ЗАПУСК СИСТЕМЫ ДОГРЕВА ==========
    startWarmupScheduler(bot);

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n👋 Остановка бота...');
        bot.stopPolling();
        process.exit(0);
    });
}

// Запуск
main().catch(err => {
    console.error('Ошибка запуска:', err);
    process.exit(1);
});
