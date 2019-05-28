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

pragma solidity ^0.5.7;
pragma experimental ABIEncoderV2;

import "./BlockhashRegistry.sol";

/// @title Registry for IN3-Servers
contract ServerRegistry {

    /// server has been registered or updated its registry props or deposit
    event LogServerRegistered(string url, uint props, address owner, uint deposit);

    ///  a caller requested to unregister a server.
    event LogServerUnregisterRequested(string url, address owner, address caller);

    /// the owner canceled the unregister-proccess
    event LogServerUnregisterCanceled(string url, address owner);

    /// a Server was convicted
    event LogServerConvicted(string url, address owner);

    /// a Server is removed
    event LogServerRemoved(string url, address owner);
  
    struct In3Server {
        string url;  // the url of the server

        address payable owner; // the owner, which is also the key to sign blockhashes
        uint64 timeout; // timeout after which the owner is allowed to receive his stored deposit

        uint deposit; // stored deposit
        uint props; // a list of properties-flags representing the capabilities of the server

        uint128 unregisterTime; // earliest timestamp in to to call unregister
        uint128 registerTime; // timestamp when the server was registered
    }

    /// server list of incubed nodes    
    In3Server[] public servers;

    /// add your additional storage here. If you add information before this line you will break in3 nodelist

    BlockhashRegistry public blockRegistry;
    /// version: major minor fork(000) date(yyyy/mm/dd)
    uint constant public version = 12300020190328;

    uint public blockDeployment;

    // index for unique url and owner
    mapping (address => OwnerInformation) public ownerIndex;
    mapping (bytes32 => UrlInformation) public urlIndex;

    struct ConvictInformation {
        bytes32 convictHash;
        bytes32 blockHash;
    }

    struct OwnerInformation {
        bool used;
        uint128 index;
        uint lockedTime;
        uint depositAmount;
    }

    struct UrlInformation {
        bool used;
        address owner;
    }

    address public owner;
     

    mapping (uint => mapping(address => ConvictInformation)) convictMapping;

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    modifier onlyBeginning(){
        require(block.timestamp < (blockDeployment + 2*86400*365));
        _;
    }

    modifier startBalanceLimits(){ 
        if (now < (blockDeployment + 1*86400*365))
           require(address(this).balance < 50 ether, "Limit of 50 ETH reached");
        _;
    }

    constructor(address _blockRegistry) public {
        blockRegistry = BlockhashRegistry(_blockRegistry);
        blockDeployment = block.timestamp;
        owner = msg.sender;
    }

    /// length of the serverlist
    function totalServers() external view returns (uint)  {
        return servers.length;
    }
  
    /// register a new Server with the sender as owner    
    function registerServer(string calldata _url, uint _props, uint64 _timeout) external payable startBalanceLimits {

        bytes32 urlHash = keccak256(bytes(_url));

        // make sure this url and also this owner was not registered before.
        require (!urlIndex[urlHash].used && !ownerIndex[msg.sender].used, "a Server with the same url or owner is already registered");

        OwnerInformation memory oi;
        oi.used = true;
        oi.index = uint128(servers.length);

        ownerIndex[msg.sender] = oi;

        // add new In3Server
        In3Server memory m;
        m.url = _url;
        m.props = _props;
        m.owner = msg.sender;
        m.deposit = msg.value;
        m.timeout = _timeout > 3600 ? _timeout : 1 hours;
        m.registerTime = uint128(block.timestamp);
        servers.push(m);

        UrlInformation memory ui;
        ui.used = true;
        ui.owner = msg.sender;

        urlIndex[urlHash] = ui;
    
        // emit event
        emit LogServerRegistered(_url, _props, msg.sender,msg.value);
    }

    /// updates a Server by adding the msg.value to the deposit and setting the props    
    function updateServer(uint _props, uint64 _timeout) external payable startBalanceLimits {

        OwnerInformation memory oi = ownerIndex[msg.sender];
        require(oi.used, "sender does not own a server");

        In3Server storage server = servers[oi.index];

        if (msg.value>0) 
          server.deposit += msg.value;

        if (_props!=server.props)
          server.props = _props;

        if(_timeout > server.timeout)
            server.timeout = _timeout;
        emit LogServerRegistered(server.url, _props, msg.sender,server.deposit);
    }
    
    function recoverAddress(bytes memory _sig, bytes32 _evm_blockhash, address _owner) public pure returns (address){

        uint8 v;
        bytes32 r;
        bytes32 s;

       assembly {
            r := mload(add(_sig, 32))
            s := mload(add(_sig, 64))
            v := and(mload(add(_sig, 65)), 255)
        }

        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 tempHash = keccak256(abi.encodePacked(_evm_blockhash, _owner));
        bytes32 prefixedHash = keccak256(abi.encodePacked(prefix, tempHash));
        return ecrecover(prefixedHash, v, r, s);
    }
  

    function checkUnique(address _new, address[] memory _currentSet) internal pure returns (bool){
        for(uint i=0;i<_currentSet.length;i++){
            if(_currentSet[i]==_new) return true;
        }
    }

  
    function getValidVoters(uint _blockNumber, address _voted) public view returns (address[] memory, uint totalVoteTime){

        bytes32 evm_blockhash = blockhash(_blockNumber);
        require(evm_blockhash != 0x0, "block not found");

        // capping the number of required signatures
        uint requiredSignatures = servers.length > 25? 24: servers.length-1;

        address[] memory validVoters = new address[](requiredSignatures);

        uint uniqueSignatures = 0;
        uint i = 0;
        while(uniqueSignatures < requiredSignatures){
            
            uint8 tempByteOne = uint8(byte(evm_blockhash[(i+uniqueSignatures)%32]));
     
            uint8 tempByteTwo = uint8(byte(evm_blockhash[(i*2+uniqueSignatures)%32]));

            uint position = requiredSignatures > 24 ? (tempByteOne+tempByteTwo) % servers.length : i;

            if(!checkUnique(servers[position].owner,validVoters) && _voted!=servers[position].owner ){
                validVoters[uniqueSignatures] = servers[position].owner;
                uniqueSignatures++;
                totalVoteTime += (block.timestamp - servers[position].registerTime) > 365*86400 ? 365*86400 : (block.timestamp - servers[position].registerTime);
            }
            i++;
        }
        return (validVoters, totalVoteTime);
    }

    function voteUnregisterServer(uint _blockNumber, address _owner, bytes[] calldata _signatures) external {
       
        bytes32 evm_blockhash = blockhash(_blockNumber);
        require(evm_blockhash != 0x0, "block not found");
       
        OwnerInformation storage oi = ownerIndex[_owner];
        require(oi.used, "owner does not have a server");
       
        (address[] memory validSigners, uint totalVotingTime) = getValidVoters(_blockNumber,_owner );
        
        require(_signatures.length >= validSigners.length,"provided not enough signatures");

        In3Server memory server = servers[oi.index];

        uint activeTime = (now - server.registerTime) > 365*86400*2 ? 365*86400*2 : (now - server.registerTime); 
        
        uint votedTime = 0;

        for(uint i=0; i<_signatures.length; i++){

            address signedAddress = recoverAddress(_signatures[i], evm_blockhash, _owner);

            for(uint j=0; j<validSigners.length; j++){

                if(signedAddress == validSigners[j]){
                    votedTime += (now - servers[ownerIndex[signedAddress].index].registerTime) > 365*86400 ? 365*86400 : (now - servers[ownerIndex[signedAddress].index].registerTime);

                    if(votedTime > totalVotingTime/2 && votedTime > activeTime){
                        
                        oi.lockedTime = now + server.timeout;
                        oi.depositAmount = server.deposit;
                        oi.used = false;

                        removeServer(oi.index);
                        return;
                    }
                   break;
                }
            }
        }

       revert("not enough signatures");
   }

   function returnDeposit() external {
        OwnerInformation storage oi = ownerIndex[msg.sender];

        require(!(oi.used),"owner is currenttly active");

        require(now > oi.lockedTime, "deposit still locked");

        uint payout = oi.depositAmount;
        oi.depositAmount = 0;

        msg.sender.transfer(payout);
   }

    function requestUnregisteringServer() external {

        OwnerInformation memory oi = ownerIndex[msg.sender];
        require(oi.used, "sender does not own a server");

        In3Server storage server = servers[oi.index];

        // this can only be called if nobody requested it before
        require(server.unregisterTime == 0, "Server is already unregistering");
       
        server.unregisterTime = uint128(now + server.timeout);

        emit LogServerUnregisterRequested(server.url, server.owner, msg.sender);
    }
    
    /// this function must be called by the caller of the requestUnregisteringServer-function after 28 days
    /// if the owner did not cancel, the caller will receive 20% of the server deposit + his own deposit.
    /// the owner will receive 80% of the server deposit before the server will be removed.
    function confirmUnregisteringServer() external {

        OwnerInformation storage oi = ownerIndex[msg.sender];
        require(oi.used, "sender does not own a server");

        In3Server storage server = servers[oi.index];

        require(server.unregisterTime < now, "Only confirm after the timeout allowed");

        uint payBackOwner = server.deposit;
  
        if (payBackOwner > 0)
            server.owner.transfer(payBackOwner);
        oi.used = false;
        removeServer(oi.index);
    }

    /// this function must be called by the owner to cancel the unregister-process.
    /// if the caller is not the owner, then he will also get the deposit paid by the caller.
    function cancelUnregisteringServer() external {
        
        OwnerInformation memory oi = ownerIndex[msg.sender];
        require(oi.used, "sender does not own a server");

        In3Server storage server = servers[oi.index];
        require(server.unregisterTime>0,"server is not unregistering");

        server.unregisterTime = 0;

        /// emit event
        emit LogServerUnregisterCanceled(server.url, server.owner);
    }
    
    /// commits a blocknumber and a hash
    function convict(uint _blockNumber, bytes32 _hash) external {
        bytes32 evm_blockhash = blockhash(_blockNumber);

        if(evm_blockhash == 0x0) {
            evm_blockhash = blockRegistry.blockhashMapping(_blockNumber);
        }
        
        // if the blockhash is correct you cannot convict the server
        require(evm_blockhash != 0x0, "block not found");
    
        ConvictInformation memory ci;
        ci.convictHash = _hash;
        ci.blockHash = evm_blockhash;

        convictMapping[_blockNumber][msg.sender] = ci;
    
    }

    function revealConvict(address _owner, bytes32 _blockhash, uint _blockNumber, uint8 _v, bytes32 _r, bytes32 _s) external {
        
        OwnerInformation memory oi = ownerIndex[_owner];
        ConvictInformation storage ci = convictMapping[_blockNumber][msg.sender];

        // if the blockhash is correct you cannot convict the server
        require(ci.blockHash != _blockhash, "the block is too old or you try to convict with a correct hash");

        require(
            ecrecover(keccak256(abi.encodePacked(_blockhash, _blockNumber)), _v, _r, _s) == servers[oi.index].owner, 
            "the block was not signed by the owner of the server");

        require(
            keccak256(abi.encodePacked(_blockhash, msg.sender, _v, _r, _s)) == ci.convictHash, 
            "wrong convict hash");
        
        In3Server storage s = servers[oi.index];

        // remove the deposit
        if (s.deposit > 0) {
            uint payout =s.deposit / 2;
            // send 50% to the caller of this function
            msg.sender.transfer(payout);

            // and burn the rest by sending it to the 0x0-address
            // this is done in order to make it useless trying to convict your own server with a second account
            // and this getting all the deposit back after signing a wrong hash.
            address(0).transfer(s.deposit-payout);

        }

   
        // emit event
        emit LogServerConvicted(servers[oi.index].url, servers[oi.index].owner );
        
        /// for some reason currently deleting the ci storage would cost more gas, so we comment this out for now
        //delete ci.convictHash;
        //delete ci.blockHash;

        removeServer(oi.index);
    }


    // internal helper functions    
    function removeServer(uint _serverIndex) internal {
        // trigger event
        emit LogServerRemoved(servers[_serverIndex].url, servers[_serverIndex].owner);

        // remove from unique index
        urlIndex[keccak256(bytes(servers[_serverIndex].url))].used = false;
        ownerIndex[servers[_serverIndex].owner].used = false;

        uint length = servers.length;
        if (length>0) {
            // move the last entry to the removed one.
            In3Server memory m = servers[length - 1];
            servers[_serverIndex] = m;
        
            OwnerInformation storage oi = ownerIndex[m.owner];
            oi.index = uint128(_serverIndex);
        }
        servers.length--;
    }
    
    function update(address payable _newContract) external onlyOwner onlyBeginning {
        selfdestruct(_newContract);
    }
    
}
