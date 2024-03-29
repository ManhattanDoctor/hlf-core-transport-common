import { IsBoolean, IsOptional, ValidateNested, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ITransportFabricRequestPayload } from './ITransportFabricRequestPayload';
import { TransportFabricCommandOptions } from './TransportFabricCommandOptions';
import * as _ from 'lodash';
import { TransformUtil, Transport, TransportInvalidDataError, ValidateUtil } from '@ts-core/common';
import { TransportCryptoManagerEd25519 } from '@ts-core/common';
import { ITransportFabricCommandOptions } from './ITransportFabricCommandOptions';
import { TRANSPORT_FABRIC_METHOD } from './constants';

export class TransportFabricRequestPayload<U = any> implements ITransportFabricRequestPayload<U> {
    // --------------------------------------------------------------------------
    //
    //  Static Methods
    //
    // --------------------------------------------------------------------------

    public static parse<U = any>(item: StubFunctionAndParameters, isNeedSetDefaultOptions: boolean): ITransportFabricRequestPayload<U> {
        if (item.fcn !== TRANSPORT_FABRIC_METHOD) {
            throw new TransportInvalidDataError(`Invalid payload: function must be "${TRANSPORT_FABRIC_METHOD}"`, item.fcn);
        }
        if (item.params.length !== 1) {
            throw new TransportInvalidDataError(`Invalid payload: params length must be 1`, item.params.length);
        }
        let content = item.params[0];
        let payload: TransportFabricRequestPayload = null;
        try {
            payload = TransformUtil.toClass<TransportFabricRequestPayload<U>>(TransportFabricRequestPayload, TransformUtil.toJSON(content));
            if (isNeedSetDefaultOptions) {
                TransportFabricRequestPayload.setDefaultOptions(payload);
            }
        } catch (error) {
            throw new TransportInvalidDataError(`Invalid payload: ${error.message}`, content);
        }
        ValidateUtil.validate(payload);
        return payload;
    }

    public static clear<U>(payload: ITransportFabricRequestPayload<U>): void {
        TransportFabricRequestPayload.clearDefaultOptions(payload.options);
        if (_.isEmpty(payload.options)) {
            delete payload.options;
        }
    }

    public static setDefaultOptions<U>(payload: ITransportFabricRequestPayload<U>): void {
        if (_.isNil(payload)) {
            return;
        }
        let options = payload.options;
        if (_.isNil(options)) {
            options = payload.options = {};
        }
        Transport.setDefaultOptions(options);
        if (!_.isNil(options.signature) && _.isNil(options.signature.algorithm)) {
            options.signature.algorithm = TransportCryptoManagerEd25519.ALGORITHM;
        }
    }

    public static clearDefaultOptions(options: ITransportFabricCommandOptions): void {
        if (_.isNil(options)) {
            return;
        }
        Transport.clearDefaultOptions(options);
        if (!_.isNil(options.signature) && options.signature.algorithm === TransportCryptoManagerEd25519.ALGORITHM) {
            delete options.signature.algorithm;
        }
    }

    // --------------------------------------------------------------------------
    //
    //  Properties
    //
    // --------------------------------------------------------------------------

    @IsString()
    public id: string;

    @IsString()
    public name: string;

    @IsOptional()
    public request?: U;

    @Type(() => TransportFabricCommandOptions)
    @IsOptional()
    @ValidateNested()
    public options?: TransportFabricCommandOptions;

    @IsOptional()
    @IsBoolean()
    public isNeedReply?: boolean;

    @IsOptional()
    @IsBoolean()
    public isReadonly?: boolean;
}

export type StubFunctionAndParameters = { fcn: string, params: string[] };