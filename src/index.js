//
// Copyright 2019 Wireline, Inc.
//

import isUrl from 'is-url';
import sha256 from 'js-sha256';

import { RegistryClient } from './registry_client';

import { Account } from './account';
import { Util } from './util';
import { TxBuilder } from './txbuilder';
import { Msg, Record } from './types';

import { createSchema } from './mock/schema';

import {
  MsgSend,
  MsgCreateBond,
  MsgRefillBond,
  MsgWithdrawBond,
  MsgCancelBond,
  MsgAssociateBond,
  MsgDissociateBond,
  MsgDissociateRecords,
  MsgReassociateRecords
} from './messages';

export const DEFAULT_CHAIN_ID = 'wireline';

const DEFAULT_WRITE_ERROR = 'Unable to write to WNS.';

/**
 * Wireline registry SDK.
 */
export class Registry {

  static processWriteError(error) {
    const message = JSON.parse(error.message);
    const log = JSON.parse(message.log);

    return log.message || DEFAULT_WRITE_ERROR;
  }

  /**
   * @constructor
   * @param {string} url
   * @param {string} chainID
   * @param {object} options
   */
  constructor(url, chainID = DEFAULT_CHAIN_ID, options = {}) {
    const { schema } = options;

    if (!schema && !isUrl(url)) {
      throw new Error('Path to a registry GQL endpoint should be provided.');
    }

    this._endpoint = url;
    this._chainID = chainID;
    this._options = options;

    this._client = new RegistryClient(url, options);
  }

  get endpoint() {
    return this._endpoint;
  }

  get chainID() {
    return this._chainID;
  }

  /**
   * Get server status.
   */
  async getStatus() {
    return this._client.getStatus();
  }

  /**
   * Get logs.
   * @param {number} count
   */
  async getLogs(count) {
    return this._client.getLogs(count);
  }

  /**
   * Run arbitrary query.
   * @param {string} query
   * @param {object} variables
   */
  async query(query, variables) {
    return this._client.query(query, variables);
  }

  /**
   * Get accounts by addresses.
   * @param {array} addresses
   */
  async getAccounts(addresses) {
    return this._client.getAccounts(addresses);
  }

  /**
   * Get records by ids.
   * @param {array} ids
   * @param {boolean} refs
   */
  async getRecordsByIds(ids, refs = false) {
    return this._client.getRecordsByIds(ids, refs);
  }

  /**
   * Get records by attributes.
   * @param {object} attributes
   * @param {boolean} refs
   */
  async queryRecords(attributes, refs = false) {
    return this._client.queryRecords(attributes, refs);
  }

  /**
   * Resolve records by refs.
   * @param {array} references
   * @param {boolean} refs
   */
  async resolveRecords(references, refs = false) {
    return this._client.resolveRecords(references, refs);
  }

  /**
   * Publish record.
   * @param {string} privateKey - private key in HEX to sign message.
   * @param {object} record
   * @param {string} transactionPrivateKey - private key in HEX to sign transaction.
   * @param {string} bondId
   * @param {object} fee
   */
  async setRecord(privateKey, record, transactionPrivateKey, bondId, fee) {
    let result;
    try {
      if (process.env.MOCK_SERVER) {
        result = await this._client.insertRecord(record, bondId);
      } else {
        result = await this._submitRecordTx(privateKey, record, 'nameservice/SetRecord', transactionPrivateKey, bondId, fee);
      }
    } catch (err) {
      const error = err[0] || err;
      throw new Error(Registry.processWriteError(error));
    }
    return result;
  }

  /**
   * Send coins.
   * @param {object[]} amount
   * @param {string} toAddress
   * @param {string} privateKey
   */
  async sendCoins(amount, toAddress, privateKey) {
    let result;
    try {
      const account = new Account(Buffer.from(privateKey, 'hex'));
      const fromAddress = account.formattedCosmosAddress;
      result = await this._submitTx(new MsgSend(fromAddress, toAddress, amount), privateKey);
    } catch (err) {
      const error = err[0] || err;
      throw new Error(Registry.processWriteError(error));
    }
    return result;
  }

  /**
   * Computes the next bondId for the given account private key.
   * @param {string} privateKey
   */
  async getNextBondId(privateKey) {
    let result;
    try {
      const account = new Account(Buffer.from(privateKey, 'hex'));
      const accounts = await this.getAccounts([account.formattedCosmosAddress]);
      if (!accounts.length) {
        throw new Error('Account does not exist.');
      }

      const [accountObj] = accounts;
      const nextSeq = parseInt(accountObj.sequence, 10) + 1;
      result = sha256(`${accountObj.address}:${accountObj.number}:${nextSeq}`);
    } catch (err) {
      const error = err[0] || err;
      throw new Error(Registry.processWriteError(error));
    }
    return result;
  }

  /**
   * Get bonds by ids.
   * @param {array} ids
   */
  async getBondsByIds(ids) {
    return this._client.getBondsByIds(ids);
  }

  /**
   * Query bonds by attributes.
   * @param {object} attributes
   */
  async queryBonds(attributes) {
    return this._client.queryBonds(attributes);
  }

  /**
   * Create bond.
   * @param {object[]} amount
   * @param {string} privateKey
   * @param {object} fee
   */
  async createBond(amount, privateKey, fee) {
    let result;
    try {
      const account = new Account(Buffer.from(privateKey, 'hex'));
      const fromAddress = account.formattedCosmosAddress;
      result = await this._submitTx(new MsgCreateBond(fromAddress, amount), privateKey, fee);
    } catch (err) {
      const error = err[0] || err;
      throw new Error(Registry.processWriteError(error));
    }
    return result;
  }

  /**
   * Refill bond.
   * @param {string} id
   * @param {object[]} amount
   * @param {string} privateKey
   */
  async refillBond(id, amount, privateKey) {
    let result;
    try {
      const account = new Account(Buffer.from(privateKey, 'hex'));
      const fromAddress = account.formattedCosmosAddress;
      result = await this._submitTx(new MsgRefillBond(id, fromAddress, amount), privateKey);
    } catch (err) {
      const error = err[0] || err;
      throw new Error(Registry.processWriteError(error));
    }
    return result;
  }

  /**
   * Withdraw (from) bond.
   * @param {string} id
   * @param {object[]} amount
   * @param {string} privateKey
   */
  async withdrawBond(id, amount, privateKey) {
    let result;
    try {
      const account = new Account(Buffer.from(privateKey, 'hex'));
      const fromAddress = account.formattedCosmosAddress;
      result = await this._submitTx(new MsgWithdrawBond(id, fromAddress, amount), privateKey);
    } catch (err) {
      const error = err[0] || err;
      throw new Error(Registry.processWriteError(error));
    }
    return result;
  }

  /**
   * Cancel bond.
   * @param {string} id
   * @param {string} privateKey
   */
  async cancelBond(id, privateKey) {
    let result;
    try {
      const account = new Account(Buffer.from(privateKey, 'hex'));
      const fromAddress = account.formattedCosmosAddress;
      result = await this._submitTx(new MsgCancelBond(id, fromAddress), privateKey);
    } catch (err) {
      const error = err[0] || err;
      throw new Error(Registry.processWriteError(error));
    }
    return result;
  }

  /**
   * Associate record with bond.
   * @param {string} id
   * @param {string} bondId
   * @param {string} privateKey
   */
  async associateBond(id, bondId, privateKey) {
    let result;
    try {
      const account = new Account(Buffer.from(privateKey, 'hex'));
      const fromAddress = account.formattedCosmosAddress;
      result = await this._submitTx(new MsgAssociateBond(id, bondId, fromAddress), privateKey);
    } catch (err) {
      const error = err[0] || err;
      throw new Error(Registry.processWriteError(error));
    }
    return result;
  }

  /**
   * Dissociate record from bond.
   * @param {string} id
   * @param {string} privateKey
   */
  async dissociateBond(id, privateKey) {
    let result;
    try {
      const account = new Account(Buffer.from(privateKey, 'hex'));
      const fromAddress = account.formattedCosmosAddress;
      result = await this._submitTx(new MsgDissociateBond(id, fromAddress), privateKey);
    } catch (err) {
      const error = err[0] || err;
      throw new Error(Registry.processWriteError(error));
    }
    return result;
  }

  /**
   * Dissociate all records from bond.
   * @param {string} bondId
   * @param {string} privateKey
   */
  async dissociateRecords(bondId, privateKey) {
    let result;
    try {
      const account = new Account(Buffer.from(privateKey, 'hex'));
      const fromAddress = account.formattedCosmosAddress;
      result = await this._submitTx(new MsgDissociateRecords(bondId, fromAddress), privateKey);
    } catch (err) {
      const error = err[0] || err;
      throw new Error(Registry.processWriteError(error));
    }
    return result;
  }

  /**
   * Reassociate records (switch bond).
   * @param {string} oldBondId
   * @param {string} newBondId
   * @param {string} privateKey
   */
  async reassociateRecords(oldBondId, newBondId, privateKey) {
    let result;
    try {
      const account = new Account(Buffer.from(privateKey, 'hex'));
      const fromAddress = account.formattedCosmosAddress;
      result = await this._submitTx(new MsgReassociateRecords(oldBondId, newBondId, fromAddress), privateKey);
    } catch (err) {
      const error = err[0] || err;
      throw new Error(Registry.processWriteError(error));
    }
    return result;
  }

  /**
   * Submit record transaction.
   * @param {string} privateKey - private key in HEX to sign message.
   * @param {object} record
   * @param {string} operation
   * @param {string} transactionPrivateKey - private key in HEX to sign transaction.
   * @param {string} bondId
   * @param {object} fee
   */
  async _submitRecordTx(privateKey, record, operation, transactionPrivateKey, bondId, fee) {
    if (!privateKey.match(/^[0-9a-fA-F]{64}$/)) {
      throw new Error('Registry privateKey should be a hex string.');
    }

    if (!bondId || !bondId.match(/^[0-9a-fA-F]{64}$/)) {
      throw new Error(`Invalid bondId: ${bondId}.`);
    }

    // 1. Get account details.
    const account = new Account(Buffer.from(privateKey, 'hex'));
    const accountDetails = await this.getAccounts([account.formattedCosmosAddress]);
    if (!accountDetails.length) {
      throw new Error('Can not sign the message - account does not exist.');
    }

    const signingAccount = transactionPrivateKey ? new Account(Buffer.from(transactionPrivateKey, 'hex')) : account;
    /* eslint-disable max-len */
    const signingAccountDetails = transactionPrivateKey ? await this.getAccounts([signingAccount.formattedCosmosAddress]) : accountDetails;
    if (!signingAccountDetails.length) {
      throw new Error('Can not sign the transaction - account does not exist.');
    }

    // 2. Generate message.
    const registryRecord = new Record(record, account);
    const payload = TxBuilder.generatePayload(registryRecord);
    const message = new Msg(operation, {
      'bondId': bondId,
      'payload': payload.serialize(),
      'signer': signingAccount.formattedCosmosAddress.toString()
    });

    // 3. Generate transaction.
    const { number, sequence } = signingAccountDetails[0];
    const transaction = TxBuilder.createTransaction(message, signingAccount, number.toString(), sequence.toString(), this._chainID, fee);
    const tx = btoa(JSON.stringify(transaction, null, 2));

    // 4. Send transaction.
    const { submit: response } = await this._client.submit(tx);
    return JSON.parse(response);
  }

  /**
   * Submit a generic Tx to the chain.
   * @param {object} message
   * @param {string} privateKey - private key in HEX to sign transaction.
   * @param {object} fee
   */
  async _submitTx(message, privateKey, fee) {
    // Check private key.
    if (!privateKey.match(/^[0-9a-fA-F]{64}$/)) {
      throw new Error('Registry privateKey should be a hex string.');
    }

    // Check that the account exists on-chain.
    const account = new Account(Buffer.from(privateKey, 'hex'));
    const accountDetails = await this.getAccounts([account.formattedCosmosAddress]);
    if (!accountDetails.length) {
      throw new Error('Can not sign the transaction - account does not exist.');
    }

    // Generate signed Tx.
    const { number, sequence } = accountDetails[0];
    const transaction = TxBuilder.createTransaction(message, account, number.toString(), sequence.toString(), this._chainID, fee);
    const tx = btoa(JSON.stringify(transaction, null, 2));

    // Submit Tx to chain.
    const { submit: response } = await this._client.submit(tx);
    return JSON.parse(response);
  }
}

export { Account, Util, createSchema };
