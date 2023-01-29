import { TransportFabricCommandAsync } from "../TransportFabricCommandAsync";
import { IChaincodeMetadata } from "./IChaincodeMetadata";

export class ChaincodeMetadataGetCommand<V extends IChaincodeMetadata = IChaincodeMetadata> extends TransportFabricCommandAsync<void, V> {
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
        super(ChaincodeMetadataGetCommand.NAME, null, null, true);
    }
}