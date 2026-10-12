**English** · [Русский](./README.ru.md)

# @hlf-core/transport-common

> TypeScript library with the common Hyperledger Fabric transport protocol: request and response envelopes, signatures, commands

[![npm version](https://img.shields.io/npm/v/@hlf-core/transport-common.svg)](https://www.npmjs.com/package/@hlf-core/transport-common)
[![Docs](https://img.shields.io/badge/docs-hlf.gnosisai.ru-1f6feb)](https://hlf.gnosisai.ru/docs/packages/transport-common)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

Full documentation: https://hlf.gnosisai.ru/docs/packages/transport-common

The shared part of the transport between the client and the chaincode: the format of the request and response envelopes, command options with a signature, the base command class, and the protocol service constants.

The package is used by both sides — the client side (`@hlf-core/transport`) and the chaincode side (`@hlf-core/transport-chaincode`) — and contains only what must match between sender and receiver. It depends on neither `fabric-network` nor `fabric-shim`.

## Table of Contents

- [Overview](#overview)
  - [Key Features](#key-features)
- [Installation](#installation)
  - [Dependencies](#dependencies)
- [How the Transport Works](#how-the-transport-works)
  - [Single Entry Point](#single-entry-point)
  - [Command Path](#command-path)
  - [Signature and Nonce](#signature-and-nonce)
  - [Read and Write Commands](#read-and-write-commands)
  - [Events](#events)
- [API Documentation](#api-documentation)
  - [Protocol Constants](#protocol-constants)
  - [TransportFabricCommandAsync](#transportfabriccommandasync)
  - [TransportFabricCommandOptions](#transportfabriccommandoptions)
  - [TransportFabricRequestPayload](#transportfabricrequestpayload)
  - [TransportFabricResponsePayload](#transportfabricresponsepayload)
  - [NonceGetCommand](#noncegetcommand)
  - [Chaincode Metadata](#chaincode-metadata)
- [Usage Examples](#usage-examples)
- [Project Structure](#project-structure)
- [Related Packages](#related-packages)

## Overview

Interaction with the chaincode in this ecosystem is built not around a set of contract functions, but around a single one: every command is wrapped in an envelope and sent through a single method. What exactly was invoked is determined by the `name` field inside the envelope, not by the name of a chaincode function.

`@hlf-core/transport-common` describes this envelope on both sides: how it is serialized by the client, how it is parsed and verified by the chaincode, and what is returned back. As long as both sides use the same package, the protocol cannot drift apart.

### Key Features

- **Request envelope** — `TransportFabricRequestPayload` with parsing, validation, and handling of default values
- **Response envelope** — `TransportFabricResponsePayload`, carrying a result and an error in the same way
- **Options with a signature** — `TransportFabricCommandOptions` adds a user identifier and a cryptographic signature to the standard options
- **Base command class** — `TransportFabricCommandAsync` with an `isReadonly` flag
- **Replay protection** — `NonceGetCommand` for retrieving the user's current nonce
- **Chaincode metadata** — `ChaincodeMetadataGetCommand`, the operating mode, and batch processing settings
- **Protocol constants** — the names of the method, the event, and the batch command, shared by both sides

## Installation

```bash
npm install @hlf-core/transport-common
```

### Dependencies

```json
{
    "@ts-core/common": "~3.0.53"
}
```

The package ships in two builds — ESM (`./esm/public-api.js`) and CommonJS (`./cjs/public-api.js`); the choice is made automatically through the `exports` field.

## How the Transport Works

### Single Entry Point

All commands go through a single chaincode function:

```ts
export const TRANSPORT_FABRIC_METHOD = 'transportFabricExecute';
```

The client creates a transaction with exactly this name and passes exactly one parameter — the serialized request envelope. On input, the chaincode validates both:

```ts
if (item.fcn !== TRANSPORT_FABRIC_METHOD) {
    throw new TransportInvalidDataError(`Invalid payload: function must be "${TRANSPORT_FABRIC_METHOD}"`, item.fcn);
}
if (item.params.length !== 1) {
    throw new TransportInvalidDataError(`Invalid payload: params length must be 1`, item.params.length);
}
```

Thanks to this, adding a new command requires neither changing the contract nor reinstalling the chaincode with a new set of functions — it is enough to register a handler by the command name.

### Command Path

```
client                                          chaincode
──────                                          ─────────
new SomeCommand(request)
   │
   ├─ createRequestPayload()
   │     id, name, request, options, isReadonly, isNeedReply
   │
   ├─ clear()  ──────── removes default values
   │
   └─ transaction(TRANSPORT_FABRIC_METHOD).submit(payload)
                          │
                          └──────────────►  TransportFabricRequestPayload.parse()
                                               ├─ check the function name and the number of parameters
                                               ├─ setDefaultOptions() — restore defaults
                                               ├─ ValidateUtil.validate()
                                               ├─ check the signature and nonce
                                               └─ run the command handler
                                                        │
   TransportFabricResponsePayload.parse()  ◄────────────┘
      id, response: result or error
```

Note the `clear()` / `setDefaultOptions()` pair. Before sending, all values that match the defaults are stripped from the envelope, and they are restored on the receiver. This reduces the size of what goes into the ledger: there is no point in storing default values in the block, and they can be restored deterministically.

A special case is the signature algorithm: `Ed25519` is treated as the default and is not transmitted over the network at all.

```ts
// before sending
if (!_.isNil(options.signature) && options.signature.algorithm === TransportCryptoManagerEd25519.ALGORITHM) {
    delete options.signature.algorithm;
}

// on the receiver
if (!_.isNil(options.signature) && _.isNil(options.signature.algorithm)) {
    options.signature.algorithm = TransportCryptoManagerEd25519.ALGORITHM;
}
```

### Signature and Nonce

Fabric authenticates the organization on whose behalf the transaction is sent, but not the end user of the application. For this reason the envelope carries its own signature:

```ts
export interface ITransportFabricCommandOptions extends ITransportCommandOptions {
    userId?: string;
    signature?: ISignature;
}
```

The signature contains a value, an algorithm, a public key, and a `nonce`. The chaincode verifies it on its own: it finds a crypto manager by the algorithm, checks the command signature, and separately checks the `nonce` — it must be a numeric string and strictly greater than the previous value stored for this user. This way a resend of a previously signed envelope is rejected.

The current value is requested with the `NonceGetCommand` command — the client takes it, increments it, and signs the next command.

### Read and Write Commands

The `isReadonly` flag determines the behavior on both sides.

On the client it selects the way of sending:

```ts
let method = payload.isReadonly ? transaction.evaluate : transaction.submit;
```

`evaluate` runs the command on a peer without creating a transaction — the result is returned, but nothing ends up in the ledger. `submit` performs the full cycle with endorsement and a write.

On the chaincode side the same flag decides the fate of the nonce:

```ts
if (!payload.isReadonly) {
    await stub.putStateRaw(key, signature.nonce);
}
```

For a read command the nonce is checked but not saved — otherwise the request would change state, which `evaluate` cannot do.

From this follows a practical rule: a command marked `isReadonly` must not change state, and a command that changes state must not be readonly.

### Events

Chaincode events are delivered under a single common name:

```ts
export const TRANSPORT_CHAINCODE_EVENT = 'transportFabricEvent';
```

The block parser on the client distinguishes transport events from the rest by exactly this name and parses their content as transport events.

A separate name is reserved for batch processing:

```ts
export const TRANSPORT_FABRIC_COMMAND_BATCH_NAME = 'transportFabricBatch';
```

By this name, the transaction containing a batch of commands is located in the block.

## API Documentation

### Protocol Constants

| Constant | Value | Purpose |
|---|---|---|
| `TRANSPORT_FABRIC_METHOD` | `transportFabricExecute` | the single chaincode function through which all commands pass |
| `TRANSPORT_CHAINCODE_EVENT` | `transportFabricEvent` | the chaincode event name for transport events |
| `TRANSPORT_FABRIC_COMMAND_BATCH_NAME` | `transportFabricBatch` | the name of the batch processing command |

### TransportFabricCommandAsync

The base class for a command that expects a response.

```ts
export class TransportFabricCommandAsync<U, V> extends TransportCommandAsync<U, V> {
    public isReadonly: boolean;

    constructor(name: string, request?: U, id?: string, isReadonly: boolean = false);
}
```

`U` is the request type, `V` is the response type. By default a command is considered to change state; `isReadonly` must be specified explicitly.

### TransportFabricCommandOptions

Command options extended with user data.

```ts
export class TransportFabricCommandOptions extends TransportCommandOptions implements ITransportFabricCommandOptions {
    @IsString() @IsOptional()
    userId?: string;

    @IsOptional() @Type(() => Signature) @ValidateNested()
    signature?: Signature;
}
```

It inherits the standard `@ts-core/common` options (timeout, number of retries, priority) and adds `userId` and `signature`. The fields are annotated with `class-validator` decorators, so the envelope is validated on the receiver as a whole, together with the nested signature.

### TransportFabricRequestPayload

The request envelope.

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

| Field | Purpose |
|---|---|
| `id` | the command identifier, used to match the response |
| `name` | the command name — determines which handler will be invoked |
| `request` | the command payload |
| `options` | the options together with the signature and the user identifier |
| `isReadonly` | the command does not change state |
| `isNeedReply` | the sender expects a response |

#### `parse(item: StubFunctionAndParameters, isNeedSetDefaultOptions: boolean)`

Parses a chaincode invocation into an envelope. It checks the function name and the number of parameters, deserializes the content, restores default values if necessary, and validates the result. On any problem it throws `TransportInvalidDataError` with the original content in the details.

```ts
let payload = TransportFabricRequestPayload.parse({ fcn, params }, true);
```

#### `setDefaultOptions(payload)`

Restores the default options, including the `Ed25519` signature algorithm. Applied on the receiver.

#### `clearDefaultOptions(options)` and `clear(payload)`

The reverse operation: it removes from the envelope everything that matches the defaults, and `clear` additionally removes the options entirely if they are empty after the cleanup. Applied before sending, so as not to store predictable values in the ledger.

### TransportFabricResponsePayload

The response envelope.

```ts
export interface ITransportFabricResponsePayload<V = any> {
    id: string;
    response?: V | ExtendedError;
}
```

A successful result and an error occupy the same field — the receiving side distinguishes them by type. Thanks to this, a chaincode error reaches the client as an object with a code and details, rather than as a string in the exception text.

#### Constructor `new TransportFabricResponsePayload(command?)`

Builds a response from an executed command: it takes its `id` and, for an asynchronous command, puts either the data or the error into `response`.

```ts
this.response = _.isNil(command.error) ? command.data : command.error;
```

#### `parse(buffer: Buffer)`

Parses a response from a buffer. An empty buffer and corrupted content produce `TransportInvalidDataError`.

#### `fromError(id: string, error: ExtendedError)`

Builds an error response for the case where the command could not even be created — for example, the envelope failed to parse and the `id` is known, but there is no command object yet.

### NonceGetCommand

The command for retrieving the user's current nonce.

```ts
export class NonceGetCommand extends TransportFabricCommandAsync<string, string> {
    public static readonly NAME = 'NonceGetCommand';

    constructor(uid: UID);
}
```

Marked as readonly: the value is only read. The client requests it before signing a command that changes state.

### Chaincode Metadata

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

`ChaincodeMetadataGetCommand` is a readonly command that returns this metadata. From it the client learns the chaincode name, its operating mode, and the batch processing settings: the command accumulation interval and the key with which the batch is signed.

The command is parameterized by the metadata type, so a specific project can extend the structure with its own fields:

```ts
class MyMetadata implements IChaincodeMetadata { ... }
let command = new ChaincodeMetadataGetCommand<MyMetadata>();
```

## Usage Examples

### Declaring a Command

```ts
import { TransportFabricCommandAsync } from '@hlf-core/transport-common';

export interface IUserAddDto {
    name: string;
    publicKey: string;
}

export class UserAddCommand extends TransportFabricCommandAsync<IUserAddDto, IUser> {
    public static readonly NAME = 'UserAdd';

    constructor(request: IUserAddDto) {
        super(UserAddCommand.NAME, request);   // changes state — submit
    }
}
```

### A Read Command

```ts
export class UserGetCommand extends TransportFabricCommandAsync<string, IUser> {
    public static readonly NAME = 'UserGet';

    constructor(uid: string) {
        super(UserGetCommand.NAME, uid, null, true);   // readonly — evaluate
    }
}
```

The fourth argument is `isReadonly`. A mistake here is costly in both directions: a readonly command trying to write state will not be able to do so, while an ordinary read command will create transactions in the ledger on every request.

### Parsing a Request on the Chaincode Side

```ts
import { TransportFabricRequestPayload } from '@hlf-core/transport-common';

let payload = TransportFabricRequestPayload.parse(stub.getFunctionAndParameters(), true);

console.log(payload.name);              // the command name
console.log(payload.options.userId);    // on whose behalf
console.log(payload.options.signature); // the signature with nonce
```

### Building a Response

```ts
import { TransportFabricResponsePayload } from '@hlf-core/transport-common';

// from an executed command
let response = new TransportFabricResponsePayload(command);

// from an error, when the command could not be created
let failure = TransportFabricResponsePayload.fromError(payload.id, new ExtendedError('Invalid request'));
```

### Saving Envelope Size

```ts
let payload = new TransportFabricRequestPayload();
payload.id = command.id;
payload.name = command.name;
payload.request = command.request;
payload.options = options;

TransportFabricRequestPayload.clear(payload);   // remove defaults before sending
```

After `clear` the envelope contains only what actually differs from the default values. The receiver will restore the rest on its own.

## Project Structure

```
src/
├── constants.ts                          names of the method, event, and batch command
├── public-api.ts                         the package's public API
├── ITransportFabricCommandOptions.ts     the options interface with a signature
├── TransportFabricCommandOptions.ts      the options implementation with validation
├── TransportFabricCommandAsync.ts        the base command with isReadonly
├── ITransportFabricRequestPayload.ts     the request envelope interface
├── TransportFabricRequestPayload.ts      parsing, validation, defaults
├── ITransportFabricResponsePayload.ts    the response envelope interface
├── TransportFabricResponsePayload.ts     building a response from a command or an error
├── nonce/
│   ├── NonceGetCommand.ts                retrieving the user's nonce
│   └── index.ts
└── metadata/
    ├── ChaincodeMode.ts                  the chaincode operating mode
    ├── IChaincodeMetadata.ts             metadata and batch processing settings
    ├── ChaincodeMetadataGetCommand.ts    the command for retrieving metadata
    └── index.ts
```

## Related Packages

| Package | Role |
|---|---|
| [@hlf-core/transport](https://www.npmjs.com/package/@hlf-core/transport) | the client side: sending commands, parsing blocks and events |
| [@hlf-core/transport-chaincode](https://www.npmjs.com/package/@hlf-core/transport-chaincode) | the chaincode side: receiving commands, verifying the signature, running handlers |
| [@hlf-core/common](https://www.npmjs.com/package/@hlf-core/common) | the ecosystem's base classes: state keys, identifiers, crypto keys |

## License

ISC

## Author

**Renat Gubaev**
- Email: renat.gubaev@gmail.com
- GitHub: [@ManhattanDoctor](https://github.com/ManhattanDoctor)

## Links

- [GitHub Repository](https://github.com/ManhattanDoctor/hlf-core-transport-common)
- [NPM Package](https://www.npmjs.com/package/@hlf-core/transport-common)
- [Issue Tracker](https://github.com/ManhattanDoctor/hlf-core-transport-common/issues)
- [Hyperledger Fabric Documentation](https://hyperledger-fabric.readthedocs.io/)

## Support

If you found a bug or have a suggestion for improvement, please create an issue in [GitHub Issues](https://github.com/ManhattanDoctor/hlf-core-transport-common/issues).
