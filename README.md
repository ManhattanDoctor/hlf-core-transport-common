# @hlf-core/transport-common

> TypeScript библиотека с общим протоколом транспорта Hyperledger Fabric: конверты запроса и ответа, подписи, команды

[![npm version](https://img.shields.io/npm/v/@hlf-core/transport-common.svg)](https://www.npmjs.com/package/@hlf-core/transport-common)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

Общая часть транспорта между клиентом и chaincode: формат конвертов запроса и ответа, опции команды с подписью, базовый класс команд и служебные константы протокола.

Пакет используется обеими сторонами — клиентской (`@hlf-core/transport`) и chaincode (`@hlf-core/transport-chaincode`), — и содержит только то, что должно совпадать у отправителя и получателя. Он не зависит ни от `fabric-network`, ни от `fabric-shim`.

## Содержание

- [Описание](#описание)
  - [Основные возможности](#основные-возможности)
- [Установка](#установка)
  - [Зависимости](#зависимости)
- [Как работает транспорт](#как-работает-транспорт)
  - [Единая точка входа](#единая-точка-входа)
  - [Путь команды](#путь-команды)
  - [Подпись и nonce](#подпись-и-nonce)
  - [Команды на чтение и на запись](#команды-на-чтение-и-на-запись)
  - [События](#события)
- [API документация](#api-документация)
  - [Константы протокола](#константы-протокола)
  - [TransportFabricCommandAsync](#transportfabriccommandasync)
  - [TransportFabricCommandOptions](#transportfabriccommandoptions)
  - [TransportFabricRequestPayload](#transportfabricrequestpayload)
  - [TransportFabricResponsePayload](#transportfabricresponsepayload)
  - [NonceGetCommand](#noncegetcommand)
  - [Метаданные chaincode](#метаданные-chaincode)
- [Примеры использования](#примеры-использования)
- [Структура проекта](#структура-проекта)
- [Связанные пакеты](#связанные-пакеты)

## Описание

Взаимодействие с chaincode в этой экосистеме построено не на множестве функций контракта, а на одной: любая команда упаковывается в конверт и отправляется через единственный метод. Что именно вызвано, определяет поле `name` внутри конверта, а не имя функции chaincode.

`@hlf-core/transport-common` описывает этот конверт с обеих сторон: как он сериализуется клиентом, как разбирается и проверяется chaincode, и что возвращается обратно. Пока обе стороны используют один и тот же пакет, протокол не может разъехаться.

### Основные возможности

- **Конверт запроса** — `TransportFabricRequestPayload` с разбором, валидацией и работой со значениями по умолчанию
- **Конверт ответа** — `TransportFabricResponsePayload`, одинаково переносящий результат и ошибку
- **Опции с подписью** — `TransportFabricCommandOptions` добавляет к стандартным опциям идентификатор пользователя и криптографическую подпись
- **Базовый класс команд** — `TransportFabricCommandAsync` с признаком `isReadonly`
- **Защита от повтора** — `NonceGetCommand` для получения текущего nonce пользователя
- **Метаданные chaincode** — `ChaincodeMetadataGetCommand`, режим работы и настройки пакетной обработки
- **Константы протокола** — имена метода, события и пакетной команды, общие для обеих сторон

## Установка

```bash
npm install @hlf-core/transport-common
```

### Зависимости

```json
{
    "@ts-core/common": "~3.0.53"
}
```

Пакет поставляется в двух сборках — ESM (`./esm/public-api.js`) и CommonJS (`./cjs/public-api.js`), выбор происходит автоматически через поле `exports`.

## Как работает транспорт

### Единая точка входа

Все команды идут через одну функцию chaincode:

```ts
export const TRANSPORT_FABRIC_METHOD = 'transportFabricExecute';
```

Клиент создаёт транзакцию именно с этим именем и передаёт ровно один параметр — сериализованный конверт запроса. Chaincode на входе проверяет и то, и другое:

```ts
if (item.fcn !== TRANSPORT_FABRIC_METHOD) {
    throw new TransportInvalidDataError(`Invalid payload: function must be "${TRANSPORT_FABRIC_METHOD}"`, item.fcn);
}
if (item.params.length !== 1) {
    throw new TransportInvalidDataError(`Invalid payload: params length must be 1`, item.params.length);
}
```

Благодаря этому добавление новой команды не требует ни изменения контракта, ни переустановки chaincode с новым набором функций — достаточно зарегистрировать обработчик по имени команды.

### Путь команды

```
клиент                                          chaincode
──────                                          ─────────
new SomeCommand(request)
   │
   ├─ createRequestPayload()
   │     id, name, request, options, isReadonly, isNeedReply
   │
   ├─ clear()  ──────── убирает значения по умолчанию
   │
   └─ transaction(TRANSPORT_FABRIC_METHOD).submit(payload)
                          │
                          └──────────────►  TransportFabricRequestPayload.parse()
                                               ├─ проверка имени функции и числа параметров
                                               ├─ setDefaultOptions() — восстановление умолчаний
                                               ├─ ValidateUtil.validate()
                                               ├─ проверка подписи и nonce
                                               └─ выполнение обработчика команды
                                                        │
   TransportFabricResponsePayload.parse()  ◄────────────┘
      id, response: результат либо ошибка
```

Обратите внимание на пару `clear()` / `setDefaultOptions()`. Перед отправкой из конверта вычищаются все значения, совпадающие с умолчаниями, а на приёмнике они восстанавливаются. Это уменьшает размер того, что уходит в леджер: значения по умолчанию хранить в блоке незачем, а восстановить их можно детерминированно.

Частный случай — алгоритм подписи: `Ed25519` считается умолчанием и по сети не передаётся вовсе.

```ts
// перед отправкой
if (!_.isNil(options.signature) && options.signature.algorithm === TransportCryptoManagerEd25519.ALGORITHM) {
    delete options.signature.algorithm;
}

// на приёмнике
if (!_.isNil(options.signature) && _.isNil(options.signature.algorithm)) {
    options.signature.algorithm = TransportCryptoManagerEd25519.ALGORITHM;
}
```

### Подпись и nonce

Fabric аутентифицирует организацию, от имени которой отправлена транзакция, но не конечного пользователя приложения. Поэтому конверт несёт собственную подпись:

```ts
export interface ITransportFabricCommandOptions extends ITransportCommandOptions {
    userId?: string;
    signature?: ISignature;
}
```

Подпись содержит значение, алгоритм, публичный ключ и `nonce`. Chaincode проверяет её сам: находит crypto manager по алгоритму, сверяет подпись команды и отдельно проверяет `nonce` — он обязан быть числовой строкой и строго больше предыдущего значения, сохранённого для этого пользователя. Так повторная отправка ранее подписанного конверта отбрасывается.

Текущее значение запрашивается командой `NonceGetCommand` — клиент берёт его, увеличивает и подписывает следующую команду.

### Команды на чтение и на запись

Признак `isReadonly` определяет поведение на обеих сторонах.

На клиенте он выбирает способ отправки:

```ts
let method = payload.isReadonly ? transaction.evaluate : transaction.submit;
```

`evaluate` выполняет команду на peer без создания транзакции — результат возвращается, но в леджер ничего не попадает. `submit` проводит полный цикл с подтверждением и записью.

На стороне chaincode тот же признак решает судьбу nonce:

```ts
if (!payload.isReadonly) {
    await stub.putStateRaw(key, signature.nonce);
}
```

Для команды на чтение nonce проверяется, но не сохраняется — иначе запрос менял бы состояние, чего `evaluate` сделать не может.

Из этого следует практическое правило: команда, помеченная `isReadonly`, не должна изменять состояние, а команда, изменяющая состояние, обязана быть не readonly.

### События

События chaincode передаются под одним общим именем:

```ts
export const TRANSPORT_CHAINCODE_EVENT = 'transportFabricEvent';
```

Парсер блоков на клиенте отличает транспортные события от прочих именно по нему и разбирает их содержимое как события транспорта.

Отдельное имя зарезервировано для пакетной обработки:

```ts
export const TRANSPORT_FABRIC_COMMAND_BATCH_NAME = 'transportFabricBatch';
```

По нему в блоке находится транзакция, содержащая пакет команд.

## API документация

### Константы протокола

| Константа | Значение | Назначение |
|---|---|---|
| `TRANSPORT_FABRIC_METHOD` | `transportFabricExecute` | единственная функция chaincode, через которую проходят все команды |
| `TRANSPORT_CHAINCODE_EVENT` | `transportFabricEvent` | имя события chaincode для событий транспорта |
| `TRANSPORT_FABRIC_COMMAND_BATCH_NAME` | `transportFabricBatch` | имя команды пакетной обработки |

### TransportFabricCommandAsync

Базовый класс команды, ожидающей ответ.

```ts
export class TransportFabricCommandAsync<U, V> extends TransportCommandAsync<U, V> {
    public isReadonly: boolean;

    constructor(name: string, request?: U, id?: string, isReadonly: boolean = false);
}
```

`U` — тип запроса, `V` — тип ответа. По умолчанию команда считается изменяющей состояние; `isReadonly` нужно указывать явно.

### TransportFabricCommandOptions

Опции команды, расширенные данными пользователя.

```ts
export class TransportFabricCommandOptions extends TransportCommandOptions implements ITransportFabricCommandOptions {
    @IsString() @IsOptional()
    userId?: string;

    @IsOptional() @Type(() => Signature) @ValidateNested()
    signature?: Signature;
}
```

Наследует стандартные опции `@ts-core/common` (таймаут, число попыток, приоритет) и добавляет `userId` и `signature`. Поля размечены декораторами `class-validator`, поэтому конверт проверяется на приёмнике целиком, вместе с вложенной подписью.

### TransportFabricRequestPayload

Конверт запроса.

```ts
export interface ITransportFabricRequestPayload<U = any> {
    id: string;
    name: string;
    request?: U;
    options?: ITransportFabricCommandOptions;

    isReadonly?: boolean;
    isNeedReply?: boolean;
}
```

| Поле | Назначение |
|---|---|
| `id` | идентификатор команды, по нему сопоставляется ответ |
| `name` | имя команды — определяет, какой обработчик будет вызван |
| `request` | полезная нагрузка команды |
| `options` | опции вместе с подписью и идентификатором пользователя |
| `isReadonly` | команда не изменяет состояние |
| `isNeedReply` | отправитель ожидает ответ |

#### `parse(item: StubFunctionAndParameters, isNeedSetDefaultOptions: boolean)`

Разбирает вызов chaincode в конверт. Проверяет имя функции и число параметров, десериализует содержимое, при необходимости восстанавливает значения по умолчанию и валидирует результат. При любой проблеме бросает `TransportInvalidDataError` с исходным содержимым в деталях.

```ts
let payload = TransportFabricRequestPayload.parse({ fcn, params }, true);
```

#### `setDefaultOptions(payload)`

Восстанавливает опции по умолчанию, включая алгоритм подписи `Ed25519`. Применяется на приёмнике.

#### `clearDefaultOptions(options)` и `clear(payload)`

Обратная операция: убирает из конверта всё, что совпадает с умолчаниями, а `clear` дополнительно удаляет опции целиком, если после очистки они пусты. Применяется перед отправкой, чтобы не хранить в леджере предсказуемые значения.

### TransportFabricResponsePayload

Конверт ответа.

```ts
export interface ITransportFabricResponsePayload<V = any> {
    id: string;
    response?: V | ExtendedError;
}
```

Успешный результат и ошибка занимают одно и то же поле — сторона-получатель различает их по типу. Благодаря этому ошибка chaincode доходит до клиента как объект с кодом и деталями, а не как строка в тексте исключения.

#### Конструктор `new TransportFabricResponsePayload(command?)`

Собирает ответ из выполненной команды: берёт её `id` и для асинхронной команды кладёт в `response` либо данные, либо ошибку.

```ts
this.response = _.isNil(command.error) ? command.data : command.error;
```

#### `parse(buffer: Buffer)`

Разбирает ответ из буфера. Пустой буфер и повреждённое содержимое дают `TransportInvalidDataError`.

#### `fromError(id: string, error: ExtendedError)`

Собирает ответ с ошибкой для случая, когда команду не удалось даже создать — например, конверт не прошёл разбор и `id` известен, а объекта команды ещё нет.

### NonceGetCommand

Команда получения текущего nonce пользователя.

```ts
export class NonceGetCommand extends TransportFabricCommandAsync<string, string> {
    public static readonly NAME = 'NonceGetCommand';

    constructor(uid: UID);
}
```

Помечена как readonly: значение только читается. Клиент запрашивает его перед подписанием команды, изменяющей состояние.

### Метаданные chaincode

```ts
export enum ChaincodeMode {
    INTERNAL = 'INTERNAL',
    EXTERNAL = 'EXTERNAL',
}

export interface IChaincodeMetadata {
    name: string;
    mode?: ChaincodeMode;
    batch?: IChaincodeBatchSettings;
}

export interface IChaincodeBatchSettings {
    timeout: number;
    algorithm?: string;
    publicKey?: string;
}
```

`ChaincodeMetadataGetCommand` — readonly команда, возвращающая эти метаданные. По ним клиент узнаёт имя chaincode, режим его работы и настройки пакетной обработки: интервал накопления команд и ключ, которым подписывается пакет.

Команда параметризуется типом метаданных, поэтому конкретный проект может расширить структуру своими полями:

```ts
class MyMetadata implements IChaincodeMetadata { ... }
let command = new ChaincodeMetadataGetCommand<MyMetadata>();
```

## Примеры использования

### Объявление команды

```ts
import { TransportFabricCommandAsync } from '@hlf-core/transport-common';

export interface IUserAddDto {
    name: string;
    publicKey: string;
}

export class UserAddCommand extends TransportFabricCommandAsync<IUserAddDto, IUser> {
    public static readonly NAME = 'UserAdd';

    constructor(request: IUserAddDto) {
        super(UserAddCommand.NAME, request);   // изменяет состояние — submit
    }
}
```

### Команда на чтение

```ts
export class UserGetCommand extends TransportFabricCommandAsync<string, IUser> {
    public static readonly NAME = 'UserGet';

    constructor(uid: string) {
        super(UserGetCommand.NAME, uid, null, true);   // readonly — evaluate
    }
}
```

Четвёртый аргумент и есть `isReadonly`. Ошибиться здесь дорого в обе стороны: readonly-команда, пытающаяся записать состояние, не сможет этого сделать, а обычная команда на чтение будет создавать транзакции в леджере на каждый запрос.

### Разбор запроса на стороне chaincode

```ts
import { TransportFabricRequestPayload } from '@hlf-core/transport-common';

let payload = TransportFabricRequestPayload.parse(stub.getFunctionAndParameters(), true);

console.log(payload.name);              // имя команды
console.log(payload.options.userId);    // от чьего имени
console.log(payload.options.signature); // подпись с nonce
```

### Формирование ответа

```ts
import { TransportFabricResponsePayload } from '@hlf-core/transport-common';

// из выполненной команды
let response = new TransportFabricResponsePayload(command);

// из ошибки, когда команду создать не удалось
let failure = TransportFabricResponsePayload.fromError(payload.id, new ExtendedError('Invalid request'));
```

### Экономия размера конверта

```ts
let payload = new TransportFabricRequestPayload();
payload.id = command.id;
payload.name = command.name;
payload.request = command.request;
payload.options = options;

TransportFabricRequestPayload.clear(payload);   // убрать умолчания перед отправкой
```

После `clear` конверт содержит только то, что действительно отличается от значений по умолчанию. Приёмник восстановит остальное сам.

## Структура проекта

```
src/
├── constants.ts                          имена метода, события и пакетной команды
├── public-api.ts                         публичный API пакета
├── ITransportFabricCommandOptions.ts     интерфейс опций с подписью
├── TransportFabricCommandOptions.ts      реализация опций с валидацией
├── TransportFabricCommandAsync.ts        базовая команда с isReadonly
├── ITransportFabricRequestPayload.ts     интерфейс конверта запроса
├── TransportFabricRequestPayload.ts      разбор, валидация, умолчания
├── ITransportFabricResponsePayload.ts    интерфейс конверта ответа
├── TransportFabricResponsePayload.ts     сборка ответа из команды или ошибки
├── nonce/
│   ├── NonceGetCommand.ts                получение nonce пользователя
│   └── index.ts
└── metadata/
    ├── ChaincodeMode.ts                  режим работы chaincode
    ├── IChaincodeMetadata.ts             метаданные и настройки пакетной обработки
    ├── ChaincodeMetadataGetCommand.ts    команда получения метаданных
    └── index.ts
```

## Связанные пакеты

| Пакет | Роль |
|---|---|
| [@hlf-core/transport](https://www.npmjs.com/package/@hlf-core/transport) | клиентская сторона: отправка команд, разбор блоков и событий |
| [@hlf-core/transport-chaincode](https://www.npmjs.com/package/@hlf-core/transport-chaincode) | сторона chaincode: приём команд, проверка подписи, выполнение обработчиков |
| [@hlf-core/common](https://www.npmjs.com/package/@hlf-core/common) | базовые классы экосистемы: ключи состояния, идентификаторы, криптоключи |

## Лицензия

ISC © Renat Gubaev
