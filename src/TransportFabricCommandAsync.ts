import { TransportCommandAsync } from "@ts-core/common";

export class TransportFabricCommandAsync<U, V> extends TransportCommandAsync<U, V> {
    // --------------------------------------------------------------------------
    //
    //  Properties
    //
    // --------------------------------------------------------------------------

    public isReadonly: boolean;

    // --------------------------------------------------------------------------
    //
    //  Constructor
    //
    // --------------------------------------------------------------------------

    constructor(name: string, request?: U, id?: string, isReadonly: boolean = false) {
        super(name, request, id);
        this.isReadonly = isReadonly;
    }
}