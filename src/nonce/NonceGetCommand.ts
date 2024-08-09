import { getUid, UID } from "@ts-core/common";
import { TransportFabricCommandAsync } from "../TransportFabricCommandAsync";


export class NonceGetCommand extends TransportFabricCommandAsync<string, string> {
    // --------------------------------------------------------------------------
    //
    //  Public Static Properties
    //
    // --------------------------------------------------------------------------

    public static readonly NAME = 'NonceGetCommand';

    // --------------------------------------------------------------------------
    //
    //  Constructor
    //
    // --------------------------------------------------------------------------

    constructor(uid: UID) {
        super(NonceGetCommand.NAME, getUid(uid), null, true);
    }
}