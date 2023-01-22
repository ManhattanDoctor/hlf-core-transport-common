import { TransportCommandAsync } from "@ts-core/common";
import { IChaincodeMetadata } from "./IChaincodeMetadata";


export class ChaincodeMetadataGetCommand<V extends IChaincodeMetadata = IChaincodeMetadata> extends TransportCommandAsync<void, V> {
    // --------------------------------------------------------------------------
    //
    //  Public Static Properties
    //
    // --------------------------------------------------------------------------

    public static readonly NAME = 'ChaincodeMetadataGetCommand';

    // --------------------------------------------------------------------------
    //
    //  Constructor
    //
    // --------------------------------------------------------------------------

    constructor() {
        super(ChaincodeMetadataGetCommand.NAME);
    }
}