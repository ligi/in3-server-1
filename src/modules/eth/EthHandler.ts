/***********************************************************
* This file is part of the Slock.it IoT Layer.             *
* The Slock.it IoT Layer contains:                         *
*   - USN (Universal Sharing Network)                      *
*   - INCUBED (Trustless INcentivized remote Node Network) *
************************************************************
* Copyright (C) 2016 - 2018 Slock.it GmbH                  *
* All Rights Reserved.                                     *
************************************************************
* You may use, distribute and modify this code under the   *
* terms of the license contract you have concluded with    *
* Slock.it GmbH.                                           *
* For information about liability, maintenance etc. also   *
* refer to the contract concluded with Slock.it GmbH.      *
************************************************************
* For more information, please refer to https://slock.it   *
* For questions, please contact info@slock.it              *
***********************************************************/

import {  Transport, util as in3Util, serialize } from 'in3-common'
import { RPCRequest, RPCResponse, ServerList, IN3RPCHandlerConfig, ChainSpec } from '../../model/types'
import { handeGetTransaction, handeGetTransactionFromBlock, handeGetTransactionReceipt, handleAccount, handleBlock, handleCall, handleLogs } from './proof'
import BaseHandler from '../../chains/BaseHandler'
import { handleSign } from '../../chains/signatures';
import { getValidatorHistory } from '../../server/poa'
import { TxRequest, LogFilter } from './api';
import * as tx from '../../../src/util/tx'

const clientConf = require('in3-common/js/defaultConfig.json')
const toHex = in3Util.toHex
const toNumber = in3Util.toNumber

/**
 * handles EVM-Calls
 */
export default class EthHandler extends BaseHandler {

  constructor(config: IN3RPCHandlerConfig, transport?: Transport, nodeList?: ServerList) {
    super(config, transport, nodeList)
  }

  /** main method to handle a request */
  async handle(request: RPCRequest): Promise<RPCResponse> {
    // replace the latest BlockNumber
    if (request.in3 && request.in3.latestBlock && Array.isArray(request.params)) {
      const i = request.params.indexOf('latest')
      if (i >= 0)
        request.params[i] = toHex((this.watcher.block.number || await this.getFromServer({ method: 'eth_blockNumber', params: [] }, request).then(_ => toNumber(_.result))) - request.in3.latestBlock)
    }

    // make sure the in3 params are set
    if (!request.in3)
      request.in3 = { verification: 'never', chainId: this.chainId }

    if (!request.in3.verification)
      request.in3.verification = 'never'

    // execute it
    try{
      const result = await this.handleRPCMethod(request)
      if ((request as any).convert)
        (request as any).convert(result)
      return result
    }
    catch(error){
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: error.toString()
      }
    }
  }

  private checkPerformanceLimits(request: RPCRequest) {
    if (request.method === 'eth_call') {
      if (!request.params || request.params.length < 2) throw new Error('eth_call must have a transaction and a block as parameters')
      const tx = request.params as TxRequest
      if (!tx || (tx.gas && toNumber(tx.gas) > 10000000)) throw new Error('eth_call with a gaslimit > 10M are not allowed')
    }
    else if (request.method === 'eth_getLogs') {
      if (!request.params || request.params.length < 1) throw new Error('eth_getLogs must have a filter as parameter')
      const filter: LogFilter = request.params[0]
      let toB = filter && filter.toBlock
      if (toB === 'latest' || !toB) toB = this.watcher && this.watcher.block && this.watcher.block.number
      let fromB = toB && filter && filter.fromBlock
      if (fromB === 'earliest') fromB = 1;
      const range = fromB && (toNumber(toB) - toNumber(fromB))
      if (range > (request.in3.verification.startsWith('proof') ? 1000 : 10000))
        throw new Error('eth_getLogs for a range of ' + range + ' blocks is not allowed. limits: with proof: 1000, without 10000 ')
    }
  }

  private async handleRPCMethod(request: RPCRequest) {

    // handle shortcut-functions
    if (request.method === 'in3_call') {
      request.method = 'eth_call'
      request.params = createCallParams(request)
    }

    // check performancelimits
    this.checkPerformanceLimits(request)


    // handle special jspn-rpc
    if (request.in3.verification.startsWith('proof'))
      switch (request.method) {
        case 'eth_getBlockByNumber':
        case 'eth_getBlockByHash':
        case 'eth_getBlockTransactionCountByHash':
        case 'eth_getBlockTransactionCountByNumber':
          return handleBlock(this, request)
        case 'eth_getTransactionByBlockHashAndIndex':
        case 'eth_getTransactionByBlockNumberAndIndex':
          return handeGetTransactionFromBlock(this, request)
        case 'eth_getTransactionByHash':
          return handeGetTransaction(this, request)
        case 'eth_getTransactionReceipt':
          return handeGetTransactionReceipt(this, request)
        case 'eth_getLogs':
          return handleLogs(this, request)
        case 'eth_call':
          return handleCall(this, request)

        case 'eth_getCode':
        case 'eth_getBalance':
        case 'eth_getTransactionCount':
        case 'eth_getStorageAt':
          return handleAccount(this, request)
        default:

      }

    // handle in3-methods
    switch (request.method) {

      case 'eth_sign':
      case 'eth_sendTransaction':
        return this.toError(request.id, 'a in3 - node can not sign Messages, because the no unlocked key is allowed!')

      case 'eth_submitWork':
      case 'eth_submitHashrate':
        return this.toError(request.id, 'Incubed cannot be used for mining since there is no coinbase')

      case 'in3_sign':
        return handleSign(this, request)

      default:
        // default handling by simply getting the response from the server
        return this.getFromServer(request, request)
    }
  }

  getRequestFromPath(path: string[], in3: { chainId: string; }): RPCRequest {
    if (path[0] && path[0].startsWith('0x') && path[0].length < 43) {
      const [contract, method] = path
      const r: RPCRequest = { id: 1, jsonrpc: '2.0', method: '', params: [contract, 'latest'], in3 }
      switch (method) {
        case 'balance': return { ...r, method: 'eth_getBalance' }
        case 'nonce': return { ...r, method: 'eth_getTransactionCount' }
        case 'code': return { ...r, method: 'eth_getCode' }
        case 'storage': return { ...r, method: 'eth_getStorageAt', params: [contract, path[2], 'latest'] }
        default:
          return { ...r, method: 'in3_call', params: [contract, method, ...path.slice(2).join('/').split(',').filter(_ => _).map(_ => _ === 'true' ? true : _ === 'false' ? false : _)] }
      }
    }
    else if (path[0] && path[0].startsWith('0x') && path[0].length > 43)
      return { id: 1, jsonrpc: '2.0', method: 'eth_getTransactionReceipt', params: [path[0]], in3 }
    else if (path[0] && (parseInt(path[0]) || path[0] === 'latest'))
      return { id: 1, jsonrpc: '2.0', method: 'eth_getBlockByNumber', params: [path[0] === 'latest' ? 'latest' : '0x' + parseInt(path[0]).toString(16), false], in3 }

    return null
  }

  async getAuthorities(blockNumber: number): Promise<Buffer[]> {
    const spec = this.getChainSpec()

    //get all the states from validatorHistory from the specified blocknumber
    const validatorStates = spec && (await getValidatorHistory(this)).states
    if (!validatorStates || !validatorStates.length) return []

    let pos = validatorStates.length - 1;
    for (let i = pos; i; i--)
      if (validatorStates[i].block < blockNumber) break

    return validatorStates[pos].validators.map(serialize.address)
  }



  getChainSpec(): ChainSpec {
    const chain = clientConf.servers[this.chainId]
    return chain && chain.chainSpec
  }
}

function createCallParams(request: RPCRequest): any[] {
  const params = request.params || []
  const methodRegex = /^\w+\((.*)\)$/gm
  let [contract, method] = params as string[]
  if (!contract) throw new Error('First argument needs to be a valid contract address')
  if (!method) throw new Error('First argument needs to be a valid contract method signature')
  if (method.indexOf('(') < 0) method += '()'

  // since splitting for get is simply split(',') the method-signature is also split, so we reunit it.
  while (method.indexOf(')') < 0 && params.length > 2) {
    method += ',' + params[2]
    params.splice(2, 1)
  }

  if (method.indexOf(':') > 0) {
    const srcFullMethod = method;
    const fullMethod = method.endsWith(')') ? method : method.split(':').join(':(') + ')'
    const retTypes = method.split(':')[1].substr(1).replace(')', ' ').trim().split(', ');
    (request as any).convert = result => {
      if (result.result)
        result.result = tx.decodeFunction(fullMethod, Buffer.from(result.result.substr(2), 'hex')).map((v, i) => {
          if (Buffer.isBuffer(v)) return '0x' + v.toString('hex')
          if (v && v.ixor) return v.toString()
          if (retTypes[i] !== 'string' && typeof v === 'string' && v[1] !== 'x')
            return '0x' + v
          return v
        })
      if (Array.isArray(result.result) && !srcFullMethod.endsWith(')'))
        result.result = result.result[0]
      return result
    }
    method = method.substr(0, method.indexOf(':'))
  }

  const m = methodRegex.exec(method)
  if (!m) throw new Error('No valid method signature for ' + method)
  const types = m[1].split(',').filter(_ => _)
  const values = params.slice(2, types.length + 2)
  if (values.length < types.length) throw new Error('invalid number of arguments. Must be at least ' + types.length)

  return [{ to: contract, data: '0x' + tx.encodeFunction(method, values) }, params[types.length + 2] || 'latest']
}
