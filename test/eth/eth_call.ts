
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

import { assert } from 'chai'
import 'mocha'
import { BlockData,  util,  LogData } from 'in3-common'
import {  RPCResponse,  Proof } from '../../src/model/types'
import { TestTransport, getTestClient } from '../utils/transport'
import { deployContract } from '../../src/util/registry';
import * as tx from '../../src/util/tx'
import * as clientRPC from '../utils/clientRPC'
const toHex = util.toHex
const getAddress = util.getAddress
const toNumber = util.toNumber

// our test private key
const pk = '0xb903239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238'


describe('eth_call', () => {


  it('getBalance', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1, includeCode: true })

    // create a account with 500 wei
    const user = getAddress(await test.createAccount(undefined, 500))


    // check deployed code
    const adr = await deployContract('TestContract', await test.createAccount(), getTestClient())

    const balance = toNumber(await test.getFromServer('eth_getBalance', user, 'latest'))

    const response = await clientRPC.callContractWithClient(client, adr, 'getBalance(address)', user)

    assert.equal(balance, 500)
    assert.equal(toNumber(response.result), 500)

    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      re.result = '0x09'
      return re
    })

    await test.mustFail(clientRPC.callContractWithClient(client, adr, 'getBalance(address)', user))


    client.clearStats()
    test.clearInjectedResponsed()
    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      const ac = re.in3.proof.accounts
      // remove an account from proof
      delete ac[Object.keys(ac)[1]]
      return re
    })

    await test.mustFail(clientRPC.callContractWithClient(client, adr, 'getBalance(address)', user))

    client.clearStats()
    test.clearInjectedResponsed()
    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      const ac = Object.values(re.in3.proof.accounts)[0]
      // remove an account from proof
      ac.nonce += '0'
      return re
    })

    await test.mustFail(clientRPC.callContractWithClient(client, adr, 'getBalance(address)', user))

  })


  it('testInternCall', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1, includeCode: true })

    const pk1 = await test.createAccount(undefined, 500)
    const pk2 = await test.createAccount(undefined, 1500)

    // create a account with 500 wei
    const user = getAddress(await test.createAccount(undefined, 500))


    // check deployed code
    const adr1 = await deployContract('TestContract', pk1, getTestClient())
    const adr2 = await deployContract('TestContract', pk1, getTestClient())

    // increment the counter only on adr1
    await tx.callContract(test.url, adr1, 'increase()', [], { confirm: true, privateKey: pk1, gas: 3000000, value: 0 })


    // call a function of adr2 which then should call adr1
    //    function testInternCall(TestContract adr)  public view returns(uint){
    //      return adr.counter();
    //    }
    const response = await clientRPC.callContractWithClient(client, adr2, 'testInternCall(address)', adr1)
    assert.equal(toNumber(response.result), 1)

    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      re.result = '0x09'
      return re
    })
    await test.mustFail(clientRPC.callContractWithClient(client, adr2, 'testInternCall(address)', adr1))


    client.clearStats()
    test.clearInjectedResponsed()
    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      const ac = re.in3.proof.accounts
      // remove an account from proof
      delete ac[Object.keys(ac)[1]]
      return re
    })
    await test.mustFail(clientRPC.callContractWithClient(client, adr2, 'testInternCall(address)', adr1))


  })


  it('testBlockHash', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1, includeCode: true })

    // deploy testcontract
    const adr = await deployContract('TestContract', await test.createAccount(), getTestClient())
    const block = (await test.getFromServer('eth_getBlockByNumber', 'latest', false)) as BlockData

    const response = await clientRPC.callContractWithClient(client, adr, 'getBlockHash(uint)', toNumber(block.number))

    // TODO why is this returning 0x0?
    //    assert.equal(toHex(response.result, 32), toHex(block.hash, 32))


  })


  it('testExtCodeCopy', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1, includeCode: true })

    // deploy testcontract
    const pk = await test.createAccount()
    const adr = await deployContract('TestContract', pk, getTestClient())
    const adr2 = await deployContract('TestContract', pk, getTestClient())

    const response = await clientRPC.callContractWithClient(client, adr, 'getCodeAt(address)', adr2)

    // make sure the proof included the accountProof for adr2, since this was referenced
    assert.isTrue(response.in3.proof.accounts[toHex(adr2.toLowerCase(), 20)].accountProof.length > 0)

    // try to get the code from a non-existent account, so the merkleTree should prove it's not esiting
    const responseEmpty = await clientRPC.callContractWithClient(client, adr, 'getCodeAt(address)', "0x" + util.toBuffer(123, 20).toString('hex'))


    client.clearStats()
    test.clearInjectedResponsed()
    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      const ac = re.in3.proof.accounts
      // remove an account from proof
      delete ac[Object.keys(ac)[1]]
      return re
    })
    await test.mustFail(clientRPC.callContractWithClient(client, adr, 'getCodeAt(address)', adr2))


    client.clearStats()
    test.clearInjectedResponsed()
    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      const ac = re.in3.proof.accounts
      // remove the target account 
      delete ac[util.toMinHex(adr2.toLowerCase())]
      // and change the result to a empty-value
      re.result = '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000'
      return re
    })
    await test.mustFail(clientRPC.callContractWithClient(client, adr, 'getCodeAt(address)', adr2))



  })


  it('testDelegateCall', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1, includeCode: true })

    // deploy testcontract
    const pk = await test.createAccount()
    const adr = await deployContract('TestContract', pk, getTestClient())
    const adr2 = await deployContract('TestContract', pk, getTestClient())

    const response = await clientRPC.callContractWithClient(client, adr, 'testDelegateCall(address)', adr2)

    // make sure the proof included the accountProof for adr2, since this was referenced
    assert.isTrue(response.in3.proof.accounts[toHex(adr2.toLowerCase(), 20)].accountProof.length > 0)



    client.clearStats()
    test.clearInjectedResponsed()
    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      const ac = re.in3.proof.accounts
      // remove the target account 
      delete ac[util.toMinHex(adr2.toLowerCase())]
      // and change the result to a empty-value
      re.result = '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000'
      return re
    })
    await test.mustFail(clientRPC.callContractWithClient(client, adr, 'testDelegateCall(address)', adr2))


  })




  it('testCall', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1, includeCode: true })

    // deploy testcontract
    const pk = await test.createAccount()
    const adr = await deployContract('TestContract', pk, getTestClient())
    const adr2 = await deployContract('TestContract', pk, getTestClient())

    const response = await clientRPC.callContractWithClient(client, adr, 'testCall(address)', adr2)

    // make sure the proof included the accountProof for adr2, since this was referenced
    assert.isTrue(response.in3.proof.accounts[toHex(adr2.toLowerCase(), 20)].accountProof.length > 0)



    client.clearStats()
    test.clearInjectedResponsed()
    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      const ac = re.in3.proof.accounts
      // remove the target account 
      delete ac[util.toMinHex(adr2.toLowerCase())]
      // and change the result to a empty-value
      re.result = '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000'
      return re
    })
    await test.mustFail(clientRPC.callContractWithClient(client, adr, 'testCall(address)', adr2))


  })



  it('testCallCode', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1, includeCode: true })

    // deploy testcontract
    const pk = await test.createAccount()
    const adr = await deployContract('TestContract', pk, getTestClient())
    const adr2 = await deployContract('TestContract', pk, getTestClient())

    const response = await clientRPC.callContractWithClient(client, adr, 'testCallCode(address)', adr2)

    // make sure the proof included the accountProof for adr2, since this was referenced
    assert.isTrue(response.in3.proof.accounts[toHex(adr2.toLowerCase(), 20)].accountProof.length > 0)



    client.clearStats()
    test.clearInjectedResponsed()
    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      const ac = re.in3.proof.accounts
      // remove the target account 
      delete ac[util.toMinHex(adr2.toLowerCase())]
      // and change the result to a empty-value
      re.result = '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000'
      return re
    })
    await test.mustFail(clientRPC.callContractWithClient(client, adr, 'testCallCode(address)', adr2))


  })



})

