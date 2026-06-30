# «На Панелях» Hiatus Chart

Интерактивная недельная карта выпусков и пауз подкаста «На Панелях» по данным публичной Google-таблицы. Вторая страница собирает каталог обозреваемых комиксов и привязки к выпускам.

## Запуск

```sh
npm run build
npm run dev
```

Откройте <http://localhost:4173>.

Основной календарь находится на <http://localhost:4173/>. Каталог комиксов — на <http://localhost:4173/comics>.

## Обновление данных

```sh
npm run sync
```

Команда объединяет лист `gid=0` с RSS-фидом Boosty, добавляет отсутствующие в таблице записи и обновляет `data/episodes.js`. Записи с пометками «сырой звук», «сырая версия» и «сырая запись» исключаются.

Адрес фида передаётся через переменную окружения:

```bash
BOOSTY_RSS_URL="$PRIVATE_FEED_URL" npm run sync
```

Если один из источников отвечает медленно, синхронизацию можно повторить из локально сохранённых файлов:

```sh
SYNC_SHEET_FILE=/path/to/sheet.csv SYNC_RSS_FILE=/path/to/feed.xml npm run sync
```

## Обновление каталога комиксов

```sh
npm run sync:comics
```

Команда читает только публичную Google-таблицу, обновляет структурные заявки внутри `data/episodes.js` и пересобирает `data/comics.js`. Значения с ` + ` считаются несколькими произведениями, кроме `The Wicked + The Divine`. Реально объединённые ячейки заявок помечаются как «Общая заявка», а одиночные обычные ячейки остаются за своим заявителем.

У каждой темы есть тип обсуждения: `comic`, `movie`, `series` или `videogame`. Страница каталога показывает только записи с типом `comic`; остальные типы сохраняются в данных, но не попадают в таблицу комиксов.

Каталог комиксов специально отделяет подтверждённые данные о ранах от списка обсуждений: издательство, авторы, колористы и год старта остаются со статусом `needs-review`, пока для них не добавлены публичные источники.

## Обогащение данных через League of Comic Geeks

```sh
npm run enrich:comics
```

Команда использует тот же поиск серий, что и библиотека `alistairjcbrown/leagueofcomicgeeks`, затем пытается открыть найденную страницу на League of Comic Geeks и заполнить `publisher`, `writers`, `artists`, `colorists` и ссылку-источник. По умолчанию обрабатывается 25 записей за запуск.

Полезные переменные:

```sh
LOCG_LIMIT=10 npm run enrich:comics
LOCG_OFFSET=50 LOCG_LIMIT=25 npm run enrich:comics
LOCG_FORCE=1 npm run enrich:comics
LOCG_COOKIE_FILE=.secrets/locg-cookies.txt LOCG_FORCE=1 npm run enrich:comics
```

Сырые ответы и отчет сохраняются в `.cache/locg`. Если сайт возвращает Cloudflare challenge, команда завершает текущий проход без порчи каталога.

## Обогащение данных через Comic Vine

```sh
npm run enrich:comicvine
```

Команда использует официальный Comic Vine API: ищет `volume`, затем берет издательство, год старта, первый выпуск и авторские кредиты. API-ключ читается из `.secrets/comicvine-api-key.txt` или из переменной `COMICVINE_API_KEY`.

Полезные переменные:

```sh
COMICVINE_LIMIT=25 npm run enrich:comicvine
COMICVINE_OFFSET=100 COMICVINE_LIMIT=25 npm run enrich:comicvine
COMICVINE_RETRY_REVIEW=1 COMICVINE_LIMIT=100 npm run enrich:comicvine
COMICVINE_FORCE=1 npm run enrich:comicvine
COMICVINE_API_KEY_FILE=.secrets/comicvine-api-key.txt npm run enrich:comicvine
```

Сырые ответы и отчет сохраняются в `.cache/comicvine`. Если API возвращает rate limit, подождите перед следующим запуском.

## Статическая сборка

```sh
npm run build
```

Готовые файлы появятся в папке `dist` и могут быть опубликованы на GitHub Pages или любом статическом хостинге.
