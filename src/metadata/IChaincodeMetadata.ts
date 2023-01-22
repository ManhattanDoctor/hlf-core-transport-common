import { ChaincodeMode } from "./ChaincodeMode";

export interface IChaincodeBatchSettings {
    timeout: number;
    algorithm?: string;
    publicKey?: string;
}

export interface IChaincodeMetadata {
    name: string;
    mode?: ChaincodeMode;
    batch?: IChaincodeBatchSettings;
}