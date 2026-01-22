const cron = require('node-cron');
const config = require('./config');
const db = require('./database');

// Функция для получения клавиатуры с кнопкой розыгрыша
function getGiveawayKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: '🎰 Участвовать в розыгрыше',
                    web_app: { url: config.webAppUrl }
                }
            ]
        ]
    };
}

// Отправка сообщения догрева с обработкой ошибок
async function sendWarmupMessage(bot, user, message, stage) {
    try {
        await bot.sendMessage(user.telegram_id, message, {
            parse_mode: 'Markdown',
            reply_markup: getGiveawayKeyboard()
        });

        // Обновляем стадию догрева
        db.updateWarmupStage(user.telegram_id, stage);
        console.log(`[WARMUP] Отправлено сообщение #${stage} пользователю ${user.telegram_id}`);

        return true;
    } catch (error) {
        // Если пользователь заблокировал бота
        if (error.response?.statusCode === 403) {
            db.markAsBlocked(user.telegram_id);
            console.log(`[WARMUP] Пользователь ${user.telegram_id} заблокировал бота`);
        } else {
            console.error(`[WARMUP] Ошибка отправки ${user.telegram_id}:`, error.message);
        }
        return false;
    }
}

// Задержка между сообщениями чтобы не превысить лимиты API
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Обработка догрева для определённой стадии
async function processWarmupStage(bot, stage, hoursAgo, message) {
    const users = db.getUsersForWarmup(stage - 1, hoursAgo);

    if (users.length === 0) {
        return;
    }

    console.log(`[WARMUP] Найдено ${users.length} пользователей для догрева #${stage}`);

    let sent = 0;
    let failed = 0;

    for (const user of users) {
        const success = await sendWarmupMessage(bot, user, message, stage);
        if (success) {
            sent++;
        } else {
            failed++;
        }

        // Задержка 50мс между сообщениями
        await delay(50);
    }

    console.log(`[WARMUP] Стадия #${stage} завершена: отправлено ${sent}, ошибок ${failed}`);
}

// Запуск системы догрева
function startWarmupScheduler(bot) {
    console.log('[WARMUP] Запуск планировщика догрева...');

    // Проверка каждые 5 минут
    cron.schedule('*/5 * * * *', async () => {
        console.log('[WARMUP] Проверка пользователей для догрева...');

        // Догрев #1 - через 1 час после регистрации
        await processWarmupStage(
            bot,
            1,
            config.warmupDelays.first,
            config.messages.warmup1
        );

        // Догрев #2 - через 24 часа
        await processWarmupStage(
            bot,
            2,
            config.warmupDelays.second,
            config.messages.warmup2
        );

        // Догрев #3 - через 72 часа
        await processWarmupStage(
            bot,
            3,
            config.warmupDelays.third,
            config.messages.warmup3
        );
    });

    console.log('[WARMUP] Планировщик запущен (проверка каждые 5 минут)');
}

module.exports = {
    startWarmupScheduler,
    getGiveawayKeyboard
};
